import type { GraphNode, Params } from "../types";
import { visualCatalog } from "./visualCatalog";

const specs = new Map(visualCatalog.map((spec) => [spec.type, spec]));
const TAU = Math.PI * 2;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const finite = (x: unknown, fallback = 0) =>
  Number.isFinite(Number(x)) ? Number(x) : fallback;
const wrap = (value: number, size: number) => ((value % size) + size) % size;

function parameters(type: string, params: Params): Params {
  const result: Params = {};
  for (const param of specs.get(type)?.params ?? []) {
    const raw = params[param.key] ?? param.default;
    if (param.type === "number") {
      const value = clamp(
        finite(raw, Number(param.default)),
        param.min ?? -1e6,
        param.max ?? 1e6,
      );
      result[param.key] = param.step === 1 ? Math.round(value) : value;
    } else if (param.type === "color") {
      result[param.key] = /^#[\da-f]{6}$/i.test(String(raw))
        ? String(raw)
        : param.default;
    } else if (param.options) {
      result[param.key] = param.options.includes(String(raw))
        ? String(raw)
        : param.default;
    } else result[param.key] = raw;
  }
  return result;
}

const rgb = (value: string) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/** Point operations are separated from Canvas so exact pixel behavior can be verified. */
export function processColorPixels(
  type: string,
  data: Uint8ClampedArray,
  params: Params,
): boolean {
  const pointTypes = [
    "invert",
    "grayscale",
    "threshold",
    "posterize",
    "gamma",
    "contrast",
    "levels",
    "chroma_key",
  ];
  if (!pointTypes.includes(type)) return false;
  const p = parameters(type, params);
  const amount = Number(p.amount ?? 1);
  if (["invert", "posterize", "gamma", "contrast", "levels"].includes(type)) {
    const lut = new Uint8ClampedArray(256);
    const steps = Number(p.steps) - 1;
    const gamma = 1 / Number(p.gamma);
    const black = Number(p.black),
      white = Math.max(black + 0.001, Number(p.white));
    for (let i = 0; i < 256; i++) {
      const value = i / 255;
      switch (type) {
        case "invert":
          lut[i] = i + (255 - 2 * i) * amount;
          break;
        case "posterize":
          lut[i] = (Math.round(value * steps) / steps) * 255;
          break;
        case "gamma":
          lut[i] = Math.pow(value, gamma) * 255;
          break;
        case "contrast":
          lut[i] = ((value - Number(p.pivot)) * amount + Number(p.pivot)) * 255;
          break;
        case "levels":
          lut[i] =
            (Number(p.out_black) +
              Math.pow(clamp((value - black) / (white - black)), gamma) *
                (Number(p.out_white) - Number(p.out_black))) *
            255;
          break;
      }
    }
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  } else if (type === "chroma_key") {
    const [r, g, b] = rgb(String(p.color));
    const tolerance = Number(p.tolerance),
      softness = Number(p.softness);
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - r,
        dg = data[i + 1] - g,
        db = data[i + 2] - b;
      const distance = Math.sqrt(
        (dr * dr + dg * dg + db * db) / (3 * 255 * 255),
      );
      data[i + 3] *=
        softness > 0
          ? clamp((distance - tolerance) / softness)
          : Number(distance > tolerance);
    }
  } else {
    const threshold = Number(p.threshold ?? 0.5),
      softness = Number(p.softness ?? 0);
    for (let i = 0; i < data.length; i += 4) {
      const luma =
        0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (type === "grayscale") {
        data[i] += (luma - data[i]) * amount;
        data[i + 1] += (luma - data[i + 1]) * amount;
        data[i + 2] += (luma - data[i + 2]) * amount;
      } else {
        const value =
          255 *
          (softness > 0
            ? clamp((luma / 255 - threshold) / softness + 0.5)
            : Number(luma / 255 >= threshold));
        data[i] = data[i + 1] = data[i + 2] = value;
      }
    }
  }
  return true;
}

