import type { Params } from "../types";
import type { VisualCook } from "./visual";
import { advancedVisualCatalog } from "./advancedVisualCatalog";

const specs = new Map(advancedVisualCatalog.map((spec) => [spec.type, spec]));
const TAU = 2 * Math.PI;
const clamp = (v: number, low = 0, high = 1) =>
  Math.max(low, Math.min(high, v));
const fract = (v: number) => v - Math.floor(v);
const mix = (a: number, b: number, f: number) => a + (b - a) * f;
const luma = (r: number, g: number, b: number) =>
  r * 0.2126 + g * 0.7152 + b * 0.0722;
const rgb = (value: unknown) =>
  [1, 3, 5].map((i) => parseInt(String(value).slice(i, i + 2), 16));
const hash = (x: number, y: number, seed: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453);

export function advancedParameters(type: string, params: Params): Params {
  return Object.fromEntries(
    (specs.get(type)?.params ?? []).map((param) => {
      const raw = params[param.key] ?? param.default;
      let value: string | number | boolean = raw;
      if (param.type === "number") {
        value = Number.isFinite(Number(raw))
          ? clamp(Number(raw), param.min, param.max)
          : param.default;
        if (param.step === 1) value = Math.round(Number(value));
      } else if (param.type === "color")
        value = /^#[\da-f]{6}$/i.test(String(raw))
          ? String(raw)
          : param.default;
      else if (param.options && !param.options.includes(String(raw)))
        value = param.default;
      return [param.key, value];
    }),
  );
}

function valueNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = fract(x),
    fy = fract(y);
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  return mix(
    mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), sx),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), sx),
    sy,
  );
}

