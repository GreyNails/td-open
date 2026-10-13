import type { Params } from "../types";
import type { VisualCook } from "./visual";
import { compatibilityTopCatalog } from "./compatibilityTopCatalog";

const specs = new Map(compatibilityTopCatalog.map((spec) => [spec.type, spec]));
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const smooth = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};

function parameters(type: string, input: Params): Params {
  const result: Params = {};
  for (const param of specs.get(type)?.params ?? []) {
    const raw = input[param.key] ?? param.default;
    if (param.type === "number") {
      const value = Number(raw),
        finite = Number.isFinite(value) ? value : Number(param.default);
      result[param.key] = clamp(
        param.step === 1 ? Math.round(finite) : finite,
        param.min,
        param.max,
      );
    } else if (param.type === "boolean")
      result[param.key] = raw === true || raw === 1 || raw === "true";
    else
      result[param.key] =
        param.options && !param.options.includes(String(raw))
          ? param.default
          : String(raw);
  }
  return result;
}

/** Complete interval membership, with separately controlled falloff outside each edge. */
export function rgbRangeWeight(
  value: number,
  low: number,
  high: number,
  softLow: number,
  softHigh: number,
): number {
  if (low > high) return 0;
  if (value < low)
    return softLow > 0 ? smooth((value - low + softLow) / softLow) : 0;
  if (value > high)
    return softHigh > 0 ? smooth((high + softHigh - value) / softHigh) : 0;
  return 1;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  let hue = 0;
  if (delta)
    hue =
      max === r
        ? (g - b) / delta
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  return [wrap(hue / 6, 1), max ? delta / max : 0, max];
}

/** S/V may deliberately exceed [0,1]; only final RGBA8 storage clips them. */
export function hsvToRgbUnclamped(
  hue: number,
  saturation: number,
  value: number,
): [number, number, number] {
  const h = wrap(hue, 1) * 6,
    chroma = value * saturation,
    x = chroma * (1 - Math.abs((h % 2) - 1)),
    m = value - chroma;
  const rgb =
    h < 1
      ? [chroma, x, 0]
      : h < 2
        ? [x, chroma, 0]
        : h < 3
          ? [0, chroma, x]
          : h < 4
            ? [0, x, chroma]
            : h < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return rgb.map((channel) => channel + m) as [number, number, number];
}

function maskAt(
  data: Uint8ClampedArray | undefined,
  index: number,
  channel: string,
): number {
  if (!data) return 0;
  const r = data[index] / 255,
    g = data[index + 1] / 255,
    b = data[index + 2] / 255,
    a = data[index + 3] / 255;
  switch (channel) {
    case "red":
      return r;
    case "green":
      return g;
    case "blue":
      return b;
    case "luminance":
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    case "rgb_average":
      return (r + g + b) / 3;
    case "rgba_average":
      return (r + g + b + a) / 4;
    case "rgb_max":
      return Math.max(r, g, b);
    case "rgba_max":
      return Math.max(r, g, b, a);
    default:
      return a;
  }
}

export type LensCoefficients = {
  k1: number;
  k2: number;
  k3: number;
  p1: number;
  p2: number;
};
/** Brown–Conrady camera model; coordinates are relative to principal point and focal length. */
export function distortLensPoint(
  x: number,
  y: number,
  lens: LensCoefficients,
): [number, number] {
  const r2 = x * x + y * y,
    radial = 1 + r2 * (lens.k1 + r2 * (lens.k2 + r2 * lens.k3));
  return [
    x * radial + 2 * lens.p1 * x * y + lens.p2 * (r2 + 2 * x * x),
    y * radial + lens.p1 * (r2 + 2 * y * y) + 2 * lens.p2 * x * y,
  ];
}