export type VisualCook = {
  node: GraphNode;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  input: HTMLCanvasElement | undefined;
  input2: HTMLCanvasElement | undefined;
  input3?: HTMLCanvasElement;
  time: number;
  mod: number;
  width: number;
  height: number;
  state: Map<string, unknown>;
};

export function cookVisualNode(args: VisualCook): boolean {
  const { node, ctx, canvas, input, input2, width: w, height: h, state } = args;
  const type = node.type;
  if (!specs.has(type)) return false;
  const p = parameters(type, node.data.params);
  const n = (key: string) => Number(p[key]);
  const s = (key: string) => String(p[key]);
  const time = finite(args.time),
    mod = clamp(finite(args.mod), -1e4, 1e4);
  const scratch = (key: string, width = w, height = h) => {
    let target = state.get(key) as HTMLCanvasElement | undefined;
    if (!target) {
      target = document.createElement("canvas");
      state.set(key, target);
    }
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    return target;
  };
  const draw = (source = input) => {
    if (source) ctx.drawImage(source, 0, 0, w, h);
    else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
    }
  };
  const pixels = (source: HTMLCanvasElement | undefined, key: string) => {
    const target = scratch(key),
      context = target.getContext("2d", { willReadFrequently: true })!;
    context.clearRect(0, 0, w, h);
    if (source) context.drawImage(source, 0, 0, w, h);
    else {
      context.fillStyle = "#000000";
      context.fillRect(0, 0, w, h);
    }
    return context.getImageData(0, 0, w, h);
  };
  const background = () => {
    ctx.fillStyle = s("background");
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s("color");
    ctx.strokeStyle = s("color");
  };
  // Clear the engine's opaque placeholder so alpha-producing operators remain composable.
  ctx.clearRect(0, 0, w, h);
  if (type === "solid") {
    ctx.globalAlpha = n("alpha");
    ctx.fillStyle = s("color");
    ctx.fillRect(0, 0, w, h);
  } else if (type === "checkerboard") {
    background();
    const columns = n("columns"),
      rows = n("rows");
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++)
        if ((x + y) % 2 === 0) {
          const x0 = Math.floor((x * w) / columns),
            y0 = Math.floor((y * h) / rows);
          ctx.fillRect(
            x0,
            y0,
            Math.ceil(((x + 1) * w) / columns) - x0,
            Math.ceil(((y + 1) * h) / rows) - y0,
          );
        }
  } else if (type === "grid" || type === "stripes") {
    background();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((n("angle") * Math.PI) / 180);
    const extent = Math.hypot(w, h),
      spacing = type === "grid" ? n("spacing") : w / n("count");
    const offset =
      type === "stripes" ? wrap(time * n("speed") + mod, 1) * spacing : 0;
    const start = -Math.ceil(extent / spacing) * spacing;
    ctx.lineWidth = type === "grid" ? n("thickness") : 1;
    ctx.beginPath();
    for (let x = start; x <= extent; x += spacing) {
      if (type === "stripes")
        ctx.fillRect(x + offset, -extent, spacing * n("duty"), extent * 2);
      else {
        ctx.moveTo(x, -extent);
        ctx.lineTo(x, extent);
        ctx.moveTo(-extent, x);
        ctx.lineTo(extent, x);
      }
    }
    if (type === "grid") ctx.stroke();
  } else if (["circle", "rectangle", "polygon", "star"].includes(type)) {
    background();
    ctx.translate(n("x") * w, n("y") * h);
    ctx.beginPath();
    if (type === "circle")
      ctx.ellipse(0, 0, (n("width") * w) / 2, (n("height") * h) / 2, 0, 0, TAU);
    else if (type === "rectangle") {
      const rw = n("width") * w,
        rh = n("height") * h;
      ctx.roundRect(
        -rw / 2,
        -rh / 2,
        rw,
        rh,
        Math.min(n("radius"), rw / 2, rh / 2),
      );
    } else {
      const count = type === "star" ? n("points") * 2 : n("sides");
      const angle = ((n("angle") + mod * 180) * Math.PI) / 180 - Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const a = angle + (i / count) * TAU;
        const radius =
          n("radius") *
          Math.min(w, h) *
          (type === "star" && i % 2 ? n("inner") : 1);
        const x = Math.cos(a) * radius,
          y = Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    if (Number(p.stroke ?? 0) > 0) {
      ctx.lineWidth = n("stroke");
      ctx.stroke();
    } else ctx.fill();
  } else if (type === "radial_ramp") {
    const x = n("x") * w,
      y = n("y") * h;
    const gradient = ctx.createRadialGradient(
      x,
      y,
      0,
      x,
      y,
      Math.min(w, h) * n("radius"),
    );
    gradient.addColorStop(0, s("color"));
    gradient.addColorStop(1, s("background"));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  } else if (type === "rings") {
    background();
    ctx.lineWidth = n("thickness");
    const spacing = n("spacing"),
      offset = wrap(time * n("speed") + mod, 1) * spacing;
    const x = n("x") * w,
      y = n("y") * h;
    ctx.beginPath();
    for (let r = offset; r <= Math.hypot(w, h) + spacing; r += spacing) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.stroke();
  } else if (type === "wave") {
    background();
    ctx.lineWidth = n("thickness");
    const count = n("count"),
      amplitude = n("amplitude") * h,
      frequency = n("frequency");
    const phase = (time * n("speed") + mod) * TAU;
    ctx.beginPath();
    for (let row = 0; row < count; row++)
      for (let x = 0; x <= w; x += 2) {
        const y =
          ((row + 1) / (count + 1)) * h +
          Math.sin((x / w) * frequency * TAU + phase + row * 0.35) * amplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    ctx.stroke();
  } else if (type === "vignette") {
    const frame = pixels(input, "source"),
      d = frame.data;
    const cx = n("x") * w,
      cy = n("y") * h,
      radius = n("radius"),
      amount = n("amount");
    const scale = Math.max(w, h) / 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          t = clamp(
            (Math.hypot(x - cx, y - cy) / scale - radius) / (1 - radius),
          );
        const gain = 1 - amount * t * t * (3 - 2 * t);
        d[i] *= gain;
        d[i + 1] *= gain;
        d[i + 2] *= gain;
      }
    ctx.putImageData(frame, 0, 0);
  } else if (
    [
      "invert",
      "grayscale",
      "threshold",
      "posterize",
      "gamma",
      "contrast",
      "levels",
      "chroma_key",
    ].includes(type)
  ) {
    const frame = pixels(input, "source");
    processColorPixels(type, frame.data, p);
    ctx.putImageData(frame, 0, 0);
  } else if (["sharpen", "edge", "emboss"].includes(type)) {
    const source = pixels(input, "source"),
      d = source.data,
      frame = ctx.createImageData(w, h),
      out = frame.data;
    const amount = n("amount"),
      angle = (n("angle") * Math.PI) / 180;
    const dx = Math.round(Math.cos(angle)),
      dy = Math.round(Math.sin(angle));
    const threshold = Number(p.threshold ?? 0) * 255;
    const luma = (i: number) =>
      d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          left = Math.max(0, x - 1),
          right = Math.min(w - 1, x + 1),
          top = Math.max(0, y - 1),
          bottom = Math.min(h - 1, y + 1);
        if (type === "sharpen") {
          const a = (y * w + left) * 4,
            b = (y * w + right) * 4,
            c = (top * w + x) * 4,
            e = (bottom * w + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            out[i + channel] =
              d[i + channel] * (1 + 4 * amount) -
              amount *
                (d[a + channel] +
                  d[b + channel] +
                  d[c + channel] +
                  d[e + channel]);
        } else if (type === "edge") {
          const tl = luma((top * w + left) * 4),
            tc = luma((top * w + x) * 4),
            tr = luma((top * w + right) * 4);
          const ml = luma((y * w + left) * 4),
            mr = luma((y * w + right) * 4);
          const bl = luma((bottom * w + left) * 4),
            bc = luma((bottom * w + x) * 4),
            br = luma((bottom * w + right) * 4);
          const value = Math.max(
            0,
            Math.hypot(
              tr + 2 * mr + br - tl - 2 * ml - bl,
              bl + 2 * bc + br - tl - 2 * tc - tr,
            ) *
              amount -
              threshold,
          );
          out[i] = out[i + 1] = out[i + 2] = value;
        } else {
          const a = (clamp(y - dy, 0, h - 1) * w + clamp(x - dx, 0, w - 1)) * 4;
          const b = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4;
          out[i] = out[i + 1] = out[i + 2] = 128 + (luma(b) - luma(a)) * amount;
        }
        out[i + 3] = d[i + 3];
      }
    ctx.putImageData(frame, 0, 0);
  } else if (type === "pixelate") {
    if (!input) {
      draw();
      return true;
    }
    const small = scratch(
      "small",
      Math.max(1, Math.round(w / n("size"))),
      Math.max(1, Math.round(h / n("size"))),
    );
    const smallCtx = small.getContext("2d")!;
    smallCtx.clearRect(0, 0, small.width, small.height);
    smallCtx.drawImage(input, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w, h);
  } else if (type === "flip" || type === "rotate") {
    if (type === "flip") {
      ctx.translate(w / 2, h / 2);
      ctx.scale(
        s("axis") !== "vertical" ? -1 : 1,
        s("axis") !== "horizontal" ? -1 : 1,
      );
      ctx.translate(-w / 2, -h / 2);
    } else {
      const cx = n("x") * w,
        cy = n("y") * h;
      ctx.translate(cx, cy);
      ctx.rotate(
        (n("angle") * Math.PI) / 180 + time * n("speed") * TAU + mod * Math.PI,
      );
      ctx.scale(n("scale"), n("scale"));
      ctx.translate(-cx, -cy);
    }
    draw();
  } else if (type === "crop") {
    if (!input) {
      draw();
      return true;
    }
    const x = n("x"),
      y = n("y");
    ctx.drawImage(
      input,
      x * input.width,
      y * input.height,
      Math.min(n("width"), 1 - x) * input.width,
      Math.min(n("height"), 1 - y) * input.height,
      0,
      0,
      w,
      h,
    );
  } else if (type === "fit") {
    ctx.fillStyle = s("background");
    ctx.fillRect(0, 0, w, h);
    if (input) {
      const aspect = n("aspect"),
        fw = Math.min(w, h * aspect),
        fh = Math.min(h, w / aspect),
        x = (w - fw) / 2,
        y = (h - fh) / 2;
      ctx.beginPath();
      ctx.rect(x, y, fw, fh);
      ctx.clip();
      if (s("mode") === "stretch") ctx.drawImage(input, x, y, fw, fh);
      else {
        const ratio =
          s("mode") === "cover"
            ? Math.max(fw / input.width, fh / input.height)
            : Math.min(fw / input.width, fh / input.height);
        const iw = input.width * ratio,
          ih = input.height * ratio;
        ctx.drawImage(input, (w - iw) / 2, (h - ih) / 2, iw, ih);
      }
    }
  } else if (type === "feedback") {
    const previous = scratch("previous"),
      prevCtx = previous.getContext("2d")!;
    const previousTime = state.get("feedbackTime");
    if (typeof previousTime === "number" && time < previousTime)
      prevCtx.clearRect(0, 0, w, h);
    state.set("feedbackTime", time);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    if (n("decay") > 0) {
      ctx.save();
      ctx.globalAlpha = n("decay");
      ctx.translate(w / 2, h / 2);
      ctx.rotate((n("angle") * Math.PI) / 180);
      ctx.scale(n("zoom"), n("zoom"));
      ctx.drawImage(previous, -w / 2, -h / 2);
      ctx.restore();
    }
    if (input) {
      ctx.globalAlpha = n("input_gain");
      // Blend the new frame over history without burning static images to white.
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(input, 0, 0, w, h);
    }
    prevCtx.clearRect(0, 0, w, h);
    prevCtx.drawImage(canvas, 0, 0);
  } else if (type === "switch_top") {
    const mix = clamp(n("index") + mod);
    ctx.globalAlpha = 1 - mix;
    draw(input);
    ctx.globalAlpha = mix;
    ctx.globalCompositeOperation = "lighter";
    if (input2) ctx.drawImage(input2, 0, 0, w, h);
    else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
    }
  } else if (type === "null_top") {
    draw();
  } else {
    const source = pixels(input, "source"),
      d = source.data;
    const frame = ctx.createImageData(w, h),
      out = frame.data;
    const aux = ["displace", "mask", "difference"].includes(type)
      ? pixels(input2, "second").data
      : undefined;
    const axis = s("axis"),
      segments = n("segments"),
      zoom = n("zoom");
    const sector = TAU / segments,
      angle = ((Number(p.angle ?? 0) + mod * 180) * Math.PI) / 180;
    const dx = Math.cos(angle) * n("distance"),
      dy = Math.sin(angle) * n("distance");
    const columns = n("columns"),
      rows = n("rows"),
      shiftX = n("x"),
      shiftY = n("y");
    const repeat = s("wrap") === "repeat";
    const maskUsesAlpha = s("mode") === "alpha";
    const invertMask = n("invert") === 1;
    const differenceGain = n("gain");
    const indexAt = (x: number, y: number, repeating = false) =>
      ((repeating ? wrap(Math.round(y), h) : clamp(Math.round(y), 0, h - 1)) *
        w +
        (repeating ? wrap(Math.round(x), w) : clamp(Math.round(x), 0, w - 1))) *
      4;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let sourceIndex = i;
        if (type === "mirror") {
          const sx = axis !== "vertical" && x >= w / 2 ? w - 1 - x : x;
          const sy = axis !== "horizontal" && y >= h / 2 ? h - 1 - y : y;
          sourceIndex = (sy * w + sx) * 4;
        } else if (type === "kaleidoscope") {
          const px = x - w / 2,
            py = y - h / 2,
            radius = Math.hypot(px, py) / zoom;
          const a = wrap(Math.atan2(py, px) - angle, sector);
          const folded = Math.min(a, sector - a) + angle;
          sourceIndex = indexAt(
            w / 2 + Math.cos(folded) * radius,
            h / 2 + Math.sin(folded) * radius,
            true,
          );
        } else if (type === "tile")
          sourceIndex = indexAt(
            wrap((x / w) * columns + shiftX, 1) * (w - 1),
            wrap((y / h) * rows + shiftY, 1) * (h - 1),
          );
        else if (type === "displace" && input2 && aux)
          sourceIndex = indexAt(
            x + ((aux[i] - 127.5) / 127.5) * shiftX * w,
            y + ((aux[i + 1] - 127.5) / 127.5) * shiftY * h,
            repeat,
          );
        out[i] = d[sourceIndex];
        out[i + 1] = d[sourceIndex + 1];
        out[i + 2] = d[sourceIndex + 2];
        out[i + 3] = d[sourceIndex + 3];
        if (type === "rgb_split") {
          out[i] = d[indexAt(x - dx, y - dy)];
          out[i + 2] = d[indexAt(x + dx, y + dy) + 2];
        } else if (type === "mask" && aux) {
          let value = !input2
            ? 0
            : maskUsesAlpha
              ? aux[i + 3] / 255
              : ((aux[i] * 0.2126 + aux[i + 1] * 0.7152 + aux[i + 2] * 0.0722) /
                  255) *
                (aux[i + 3] / 255);
          if (invertMask) value = 1 - value;
          out[i + 3] *= value;
        } else if (type === "difference" && aux) {
          out[i] = Math.abs(d[i] - aux[i]) * differenceGain;
          out[i + 1] = Math.abs(d[i + 1] - aux[i + 1]) * differenceGain;
          out[i + 2] = Math.abs(d[i + 2] - aux[i + 2]) * differenceGain;
          out[i + 3] = Math.max(d[i + 3], aux[i + 3]);
        }
      }
    ctx.putImageData(frame, 0, 0);
  }
  return true;
}