/** Normalized scalar fields used by the texture generators (u and v are aspect-correct coordinates). */
export function advancedGeneratorValue(
  type: string,
  u: number,
  v: number,
  time: number,
  mod: number,
  p: Params,
): number {
  const t = time * Number(p.speed ?? 0) + mod;
  const x = u - Number(p.x ?? 0.5),
    y = v - Number(p.y ?? 0.5);
  const scale = Number(p.scale ?? 1),
    angle = (Number(p.angle ?? 0) * Math.PI) / 180;
  if (type === "cellular") {
    const px = u * scale + t,
      py = v * scale + t * 0.37;
    const ix = Math.floor(px),
      iy = Math.floor(py),
      seed = Number(p.seed);
    let nearest = 4;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const dx = ix + i + hash(ix + i, iy + j, seed) - px;
        const dy = iy + j + hash(ix + i, iy + j, seed + 19) - py;
        nearest = Math.min(nearest, dx * dx + dy * dy);
      }
    return clamp(1 - Math.sqrt(nearest));
  }
  if (type === "fbm_noise") {
    let amplitude = 1,
      total = 0,
      weight = 0,
      frequency = scale;
    for (let i = 0; i < Number(p.octaves); i++) {
      total +=
        amplitude *
        valueNoise(
          u * frequency + t,
          v * frequency + t * 0.37,
          Number(p.seed) + i * 17,
        );
      weight += amplitude;
      amplitude *= Number(p.roughness);
      frequency *= 2;
    }
    return total / weight;
  }
  if (type === "mandelbrot" || type === "julia") {
    const zoom = Number(p.zoom),
      limit = Number(p.iterations);
    let zx = type === "julia" ? ((u - 0.5) * 3) / zoom : 0;
    let zy = type === "julia" ? ((v - 0.5) * 3) / zoom : 0;
    const cx =
      type === "julia" ? Number(p.real) : ((u - 0.5) * 3) / zoom + Number(p.x);
    const cy =
      type === "julia"
        ? Number(p.imaginary)
        : ((v - 0.5) * 3) / zoom + Number(p.y);
    let iteration = 0;
    while (zx * zx + zy * zy <= 256 && iteration < limit) {
      const next = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = next;
      iteration++;
    }
    if (iteration === limit) return 0;
    const smooth =
      iteration +
      1 -
      Math.log2(Math.max(1, Math.log2(Math.max(1.001, Math.hypot(zx, zy)))));
    return 0.5 + 0.5 * Math.cos(smooth * 0.32 + t * TAU);
  }
  if (type === "moire") {
    const f = Number(p.frequency) * TAU,
      offset = Number(p.offset);
    return clamp(
      0.5 +
        0.25 * Math.sin((u + t) * f) +
        0.25 *
          Math.sin(
            (u * Math.cos(angle) + v * Math.sin(angle) + offset - t * 0.4) * f,
          ),
    );
  }
  if (type === "spiral")
    return (
      0.5 +
      0.5 *
        Math.sin(
          Math.atan2(y, x) * Number(p.arms) +
            Math.hypot(x, y) * Number(p.twist) * TAU +
            t * TAU,
        )
    );
  if (type === "hex_grid") {
    const px = (u * Math.cos(angle) - v * Math.sin(angle)) * scale + t;
    const py = (u * Math.sin(angle) + v * Math.cos(angle)) * scale;
    const a = {
      x: (((px % 1.732050808) + 1.732050808) % 1.732050808) - 0.866025404,
      y: (((py % 3) + 3) % 3) - 1.5,
    };
    const b = {
      x:
        ((((px + 0.866025404) % 1.732050808) + 1.732050808) % 1.732050808) -
        0.866025404,
      y: ((((py + 1.5) % 3) + 3) % 3) - 1.5,
    };
    const q = a.x * a.x + a.y * a.y < b.x * b.x + b.y * b.y ? a : b;
    const distance = Math.max(
      Math.abs(q.x) * 0.5 + Math.abs(q.y) * 0.866025404,
      Math.abs(q.x),
    );
    return clamp((distance - (0.866025404 - Number(p.thickness))) / 0.035);
  }
  if (type === "metaballs") {
    let field = 0;
    for (let i = 0; i < Number(p.count); i++) {
      const cx = 0.5 + Math.sin(t + i * 2.399) * 0.48,
        cy = 0.5 + Math.cos(t * 0.83 + i * 1.73) * 0.35;
      field +=
        Number(p.size) ** 2 / Math.max(0.0001, (u - cx) ** 2 + (v - cy) ** 2);
    }
    return clamp((field - 1) / Number(p.softness) + 0.5);
  }
  if (type === "conic_gradient")
    return fract(
      ((Math.atan2(y, x) - angle) / TAU + 0.5) * Number(p.cycles) + t,
    );
  if (type === "linear_gradient")
    return fract(
      ((u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle) + 0.5) *
        Number(p.cycles) +
        Number(p.offset) +
        t,
    );
  if (type === "plasma") {
    const base =
      (Math.sin(u * scale * TAU + t) + Math.sin(v * scale * TAU - t * 1.3)) / 2;
    const detail =
      (Math.sin((u + v) * scale * TAU * 0.7 + t * 2) +
        Math.sin(Math.hypot(u - 0.5, v - 0.5) * scale * TAU * 1.6 - t * 3)) /
      2;
    return clamp(0.5 + 0.5 * mix(base, detail, Number(p.complexity)));
  }
  return 0;
}

const palettes: Record<string, number[][]> = {
  neon: [
    [13, 15, 35],
    [117, 67, 247],
    [255, 75, 178],
    [46, 241, 227],
    [255, 240, 152],
  ],
  pastel: [
    [48, 45, 67],
    [180, 176, 242],
    [242, 182, 210],
    [165, 220, 202],
    [253, 234, 194],
  ],
  thermal: [
    [0, 0, 30],
    [50, 25, 170],
    [205, 20, 100],
    [250, 120, 20],
    [255, 245, 80],
    [255, 255, 255],
  ],
  mono: [
    [0, 0, 0],
    [85, 85, 85],
    [170, 170, 170],
    [255, 255, 255],
  ],
};
const pointTypes = new Set([
  "hue_shift",
  "saturation",
  "brightness",
  "exposure",
  "sepia",
  "duotone",
  "solarize",
  "color_balance",
  "channel_extract",
  "channel_shuffle",
  "luma_key",
  "color_curve",
  "color_quantize",
]);