/** Damped Newton inverse includes k3; a fold/non-converging location has no valid sample. */
export function invertLensPoint(
  tx: number,
  ty: number,
  lens: LensCoefficients,
): [number, number] | undefined {
  let x = tx,
    y = ty;
  for (let iteration = 0; iteration < 24; iteration++) {
    const [dx, dy] = distortLensPoint(x, y, lens),
      ex = dx - tx,
      ey = dy - ty,
      error = ex * ex + ey * ey;
    if (error < 1e-16) return [x, y];
    if (!Number.isFinite(error)) return undefined;
    const r2 = x * x + y * y,
      radial = 1 + r2 * (lens.k1 + r2 * (lens.k2 + r2 * lens.k3));
    const dr = 2 * (lens.k1 + 2 * lens.k2 * r2 + 3 * lens.k3 * r2 * r2);
    const a = radial + x * x * dr + 2 * lens.p1 * y + 6 * lens.p2 * x;
    const b = x * y * dr + 2 * lens.p1 * x + 2 * lens.p2 * y;
    const d = radial + y * y * dr + 6 * lens.p1 * y + 2 * lens.p2 * x;
    const determinant = a * d - b * b;
    if (Math.abs(determinant) < 1e-12) return undefined;
    const stepX = (d * ex - b * ey) / determinant,
      stepY = (a * ey - b * ex) / determinant;
    let accepted = false;
    for (let scale = 1; scale >= 1 / 128; scale /= 2) {
      const nx = x - scale * stepX,
        ny = y - scale * stepY,
        [fx, fy] = distortLensPoint(nx, ny, lens);
      if ((fx - tx) ** 2 + (fy - ty) ** 2 < error) {
        x = nx;
        y = ny;
        accepted = true;
        break;
      }
    }
    if (!accepted) return undefined;
  }
  const [fx, fy] = distortLensPoint(x, y, lens);
  return Math.hypot(fx - tx, fy - ty) < 1e-6 ? [x, y] : undefined;
}

export type PixelBoundary = "clamp" | "wrap" | "mirror" | "transparent";
export function boundaryIndex(
  value: number,
  size: number,
  boundary: PixelBoundary,
): number {
  if (value >= 0 && value < size) return value;
  if (boundary === "transparent") return -1;
  if (boundary === "wrap") return wrap(value, size);
  if (boundary === "mirror") {
    const reflected = wrap(value, size * 2);
    return reflected < size ? reflected : 2 * size - 1 - reflected;
  }
  return clamp(value, 0, size - 1);
}

function sampleBilinear(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  edge: PixelBoundary,
  destination: Uint8ClampedArray,
  index: number,
  nearest: boolean,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (nearest) {
    const sx = boundaryIndex(Math.round(x), width, edge),
      sy = boundaryIndex(Math.round(y), height, edge);
    if (sx >= 0 && sy >= 0)
      destination.set(
        source.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4),
        index,
      );
    return;
  }
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy,
    sum = [0, 0, 0, 0];
  for (let py = 0; py < 2; py++)
    for (let px = 0; px < 2; px++) {
      const sx = boundaryIndex(ix + px, width, edge),
        sy = boundaryIndex(iy + py, height, edge);
      if (sx < 0 || sy < 0) continue;
      const weight = (px ? dx : 1 - dx) * (py ? dy : 1 - dy),
        offset = (sy * width + sx) * 4,
        alpha = source[offset + 3] / 255;
      for (let c = 0; c < 3; c++) sum[c] += weight * source[offset + c] * alpha;
      sum[3] += weight * alpha;
    }
  if (sum[3] > 0)
    for (let c = 0; c < 3; c++) destination[index + c] = sum[c] / sum[3];
  destination[index + 3] = sum[3] * 255;
}

function lensPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  p: Params,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(source.length),
    lens: LensCoefficients = {
      k1: Number(p.k1),
      k2: Number(p.k2),
      k3: Number(p.k3),
      p1: Number(p.p1),
      p2: Number(p.p2),
    };
  const cx = Number(p.cx),
    cy = Number(p.cy),
    fx = Number(p.fx),
    fy = Number(p.fy),
    edge = p.boundary as PixelBoundary;
  // Preserve hidden RGB at alpha=0 for a genuinely identity operation.
  if (!Object.values(lens).some(Boolean)) return source.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const nx = ((x + 0.5) / width - cx) / fx,
        ny = ((y + 0.5) / height - cy) / fy;
      const mapped =
        p.direction === "distort"
          ? invertLensPoint(nx, ny, lens)
          : distortLensPoint(nx, ny, lens);
      if (mapped)
        sampleBilinear(
          source,
          width,
          height,
          (mapped[0] * fx + cx) * width - 0.5,
          (mapped[1] * fy + cy) * height - 0.5,
          edge,
          result,
          (y * width + x) * 4,
          p.filter === "nearest",
        );
    }
  return result;
}