/** In-place RGB operations. Alpha is preserved except when explicitly producing an alpha key. */
export function processAdvancedPixels(
  type: string,
  data: Uint8ClampedArray,
  params: Params,
): boolean {
  if (!pointTypes.has(type)) return false;
  const p = advancedParameters(type, params),
    light = rgb(p.color),
    dark = rgb(p.background);
  const amount = Number(p.amount ?? 1),
    gain = 2 ** Number(p.stops ?? 0),
    gamma = 1 / Number(p.gamma ?? 1);
  const shift = Number(p.angle ?? 0) / 360;
  const channel = (key: unknown, r: number, g: number, b: number, a: number) =>
    ({
      red: r,
      green: g,
      blue: b,
      alpha: a,
      zero: 0,
      one: 255,
      luma: luma(r, g, b),
    })[String(key)] ?? 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      a = data[i + 3],
      lum = luma(r, g, b);
    let nr = r,
      ng = g,
      nb = b;
    switch (type) {
      case "hue_shift": {
        const high = Math.max(r, g, b),
          low = Math.min(r, g, b),
          delta = high - low;
        let hue =
          delta === 0
            ? 0
            : (high === r
                ? (g - b) / delta
                : high === g
                  ? (b - r) / delta + 2
                  : (r - g) / delta + 4) / 6;
        hue = fract(hue + shift) * 6;
        const x = delta * (1 - Math.abs((hue % 2) - 1));
        const values =
          hue < 1
            ? [delta, x, 0]
            : hue < 2
              ? [x, delta, 0]
              : hue < 3
                ? [0, delta, x]
                : hue < 4
                  ? [0, x, delta]
                  : hue < 5
                    ? [x, 0, delta]
                    : [delta, 0, x];
        [nr, ng, nb] = values.map((value) => value + low);
        break;
      }
      case "saturation":
        nr = mix(lum, r, amount);
        ng = mix(lum, g, amount);
        nb = mix(lum, b, amount);
        break;
      case "brightness":
        nr += amount * 255;
        ng += amount * 255;
        nb += amount * 255;
        break;
      case "exposure":
        nr *= gain;
        ng *= gain;
        nb *= gain;
        break;
      case "sepia":
        nr = mix(r, r * 0.393 + g * 0.769 + b * 0.189, amount);
        ng = mix(g, r * 0.349 + g * 0.686 + b * 0.168, amount);
        nb = mix(b, r * 0.272 + g * 0.534 + b * 0.131, amount);
        break;
      case "duotone": {
        const f = (lum / 255) ** gamma;
        nr = mix(dark[0], light[0], f);
        ng = mix(dark[1], light[1], f);
        nb = mix(dark[2], light[2], f);
        break;
      }
      case "solarize": {
        const f = (v: number) =>
          v / 255 >= Number(p.threshold) ? mix(v, 255 - v, amount) : v;
        nr = f(r);
        ng = f(g);
        nb = f(b);
        break;
      }
      case "color_balance":
        nr *= Number(p.red);
        ng *= Number(p.green);
        nb *= Number(p.blue);
        break;
      case "channel_extract":
        nr = ng = nb = channel(p.channel, r, g, b, a);
        break;
      case "channel_shuffle":
        nr = channel(p.red, r, g, b, a);
        ng = channel(p.green, r, g, b, a);
        nb = channel(p.blue, r, g, b, a);
        break;
      case "luma_key": {
        const softness = Number(p.softness),
          threshold = Number(p.threshold);
        let mask =
          softness > 0
            ? clamp((lum / 255 - threshold) / softness + 0.5)
            : Number(lum / 255 >= threshold);
        if (p.keep === "dark") mask = 1 - mask;
        data[i + 3] = a * mask;
        break;
      }
      case "color_curve": {
        const curve = (v: number) => {
          const f = v / 255,
            t = f < 0.5 ? f * 2 : (f - 0.5) * 2;
          return (
            255 *
            mix(
              Number(f < 0.5 ? p.shadows : p.midtones),
              Number(f < 0.5 ? p.midtones : p.highlights),
              t * t * (3 - 2 * t),
            )
          );
        };
        nr = curve(r);
        ng = curve(g);
        nb = curve(b);
        break;
      }
      case "color_quantize": {
        let nearest = palettes[String(p.palette)][0],
          distance = Infinity;
        for (const color of palettes[String(p.palette)]) {
          const d =
            (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
          if (d < distance) {
            nearest = color;
            distance = d;
          }
        }
        nr = mix(r, nearest[0], amount);
        ng = mix(g, nearest[1], amount);
        nb = mix(b, nearest[2], amount);
        break;
      }
    }
    data[i] = nr;
    data[i + 1] = ng;
    data[i + 2] = nb;
  }
  return true;
}

/** Independent neighborhood implementation makes borders and impulse-noise removal testable. */
export function neighborhoodPixels(
  type: string,
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source.length),
    kernel = Math.max(1, Math.min(5, Math.round(radius)));
  const values: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        values.length = 0;
        let value = type === "erode" ? 255 : 0;
        for (let dy = -kernel; dy <= kernel; dy++)
          for (let dx = -kernel; dx <= kernel; dx++) {
            const q =
              source[
                (clamp(y + dy, 0, height - 1) * width +
                  clamp(x + dx, 0, width - 1)) *
                  4 +
                  channel
              ];
            if (type === "median_filter") values.push(q);
            else
              value =
                type === "erode" ? Math.min(value, q) : Math.max(value, q);
          }
        output[index + channel] =
          type === "median_filter"
            ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
            : value;
      }
      output[index + 3] = source[index + 3];
    }
  return output;
}

function workCanvas(
  state: Map<string, unknown>,
  key: string,
  width: number,
  height: number,
) {
  let canvas = state.get(key) as HTMLCanvasElement | undefined;
  if (!canvas) {
    canvas = document.createElement("canvas");
    state.set(key, canvas);
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

const compositeModes: Record<string, GlobalCompositeOperation> = {
  over: "source-over",
  add: "lighter",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  lighten: "lighten",
  darken: "darken",
  xor: "xor",
};

export function cookAdvancedVisualNode(args: VisualCook): boolean {
  const {
    node,
    ctx,
    input,
    input2,
    width: w,
    height: h,
    state,
    time,
    mod,
  } = args;
  const spec = specs.get(node.type);
  if (!spec) return false;
  const type = node.type,
    p = advancedParameters(type, node.data.params);
  ctx.clearRect(0, 0, w, h);
  if (type.startsWith("composite_")) {
    if (input) ctx.drawImage(input, 0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = Number(p.opacity);
    ctx.globalCompositeOperation = compositeModes[type.slice(10)];
    if (input2) ctx.drawImage(input2, 0, 0, w, h);
    ctx.restore();
    return true;
  }
  if (!spec.inputs.some((port) => port.kind === "TOP")) {
    const scale = Math.min(1, 256 / w),
      sw = Math.max(1, Math.round(w * scale)),
      sh = Math.max(1, Math.round(h * scale));
    const canvas = workCanvas(state, "advanced:field", sw, sh),
      wc = canvas.getContext("2d")!;
    const cacheKey = JSON.stringify([
      type,
      p,
      Math.floor(time * 30) / 30,
      mod,
      sw,
      sh,
    ]);
    if (state.get("advanced:field:key") !== cacheKey) {
      const image = wc.createImageData(sw, sh),
        color = rgb(p.color),
        background = rgb(p.background),
        aspect = w / h;
      for (let y = 0; y < sh; y++)
        for (let x = 0; x < sw; x++) {
          const u = (x / sw - 0.5) * aspect + 0.5,
            v = y / sh;
          const value = advancedGeneratorValue(
              type,
              u,
              v,
              Math.floor(time * 30) / 30,
              mod,
              p,
            ),
            i = (y * sw + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            image.data[i + channel] = mix(
              background[channel],
              color[channel],
              value,
            );
          image.data[i + 3] = 255;
        }
      wc.putImageData(image, 0, 0);
      state.set("advanced:field:key", cacheKey);
    }
    ctx.drawImage(canvas, 0, 0, w, h);
    return true;
  }
  if (!input) return true;
  if (pointTypes.has(type)) {
    ctx.drawImage(input, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    processAdvancedPixels(type, image.data, p);
    ctx.putImageData(image, 0, 0);
    return true;
  }
  if (["directional_blur", "radial_blur", "zoom_blur"].includes(type)) {
    const samples = Number(p.samples),
      angle = (Number(p.angle ?? 0) * Math.PI) / 180,
      cx = Number(p.x ?? 0.5) * w,
      cy = Number(p.y ?? 0.5) * h;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 / samples;
    for (let i = 0; i < samples; i++) {
      const f = i / (samples - 1) - 0.5;
      ctx.save();
      if (type === "directional_blur")
        ctx.translate(
          f * Number(p.distance) * Math.cos(angle),
          f * Number(p.distance) * Math.sin(angle),
        );
      else {
        ctx.translate(cx, cy);
        if (type === "radial_blur") ctx.rotate(f * angle);
        else {
          const z = 1 + (f + 0.5) * Number(p.amount);
          ctx.scale(z, z);
        }
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(input, 0, 0, w, h);
      ctx.restore();
    }
    ctx.restore();
    return true;
  }
  if (type === "scanlines") {
    ctx.drawImage(input, 0, 0, w, h);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${p.amount})`;
    const spacing = Number(p.spacing),
      offset = fract(time * Number(p.speed) + mod) * spacing;
    for (let y = offset - spacing; y < h; y += spacing)
      ctx.fillRect(0, y, w, Math.max(1, spacing * 0.35));
    ctx.restore();
    return true;
  }
  const scale = Math.min(1, 320 / w),
    sw = Math.max(1, Math.round(w * scale)),
    sh = Math.max(1, Math.round(h * scale));
  const source = workCanvas(state, "advanced:source", sw, sh),
    sc = source.getContext("2d", { willReadFrequently: true })!;
  sc.clearRect(0, 0, sw, sh);
  sc.drawImage(input, 0, 0, sw, sh);
  const image = sc.getImageData(0, 0, sw, sh);
  if (type === "halftone") {
    const size = Number(p.size),
      step = Math.max(1, size * scale);
    ctx.fillStyle = String(p.background);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = String(p.color);
    for (let y = step / 2; y < sh; y += step)
      for (let x = step / 2; x < sw; x += step) {
        const i = (Math.floor(y) * sw + Math.floor(x)) * 4,
          value =
            luma(image.data[i], image.data[i + 1], image.data[i + 2]) / 255;
        ctx.globalAlpha = image.data[i + 3] / 255;
        ctx.beginPath();
        ctx.arc(x / scale, y / scale, size * 0.49 * Math.sqrt(value), 0, TAU);
        ctx.fill();
      }
    ctx.globalAlpha = 1;
    return true;
  }
  const output = sc.createImageData(sw, sh);
  if (["median_filter", "dilate", "erode"].includes(type))
    output.data.set(
      neighborhoodPixels(type, image.data, sw, sh, Number(p.radius)),
    );
  else {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const aspect = sw / sh,
      cx = Number(p.x ?? 0.5),
      cy = Number(p.y ?? 0.5),
      t = time * Number(p.speed ?? 0) + mod;
    const get = (u: number, v: number, channel: number) =>
      image.data[
        (clamp(Math.round(v * (sh - 1)), 0, sh - 1) * sw +
          clamp(Math.round(u * (sw - 1)), 0, sw - 1)) *
          4 +
          channel
      ];
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const u = x / Math.max(1, sw - 1),
          v = y / Math.max(1, sh - 1),
          index = (y * sw + x) * 4;
        if (type === "bayer_dither") {
          const cell = Number(p.scale),
            levels = Number(p.levels) - 1;
          const threshold =
            (bayer[
              (Math.floor(y / cell) % 4) * 4 + (Math.floor(x / cell) % 4)
            ] +
              0.5) /
              16 -
            0.5;
          const value =
            clamp(
              Math.round(
                (luma(
                  image.data[index],
                  image.data[index + 1],
                  image.data[index + 2],
                ) /
                  255) *
                  levels +
                  threshold,
              ) / levels,
            ) * 255;
          output.data[index] =
            output.data[index + 1] =
            output.data[index + 2] =
              value;
          output.data[index + 3] = image.data[index + 3];
          continue;
        }
        const dx = (u - cx) * aspect,
          dy = v - cy,
          radius = Math.hypot(dx, dy),
          theta = Math.atan2(dy, dx);
        let su = u,
          sv = v;
        if (type === "barrel") {
          const factor = 1 + Number(p.amount) * radius * radius;
          su = cx + (dx * factor) / aspect;
          sv = cy + dy * factor;
        } else if (type === "swirl") {
          const turn =
            theta +
            Number(p.amount) *
              TAU *
              Math.max(0, 1 - radius / Number(p.radius)) ** 2;
          su = cx + (Math.cos(turn) * radius) / aspect;
          sv = cy + Math.sin(turn) * radius;
        } else if (type === "bulge") {
          const factor =
            radius < Number(p.radius)
              ? 1 - Number(p.amount) * (1 - radius / Number(p.radius)) ** 2
              : 1;
          su = cx + (dx * factor) / aspect;
          sv = cy + dy * factor;
        } else if (type === "polar") {
          const angle = (Number(p.angle) * Math.PI) / 180;
          if (p.direction === "to_polar") {
            su = fract((theta + angle) / TAU + 0.5);
            sv = (radius * 2) / Number(p.radius);
          } else {
            const a = (u - 0.5) * TAU - angle,
              r = (v * Number(p.radius)) / 2;
            su = 0.5 + (Math.cos(a) * r) / aspect;
            sv = 0.5 + Math.sin(a) * r;
          }
        } else if (type === "sine_warp") {
          su +=
            Math.sin(v * Number(p.frequency) * TAU + t * TAU) *
            Number(p.amplitude);
          sv +=
            Math.sin(u * Number(p.frequency) * TAU - t * TAU) *
            Number(p.amplitude);
        } else if (type === "glitch") {
          const band = Math.floor(v * Number(p.bands)),
            random = hash(band, Math.floor(t * 24), Number(p.seed));
          const offset = (random - 0.5) * Number(p.amount);
          su = fract(u + offset);
          output.data[index] = get(fract(su + Number(p.amount) * 0.04), sv, 0);
          output.data[index + 1] = get(su, sv, 1);
          output.data[index + 2] = get(
            fract(su - Number(p.amount) * 0.04),
            sv,
            2,
          );
          output.data[index + 3] = get(su, sv, 3);
          continue;
        }
        for (let channel = 0; channel < 4; channel++)
          output.data[index + channel] = get(su, sv, channel);
      }
  }
  sc.putImageData(output, 0, 0);
  ctx.drawImage(source, 0, 0, w, h);
  return true;
}