export function parseBlurKernel(raw: string): number[][] {
  let kernel: unknown;
  try {
    kernel = JSON.parse(raw);
  } catch {
    throw new Error("Blur 自定义核必须是有效的二维 JSON 数组。");
  }
  if (
    !Array.isArray(kernel) ||
    kernel.length < 1 ||
    kernel.length > 15 ||
    kernel.length % 2 !== 1 ||
    kernel.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== kernel.length ||
        row.some(
          (value: unknown) =>
            typeof value !== "number" || !Number.isFinite(value) || value < 0,
        ),
    )
  )
    throw new Error("Blur 核必须为 1–15 阶奇数方阵，权重必须是有限非负数。");
  const matrix = kernel as number[][],
    sum = matrix.flat().reduce((a, b) => a + b, 0);
  if (!(sum > 0) || !Number.isFinite(sum))
    throw new Error("Blur 核权重之和必须为有限正数。");
  return matrix.map((row) => row.map((value) => value / sum));
}

function blurPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  p: Params,
): Uint8ClampedArray {
  const edge = p.boundary as PixelBoundary,
    radius = Number(p.radius),
    useAlpha = Boolean(p.premultiply);
  if (p.method !== "custom" && radius === 0) return source.slice();
  const initial = new Float64Array(source.length);
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      initial[i + c] = source[i + c] * (useAlpha ? alpha : 1);
    initial[i + 3] = source[i + 3];
  }
  let filtered: Float64Array;
  if (p.method === "custom") {
    const kernel = parseBlurKernel(String(p.kernel)),
      r = (kernel.length - 1) / 2;
    filtered = new Float64Array(initial.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let ky = -r; ky <= r; ky++)
          for (let kx = -r; kx <= r; kx++) {
            const sx = boundaryIndex(x + kx, width, edge),
              sy = boundaryIndex(y + ky, height, edge);
            if (sx < 0 || sy < 0) continue;
            const sourceIndex = (sy * width + sx) * 4,
              targetIndex = (y * width + x) * 4,
              weight = kernel[ky + r][kx + r];
            for (let c = 0; c < 4; c++)
              filtered[targetIndex + c] += initial[sourceIndex + c] * weight;
          }
  } else {
    const weights = Array.from({ length: radius * 2 + 1 }, (_, index) =>
        p.method === "box"
          ? 1
          : Math.exp(-((index - radius) ** 2) / (2 * Number(p.sigma) ** 2)),
      ),
      sum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
    const pass = (data: Float64Array, horizontal: boolean) => {
      const result = new Float64Array(data.length);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (let k = -radius; k <= radius; k++) {
            const sx = boundaryIndex(x + (horizontal ? k : 0), width, edge),
              sy = boundaryIndex(y + (horizontal ? 0 : k), height, edge);
            if (sx < 0 || sy < 0) continue;
            const inputIndex = (sy * width + sx) * 4,
              outputIndex = (y * width + x) * 4;
            for (let c = 0; c < 4; c++)
              result[outputIndex + c] +=
                data[inputIndex + c] * weights[k + radius];
          }
      return result;
    };
    filtered = pass(pass(initial, true), false);
  }
  const result = new Uint8ClampedArray(source.length);
  for (let i = 0; i < source.length; i += 4) {
    const alpha = filtered[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      result[i + c] = useAlpha
        ? alpha > 1e-12
          ? filtered[i + c] / alpha
          : 0
        : filtered[i + c];
    result[i + 3] = filtered[i + 3];
  }
  return result;
}

/** Pure RGBA8 implementation shared by browser cooking and pixel verification. Inputs stay unchanged. */
export function applyCompatibilityTopPixels(
  type: string,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  params: Params = {},
  mask?: Uint8ClampedArray,
  background?: Uint8ClampedArray,
): Uint8ClampedArray {
  if (!specs.has(type)) throw new Error(`Unknown compatibility TOP: ${type}`);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    source.length !== width * height * 4 ||
    (mask && mask.length !== source.length) ||
    (background && background.length !== source.length)
  )
    throw new Error("TOP 像素数组长度必须匹配相同的有效图像尺寸。");
  const p = parameters(type, params),
    result = source.slice();
  if (type === "compat_lens_distort")
    return lensPixels(source, width, height, p);
  if (type === "compat_blur") return blurPixels(source, width, height, p);
  let lut: Uint8ClampedArray | undefined;
  if (type === "compat_level") {
    if (Number(p.white) <= Number(p.black))
      throw new Error("Level 输入白点必须大于黑点。");
    lut = Uint8ClampedArray.from({ length: 256 }, (_, value) => {
      const normalized = clamp(
        (value / 255 - Number(p.black)) / (Number(p.white) - Number(p.black)),
      );
      return (
        ((normalized ** (1 / Number(p.gamma)) +
          Number(p.brightness) -
          Number(p.pivot)) *
          Number(p.contrast) +
          Number(p.pivot)) *
        255
      );
    });
  }
  const sources = ["r", "g", "b", "a"].map((key) =>
    ["R", "G", "B", "A", "0", "1"].indexOf(String(p[key])),
  );
  for (let i = 0; i < source.length; i += 4) {
    if (type === "compat_rgb_key") {
      let key = 1;
      for (const [channel, name] of ["red", "green", "blue"].entries())
        key = Math.min(
          key,
          rgbRangeWeight(
            source[i + channel] / 255,
            Number(p[`${name}_min`]),
            Number(p[`${name}_max`]),
            Number(p[`${name}_soft_low`]),
            Number(p[`${name}_soft_high`]),
          ),
        );
      if (p.invert) key = 1 - key;
      if (p.rgb_output !== "source")
        for (let c = 0; c < 3; c++)
          result[i + c] =
            key * (p.rgb_output === "new_alpha" ? 255 : source[i + c]);
      result[i + 3] =
        key * (p.alpha_output === "new_alpha" ? 255 : source[i + 3]);
    } else if (type === "compat_level") {
      for (let c = 0; c < 3; c++) result[i + c] = lut![source[i + c]];
      result[i + 3] = source[i + 3] * Number(p.opacity);
    } else if (type === "compat_reorder") {
      for (let c = 0; c < 4; c++)
        result[i + c] =
          sources[c] < 4 ? source[i + sources[c]] : sources[c] === 4 ? 0 : 255;
    } else if (type === "compat_hsv_adjust") {
      const [h, s, v] = rgbToHsv(
        source[i] / 255,
        source[i + 1] / 255,
        source[i + 2] / 255,
      );
      let ns = s * Number(p.saturation) + Number(p.saturation_offset),
        nv = v * Number(p.value) + Number(p.value_offset);
      if (p.clamp) {
        ns = clamp(ns);
        nv = clamp(nv);
      }
      const rgb = hsvToRgbUnclamped(h + Number(p.hue) / 360, ns, nv);
      for (let c = 0; c < 3; c++) result[i + c] = rgb[c] * 255;
    } else {
      let key = maskAt(mask, i, String(p.channel));
      if (p.invert) key = 1 - key;
      if (type === "compat_inside") {
        for (let c = p.affect === "alpha" ? 3 : 0; c < 4; c++)
          result[i + c] = source[i + c] * key;
      } else {
        const foregroundAlpha = (key * source[i + 3]) / 255,
          backgroundAlpha = ((1 - key) * (background?.[i + 3] ?? 0)) / 255,
          alpha = foregroundAlpha + backgroundAlpha;
        for (let c = 0; c < 3; c++)
          result[i + c] =
            alpha > 0
              ? (source[i + c] * foregroundAlpha +
                  (background?.[i + c] ?? 0) * backgroundAlpha) /
                alpha
              : 0;
        result[i + 3] = alpha * 255;
      }
    }
  }
  return result;
}

export type CompatibilityTopCook = VisualCook & { input3?: HTMLCanvasElement };
export function cookCompatibilityTopNode(args: CompatibilityTopCook): boolean {
  const { node, ctx, width, height, state } = args;
  if (!specs.has(node.type)) return false;
  const read = (
    input: HTMLCanvasElement | undefined,
    slot: number,
  ): Uint8ClampedArray | undefined => {
    if (!input) return undefined;
    const key = `compat_top_input_${slot}`;
    let canvas = state.get(key) as HTMLCanvasElement | undefined;
    if (!canvas) {
      canvas = document.createElement("canvas");
      state.set(key, canvas);
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D 不可用。");
    context.clearRect(0, 0, width, height);
    context.drawImage(input, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const source =
      read(args.input, 0) ?? new Uint8ClampedArray(width * height * 4),
    mask = read(args.input2, 1),
    background = read(args.input3, 2);
  const pixels = applyCompatibilityTopPixels(
      node.type,
      source,
      width,
      height,
      node.data.params,
      mask,
      background,
    ),
    output = ctx.createImageData(width, height);
  output.data.set(pixels);
  ctx.putImageData(output, 0, 0);
  return true;
}
