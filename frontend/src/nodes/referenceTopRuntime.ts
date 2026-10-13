import type { VisualCook } from "./visual";
import { referenceTopCatalog } from "./referenceTopCatalog";

const specs = new Map(referenceTopCatalog.map((s) => [s.type, s]));
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const gray = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;
const fract = (x: number) => x - Math.floor(x);
export type ComplexImage = {
  size: number;
  real: Float64Array;
  imag: Float64Array;
};
type History = { frames: HTMLCanvasElement[]; time: number };
const histories = new WeakMap<HTMLCanvasElement, History>();
const spectra = new WeakMap<HTMLCanvasElement, ComplexImage>();

/** In-place radix-2 Cooley-Tukey transform, with normalized inverse. */
export function fft1D(real: Float64Array, imag: Float64Array, inverse = false) {
  const n = real.length;
  if (n !== imag.length || n < 1 || n & (n - 1))
    throw new Error("FFT长度必须为2的幂");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let ur = 1,
        ui = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j,
          b = a + len / 2,
          vr = real[b] * ur - imag[b] * ui,
          vi = real[b] * ui + imag[b] * ur;
        real[b] = real[a] - vr;
        imag[b] = imag[a] - vi;
        real[a] += vr;
        imag[a] += vi;
        const next = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
}
export function fft2D(value: ComplexImage, inverse = false): ComplexImage {
  const { size: n } = value;
  if (value.real.length !== n * n || value.imag.length !== n * n)
    throw new Error("二维FFT尺寸不匹配");
  const real = value.real.slice(),
    imag = value.imag.slice(),
    r = new Float64Array(n),
    m = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(real.subarray(y * n, (y + 1) * n));
    m.set(imag.subarray(y * n, (y + 1) * n));
    fft1D(r, m, inverse);
    real.set(r, y * n);
    imag.set(m, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = real[y * n + x];
      m[y] = imag[y * n + x];
    }
    fft1D(r, m, inverse);
    for (let y = 0; y < n; y++) {
      real[y * n + x] = r[y];
      imag[y * n + x] = m[y];
    }
  }
  return { size: n, real, imag };
}
export function convolvePixels(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  kernel: number[][],
  divisor = 1,
  bias = 0,
) {
  const size = kernel.length;
  if (
    ![3, 5].includes(size) ||
    kernel.some(
      (row) => row.length !== size || row.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("卷积核必须是有限数值的3×3或5×5矩阵");
  if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-9)
    throw new Error("卷积除数不能为0");
  const result = new Uint8ClampedArray(data.length),
    half = size >> 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let j = 0; j < size; j++)
          for (let i = 0; i < size; i++)
            sum +=
              data[
                (clamp(y + j - half, 0, h - 1) * w +
                  clamp(x + i - half, 0, w - 1)) *
                  4 +
                  c
              ] * kernel[j][i];
        result[(y * w + x) * 4 + c] = sum / divisor + bias * 255;
      }
      result[(y * w + x) * 4 + 3] = data[(y * w + x) * 4 + 3];
    }
  return result;
}
export function rgbToHSV(r: number, g: number, b: number): number[] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d)
    h =
      max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [fract(h / 6), max ? d / max : 0, max];
}
export function hsvToRGB(h: number, s: number, v: number): number[] {
  const f = (k: number) => {
    const n = (k + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(n, 4 - n, 1));
  };
  return [f(5), f(3), f(1)];
}
export function solveHomography(destination: number[][]): number[] {
  if (
    destination.length !== 4 ||
    destination.some(
      (p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("四角需4个二维坐标");
  const source = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    matrix: number[][] = [];
  destination.forEach(([x, y], i) => {
    const [u, v] = source[i];
    matrix.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++)
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col]))
        pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const scale = matrix[col][col];
    if (Math.abs(scale) < 1e-9)
      throw new Error("Corner Pin四角退化，无法计算投影");
    for (let k = col; k <= 8; k++) matrix[col][k] /= scale;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const f = matrix[row][col];
      for (let k = col; k <= 8; k++) matrix[row][k] -= f * matrix[col][k];
    }
  }
  return matrix.map((row) => row[8]).concat(1);
}
export type BlobRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  cx: number;
  cy: number;
};
export function findBlobs(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
  minArea: number,
): BlobRegion[] {
  const marked = new Uint8Array(w * h),
    regions: BlobRegion[] = [],
    queue = new Int32Array(w * h);
  const bright = (i: number) =>
    gray(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= threshold * 255 &&
    data[i * 4 + 3] > 0;
  for (let origin = 0; origin < w * h; origin++) {
    if (marked[origin] || !bright(origin)) continue;
    let read = 0,
      size = 1;
    queue[0] = origin;
    marked[origin] = 1;
    let left = w,
      right = 0,
      top = h,
      bottom = 0,
      sx = 0,
      sy = 0;
    while (read < size) {
      const i = queue[read++],
        x = i % w,
        y = Math.floor(i / w);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      sx += x;
      sy += y;
      for (const j of [
        x ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ])
        if (j >= 0 && !marked[j] && bright(j)) {
          marked[j] = 1;
          queue[size++] = j;
        }
    }
    if (size >= minArea)
      regions.push({
        x: left,
        y: top,
        width: right - left + 1,
        height: bottom - top + 1,
        area: size,
        cx: sx / size,
        cy: sy / size,
      });
  }
  return regions.sort((a, b) => b.area - a.area).slice(0, 128);
}
export function opticalFlow(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const dx = new Float32Array(w * h),
    dy = new Float32Array(w * h),
    dt = new Float32Array(w * h),
    flow = new Float32Array(w * h * 2);
  const l = (p: Uint8ClampedArray, x: number, y: number) => {
    const i = (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
    return gray(p[i], p[i + 1], p[i + 2]) / 255;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dx[i] =
        (l(current, x + 1, y) -
          l(current, x - 1, y) +
          l(previous, x + 1, y) -
          l(previous, x - 1, y)) /
        4;
      dy[i] =
        (l(current, x, y + 1) -
          l(current, x, y - 1) +
          l(previous, x, y + 1) -
          l(previous, x, y - 1)) /
        4;
      dt[i] = l(current, x, y) - l(previous, x, y);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let xx = 0,
        xy = 0,
        yy = 0,
        xt = 0,
        yt = 0;
      for (let j = -radius; j <= radius; j++)
        for (let k = -radius; k <= radius; k++) {
          const i = clamp(y + j, 0, h - 1) * w + clamp(x + k, 0, w - 1);
          xx += dx[i] * dx[i];
          xy += dx[i] * dy[i];
          yy += dy[i] * dy[i];
          xt += dx[i] * dt[i];
          yt += dy[i] * dt[i];
        }
      const det = xx * yy - xy * xy;
      if (det > 1e-6) {
        flow[(y * w + x) * 2] = (-yy * xt + xy * yt) / det;
        flow[(y * w + x) * 2 + 1] = (xy * xt - xx * yt) / det;
      }
    }
  return flow;
}
type ShaderState = {
  tag: "reference-top-shader";
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  textures: WebGLTexture[];
  source: string;
};
export function disposeReferenceTopState(state: Map<string, unknown>) {
  for (const value of state.values()) {
    const metadata = value as { tag?: string; canvas?: HTMLCanvasElement };
    if (metadata?.tag === "reference-top-output" && metadata.canvas) {
      histories.delete(metadata.canvas);
      spectra.delete(metadata.canvas);
      continue;
    }
    const s = value as ShaderState;
    if (s?.tag !== "reference-top-shader") continue;
    s.textures.forEach((t) => s.gl.deleteTexture(t));
    s.gl.deleteProgram(s.program);
    s.gl.deleteShader(s.vertex);
    s.gl.deleteShader(s.fragment);
    s.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
function shaderRender(args: VisualCook, source: string) {
  const { state, width: w, height: h, input, input2 } = args;
  let saved = state.get("glsl") as ShaderState | undefined;
  if (saved && saved.source !== source) {
    disposeReferenceTopState(new Map([["glsl", saved]]));
    saved = undefined;
    state.delete("glsl");
  }
  if (!saved) {
    const canvas = document.createElement("canvas"),
      gl = canvas.getContext("webgl2", {
        preserveDrawingBuffer: true,
        alpha: true,
        premultipliedAlpha: false,
      });
    if (!gl) throw new Error("此浏览器不支持WebGL2着色器");
    const compile = (type: number, code: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`GLSL编译失败：${error}`);
      }
      return shader;
    };
    let vertex: WebGLShader | undefined,
      fragment: WebGLShader | undefined,
      program: WebGLProgram | undefined;
    try {
      vertex = compile(
        gl.VERTEX_SHADER,
        "#version 300 es\nout vec2 vUV;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.0-1.0,0,1);}",
      );
      fragment = compile(gl.FRAGMENT_SHADER, source);
      program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(`GLSL链接失败：${gl.getProgramInfoLog(program)}`);
      saved = {
        tag: "reference-top-shader",
        canvas,
        gl,
        program,
        vertex,
        fragment,
        textures: [gl.createTexture()!, gl.createTexture()!],
        source,
      };
      state.set("glsl", saved);
    } catch (error) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program) gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw error;
    }
  }
  const { gl, program, canvas } = saved;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(program);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  [input, input2].forEach((image, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, saved!.textures[i]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (image)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]),
      );
    gl.uniform1i(gl.getUniformLocation(program, `uInput${i}`), i);
  });
  gl.uniform2f(gl.getUniformLocation(program, "uResolution"), w, h);
  gl.uniform1f(gl.getUniformLocation(program, "uTime"), args.time);
  gl.uniform1f(gl.getUniformLocation(program, "uMod"), args.mod);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`WebGL绘制错误 ${error}`);
  args.ctx.drawImage(canvas, 0, 0, w, h);
}

export type ReferenceTopCook = VisualCook & {
  rawInput?: unknown;
  resolveNode?: (path: string) => unknown;
  resolveRenderPass?: (
    source: HTMLCanvasElement,
    pass: "color" | "depth" | "normal",
  ) => HTMLCanvasElement | undefined;
  resolveImportedTexture?: (
    parent: string,
    texture: string,
  ) => HTMLCanvasElement | undefined;
  resolveNodeView?: (path: string) => HTMLCanvasElement | undefined;
};
export function cookReferenceTopNode(args: ReferenceTopCook): boolean {
  const { node, canvas, ctx, input, input2, state } = args,
    spec = specs.get(node.type);
  if (!spec) return false;
  state.set("reference-top-output", { tag: "reference-top-output", canvas });
  const p = {
    ...Object.fromEntries(spec.params.map((p) => [p.key, p.default])),
    ...node.data.params,
  };
  const n = (k: string) => Number(p[k]),
    s = (k: string) => String(p[k]);
  const type = spec.english;
  let w = args.width,
    h = args.height;
  const scratch = (key: string, width: number, height: number) => {
    let c = state.get(key) as HTMLCanvasElement | undefined;
    if (!c) {
      c = document.createElement("canvas");
      state.set(key, c);
    }
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    return c;
  };
  const read = (
    source: HTMLCanvasElement | undefined,
    width: number,
    height: number,
    key = "pixels",
  ) => {
    const c = scratch(key, width, height),
      context = c.getContext("2d", { willReadFrequently: true })!;
    context.clearRect(0, 0, width, height);
    if (source) context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const paint = (data: Uint8ClampedArray, width: number, height: number) => {
    const c = scratch("result", width, height),
      context = c.getContext("2d")!;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(data), width, height),
      0,
      0,
    );
    ctx.drawImage(c, 0, 0, w, h);
  };
  if (type === "Import Select") {
    const texture = args.resolveImportedTexture?.(s("parent"), s("texture"));
    if (!texture)
      throw new Error(
        "未找到已导入模型的材质贴图；请指定模型节点和该模型已有的map名称",
      );
    ctx.drawImage(texture, 0, 0, w, h);
    return true;
  }
  if (type === "OP Viewer") {
    if (!s("source")) throw new Error("OP Viewer需要节点路径");
    const preview = args.resolveNodeView?.(s("source"));
    if (preview) {
      ctx.drawImage(preview, 0, 0, w, h);
      return true;
    }
    const value = args.resolveNode?.(s("source")) as any;
    if (value === undefined) throw new Error("OP Viewer找不到指定节点输出");
    if (value instanceof HTMLCanvasElement) {
      ctx.drawImage(value, 0, 0, w, h);
      return true;
    }
    ctx.fillStyle = "#101720";
    ctx.fillRect(0, 0, w, h);
    if (value?.kind === "channels") {
      const colors = ["#54e2a6", "#6da8ff", "#f4c466", "#e97abf"];
      value.channels.slice(0, 16).forEach((channel: any, index: number) => {
        const samples = channel.samples as number[];
        let low = Infinity,
          high = -Infinity;
        for (const sample of samples) {
          low = Math.min(low, sample);
          high = Math.max(high, sample);
        }
        const range = Math.max(0.00001, high - low);
        ctx.strokeStyle = colors[index % 4];
        ctx.beginPath();
        for (
          let i = 0;
          i < samples.length;
          i += Math.max(1, Math.floor(samples.length / w))
        ) {
          const v = samples[i];
          const x = (i / Math.max(1, samples.length - 1)) * w,
            y = h - 12 - ((v - low) / range) * (h - 40);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = colors[index % 4];
        ctx.font = `${n("font_size")}px monospace`;
        ctx.fillText(
          `${channel.name}: ${samples.at(-1) ?? 0}`,
          8,
          18 + index * (n("font_size") + 3),
        );
      });
      return true;
    }
    if (value?.shape)
      throw new Error(
        "SOP viewer需要渲染器preview hook；可先连接Render节点查看几何",
      );
    const text =
      value?.kind === "table"
        ? value.rows.map((row: string[]) => row.join("  |  ")).join("\n")
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2);
    ctx.fillStyle = "#dce6ef";
    ctx.font = `${n("font_size")}px monospace`;
    text
      .split("\n")
      .slice(0, Math.floor(h / (n("font_size") + 4)))
      .forEach((line: string, i: number) =>
        ctx.fillText(line, 10, 20 + i * (n("font_size") + 4), w - 20),
      );
    return true;
  }
  if (type === "Render Pass" || type === "Render Select") {
    if (!input) throw new Error(`${type}需连接Render图像`);
    const pass = args.resolveRenderPass?.(
      input,
      s("pass") as "color" | "depth" | "normal",
    );
    if (!pass)
      throw new Error(`${type}输入没有可用场景/相机附件，需直接连接Render节点`);
    ctx.drawImage(pass, 0, 0, w, h);
    return true;
  }
  if (type.startsWith("GLSL")) {
    shaderRender(args, s("code"));
    return true;
  }
  if (type === "Depth" && input && args.resolveRenderPass) {
    const depth = args.resolveRenderPass(input, "depth");
    if (depth) {
      ctx.drawImage(depth, 0, 0, w, h);
      return true;
    }
  }
  if (type === "Resolution") {
    w = clamp(Math.round(n("width")), 1, 2048);
    h = clamp(Math.round(n("height")), 1, 2048);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.imageSmoothingEnabled = Boolean(p.smooth);
    if (input) ctx.drawImage(input, 0, 0, w, h);
    return true;
  }
  if (type === "Point File In") {
    const text =
        typeof args.rawInput === "string" ? args.rawInput : s("points"),
      rows = text
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((row) =>
          row
            .trim()
            .split(/[,\s]+/)
            .map(Number),
        );
    if (
      rows.length > 65536 ||
      rows.some(
        (row) =>
          row.length < 3 || row.slice(0, 3).some((v) => !Number.isFinite(v)),
      )
    )
      throw new Error("点列表需要最多65536行有效XYZ数字");
    const width = Math.max(1, Math.ceil(Math.sqrt(rows.length))),
      height = Math.max(1, Math.ceil(rows.length / width)),
      data = new Uint8ClampedArray(width * height * 4);
    rows.forEach((row, i) => {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = row[c] * 255;
      data[i * 4 + 3] = 255;
    });
    canvas.width = width;
    canvas.height = height;
    w = width;
    h = height;
    paint(data, width, height);
    return true;
  }
  if (type === "CHOP to") {
    const value = args.rawInput as {
      kind?: string;
      channels?: { samples: number[] }[];
    };
    if (value?.kind !== "channels" || !value.channels?.length)
      throw new Error("CHOP to需要连接多通道CHOP缓冲");
    const channels = value.channels,
      width = Math.min(
        2048,
        Math.max(...channels.map((c) => c.samples.length)),
      ),
      height = Math.min(1024, channels.length),
      data = new Uint8ClampedArray(width * height * 4),
      low = n("min"),
      high = n("max");
    if (high <= low || width < 1)
      throw new Error("CHOP to需要有效数值范围和非空样本");
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4,
          z = (((channels[y].samples[x] ?? 0) - low) / (high - low)) * 255;
        data[i] = data[i + 1] = data[i + 2] = z;
        data[i + 3] = 255;
      }
    canvas.width = width;
    canvas.height = height;
    w = width;
    h = height;
    paint(data, width, height);
    return true;
  }
  if (!input) throw new Error(`${type}需要连接图像输入`);
  if (["Under", "Outside"].includes(type)) {
    ctx.drawImage(input, 0, 0, w, h);
    if (!input2) throw new Error(`${type}需要第二张图`);
    ctx.save();
    ctx.globalCompositeOperation =
      type === "Under" ? "source-over" : "destination-out";
    ctx.drawImage(input2, 0, 0, w, h);
    ctx.restore();
    return true;
  }
  if (["Layout", "Pack"].includes(type) && s("mode") !== "rgba") {
    if (!input2) throw new Error("排列需要第二张图");
    const gap = Number(p.gap) || 0,
      mode = s("mode");
    if (mode === "vertical") {
      ctx.drawImage(input, 0, 0, w, (h - gap) / 2);
      ctx.drawImage(input2, 0, (h + gap) / 2, w, (h - gap) / 2);
    } else if (mode === "inset") {
      ctx.drawImage(input, 0, 0, w, h);
      ctx.drawImage(input2, w * 0.6, h * 0.6, w * 0.36, h * 0.36);
    } else {
      ctx.drawImage(input, 0, 0, (w - gap) / 2, h);
      ctx.drawImage(input2, (w + gap) / 2, 0, (w - gap) / 2, h);
    }
    return true;
  }
  if (type === "PreFilter Map") {
    const levels = clamp(n("levels"), 2, 12);
    for (let i = 0; i < levels; i++) {
      ctx.save();
      ctx.filter = `blur(${(n("radius") * i) / (levels - 1)}px)`;
      ctx.drawImage(input, (i * w) / levels, 0, w / levels, h);
      ctx.restore();
    }
    return true;
  }
  if (["Cache", "Time Machine", "Texture 3D"].includes(type)) {
    let history = state.get("history") as History | undefined;
    if (!history || args.time < history.time) {
      history = { frames: [], time: -Infinity };
      state.set("history", history);
    }
    const length = clamp(Number(p.frames || p.slices) || 30, 1, 120);
    if (history.time !== args.time && !p.freeze) {
      const frame = document.createElement("canvas");
      frame.width = Math.min(w, 320);
      frame.height = Math.min(h, 180);
      frame.getContext("2d")!.drawImage(input, 0, 0, frame.width, frame.height);
      history.frames.push(frame);
      while (history.frames.length > length) history.frames.shift();
      history.time = args.time;
    }
    histories.set(canvas, history);
    if (!history.frames.length) return true;
    if (type === "Cache") {
      ctx.drawImage(
        history.frames[Math.max(0, history.frames.length - 1 - n("offset"))],
        0,
        0,
        w,
        h,
      );
      return true;
    }
    if (type === "Texture 3D") {
      const z = clamp(n("z")) * (history.frames.length - 1),
        index = Math.floor(z);
      ctx.drawImage(history.frames[index], 0, 0, w, h);
      if (index + 1 < history.frames.length) {
        ctx.save();
        ctx.globalAlpha = z - index;
        ctx.drawImage(history.frames[index + 1], 0, 0, w, h);
        ctx.restore();
      }
      return true;
    }
    const fw = history.frames[0].width,
      fh = history.frames[0].height,
      control = input2 ? read(input2, fw, fh, "control") : null,
      frames = history.frames.map(
        (f) => f.getContext("2d")!.getImageData(0, 0, fw, fh).data,
      ),
      out = new Uint8ClampedArray(fw * fh * 4);
    for (let i = 0; i < fw * fh; i++) {
      const delay =
          (control ? control[i * 4] / 255 : Math.floor(i / fw) / fh) *
          n("amount"),
        source = frames[Math.round((1 - delay) * (frames.length - 1))];
      out.set(source.subarray(i * 4, i * 4 + 4), i * 4);
    }
    paint(out, fw, fh);
    return true;
  }
  if (type === "Cache Select") {
    const history = histories.get(input);
    if (!history?.frames.length)
      throw new Error(
        "Cache Select需连接Cache、Texture 3D或Time Machine的输出",
      );
    ctx.drawImage(
      history.frames[Math.max(0, history.frames.length - 1 - n("offset"))],
      0,
      0,
      w,
      h,
    );
    return true;
  }
  if (type === "Spectrum") {
    if (s("mode") === "inverse") {
      const value = spectra.get(input);
      if (!value)
        throw new Error("反变换需要直接连接Spectrum频谱输出，保留复数数据");
      const restored = fft2D(value, true),
        data = new Uint8ClampedArray(value.size ** 2 * 4);
      for (let i = 0; i < value.size ** 2; i++) {
        data[i * 4] =
          data[i * 4 + 1] =
          data[i * 4 + 2] =
            restored.real[i] * 255;
        data[i * 4 + 3] = 255;
      }
      paint(data, value.size, value.size);
      return true;
    }
    const size = Number(s("size")),
      source = read(input, size, size),
      real = new Float64Array(size * size);
    for (let i = 0; i < size * size; i++)
      real[i] = gray(source[i * 4], source[i * 4 + 1], source[i * 4 + 2]) / 255;
    const frequency = fft2D({
      size,
      real,
      imag: new Float64Array(real.length),
    });
    spectra.set(canvas, frequency);
    const data = new Uint8ClampedArray(source.length);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const from = ((y + size / 2) % size) * size + ((x + size / 2) % size),
          i = (y * size + x) * 4,
          value =
            s("mode") === "phase"
              ? (Math.atan2(frequency.imag[from], frequency.real[from]) +
                  Math.PI) /
                (2 * Math.PI)
              : Math.log1p(
                  Math.hypot(frequency.real[from], frequency.imag[from]),
                ) * n("gain");
        data[i] = data[i + 1] = data[i + 2] = value * 255;
        data[i + 3] = 255;
      }
    paint(data, size, size);
    return true;
  }
  const pw = Math.min(w, type === "Optical Flow" ? 128 : 320),
    ph = Math.min(h, type === "Optical Flow" ? 72 : 180),
    a = read(input, pw, ph),
    b = input2 ? read(input2, pw, ph, "second") : undefined,
    out = new Uint8ClampedArray(a.length);
  const sample = (data: Uint8ClampedArray, x: number, y: number, c: number) =>
    data[
      (Math.floor(clamp(y, 0, ph - 1)) * pw + Math.floor(clamp(x, 0, pw - 1))) *
        4 +
        c
    ];
  if (type === "Convolve") {
    paint(
      convolvePixels(
        a,
        pw,
        ph,
        JSON.parse(s("kernel")),
        n("divisor"),
        n("bias"),
      ),
      pw,
      ph,
    );
    return true;
  }
  if (type === "Blob Track") {
    ctx.drawImage(input, 0, 0, w, h);
    const regions = findBlobs(a, pw, ph, n("threshold"), n("min_area"));
    state.set("blobs", regions);
    ctx.strokeStyle = "#58ffb8";
    ctx.fillStyle = "#58ffb8";
    ctx.lineWidth = 2;
    ctx.font = "14px monospace";
    regions.forEach((r, i) => {
      ctx.strokeRect(
        (r.x * w) / pw,
        (r.y * h) / ph,
        (r.width * w) / pw,
        (r.height * h) / ph,
      );
      ctx.fillText(String(i + 1), (r.x * w) / pw + 4, (r.y * h) / ph + 16);
      ctx.beginPath();
      ctx.arc((r.cx * w) / pw, (r.cy * h) / ph, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    return true;
  }
  if (type === "Bloom") {
    const bright = a.slice();
    for (let i = 0; i < a.length; i += 4) {
      const l = gray(a[i], a[i + 1], a[i + 2]) / 255,
        f = clamp((l - n("threshold")) / Math.max(0.001, 1 - n("threshold")));
      for (let c = 0; c < 3; c++) bright[i + c] *= f;
    }
    const layer = scratch("bloom", pw, ph);
    layer.getContext("2d")!.putImageData(new ImageData(bright, pw, ph), 0, 0);
    ctx.drawImage(input, 0, 0, w, h);
    ctx.save();
    ctx.filter = `blur(${n("radius")}px)`;
    ctx.globalCompositeOperation = "lighter";
    const strength = clamp(n("strength"), 0, 5);
    for (let pass = 0; pass < Math.ceil(strength); pass++) {
      ctx.globalAlpha = Math.min(1, strength - pass);
      ctx.drawImage(layer, 0, 0, w, h);
    }
    ctx.restore();
    return true;
  }
  if (type === "Analyze") {
    const sums = [0, 0, 0, 0],
      mode = s("operation");
    if (mode === "minimum") sums.fill(255);
    for (let i = 0; i < a.length; i += 4)
      for (let c = 0; c < 4; c++)
        sums[c] =
          mode === "maximum"
            ? Math.max(sums[c], a[i + c])
            : mode === "minimum"
              ? Math.min(sums[c], a[i + c])
              : sums[c] + (mode === "rms" ? a[i + c] ** 2 : a[i + c]);
    if (mode === "average" || mode === "rms")
      for (let c = 0; c < 4; c++)
        sums[c] =
          mode === "rms" ? Math.sqrt(sums[c] / (pw * ph)) : sums[c] / (pw * ph);
    ctx.fillStyle = `rgba(${sums[0]},${sums[1]},${sums[2]},${sums[3] / 255})`;
    ctx.fillRect(0, 0, w, h);
    state.set("analysis", sums);
    return true;
  }
  if (type === "Optical Flow") {
    const previous = state.get("previous") as Uint8ClampedArray | undefined;
    const flow =
      previous && previous.length === a.length
        ? opticalFlow(previous, a, pw, ph, n("window"))
        : new Float32Array(pw * ph * 2);
    state.set("previous", a.slice());
    for (let i = 0; i < pw * ph; i++) {
      out[i * 4] = (flow[i * 2] * n("scale") + 0.5) * 255;
      out[i * 4 + 1] = (flow[i * 2 + 1] * n("scale") + 0.5) * 255;
      out[i * 4 + 2] =
        Math.hypot(flow[i * 2], flow[i * 2 + 1]) * n("scale") * 255;
      out[i * 4 + 3] = 255;
    }
    paint(out, pw, ph);
    return true;
  }
  if (type === "Luma Blur") {
    const integrals = [0, 1, 2, 3].map(
        () => new Float64Array((pw + 1) * (ph + 1)),
      ),
      stride = pw + 1;
    for (let y = 1; y <= ph; y++)
      for (let x = 1; x <= pw; x++)
        for (let c = 0; c < 4; c++)
          integrals[c][y * stride + x] =
            a[((y - 1) * pw + x - 1) * 4 + c] +
            integrals[c][y * stride + x - 1] +
            integrals[c][(y - 1) * stride + x] -
            integrals[c][(y - 1) * stride + x - 1];
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++) {
        const i = (y * pw + x) * 4,
          r = Math.round(
            (b ? b[i] / 255 : gray(a[i], a[i + 1], a[i + 2]) / 255) *
              n("radius"),
          ),
          x0 = Math.max(0, x - r),
          y0 = Math.max(0, y - r),
          x1 = Math.min(pw, x + r + 1),
          y1 = Math.min(ph, y + r + 1);
        for (let c = 0; c < 4; c++) {
          const v = integrals[c];
          out[i + c] =
            (v[y1 * stride + x1] -
              v[y0 * stride + x1] -
              v[y1 * stride + x0] +
              v[y0 * stride + x0]) /
            ((x1 - x0) * (y1 - y0));
        }
      }
    paint(out, pw, ph);
    return true;
  }
  let matrix: number[][] | undefined, homography: number[] | undefined;
  if (type === "Channel Mix") {
    matrix = JSON.parse(s("matrix"));
    if (
      !Array.isArray(matrix) ||
      matrix.length !== 4 ||
      matrix.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== 4 ||
          row.some((v) => !Number.isFinite(v)),
      )
    )
      throw new Error("Channel Mix需要4×4数值矩阵");
  }
  if (type === "Corner Pin")
    homography = solveHomography(JSON.parse(s("corners")));
  if (["Lookup", "Remap", "Math", "Pack", "Subtract"].includes(type) && !b)
    throw new Error(`${type}需要第二张输入图像`);
  const anti =
    type === "Anti Alias"
      ? convolvePixels(
          a,
          pw,
          ph,
          [
            [1, 2, 1],
            [2, 4, 2],
            [1, 2, 1],
          ],
          16,
        )
      : undefined;
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const i = (y * pw + x) * 4,
        u = (x + 0.5) / pw,
        v = (y + 0.5) / ph,
        rgba = [a[i] / 255, a[i + 1] / 255, a[i + 2] / 255, a[i + 3] / 255];
      let result = [...rgba];
      if (type === "HSV to RGB")
        result = [
          ...hsvToRGB(...(rgba.slice(0, 3) as [number, number, number])),
          rgba[3],
        ];
      else if (type === "RGB to HSV")
        result = [
          ...rgbToHSV(...(rgba.slice(0, 3) as [number, number, number])),
          rgba[3],
        ];
      else if (type === "Channel Mix")
        result = matrix!.map((row) =>
          row.reduce((sum, k, c) => sum + k * rgba[c], 0),
        );
      else if (type === "Function")
        result = rgba.map((value, c) => {
          if (c === 3) return value;
          const z = value * n("scale") + n("offset");
          return (
            {
              sin: () => Math.sin(z * Math.PI * 2) * 0.5 + 0.5,
              cos: () => Math.cos(z * Math.PI * 2) * 0.5 + 0.5,
              abs: () => Math.abs(z),
              sqrt: () => Math.sqrt(Math.max(0, z)),
              square: () => z * z,
              exp: () => Math.exp(z) - 1,
              log: () => Math.log1p(Math.max(0, z)),
              invert: () => 1 - z,
            } as Record<string, () => number>
          )[s("operation")]();
        });
      else if (type === "Limit") {
        const low = n("min"),
          high = n("max");
        if (high <= low) throw new Error("Limit上界必须大于下界");
        result = rgba.map((z, c) => {
          if (c === 3) return z;
          const t = (z - low) / (high - low);
          return s("mode") === "wrap"
            ? low + fract(t) * (high - low)
            : s("mode") === "mirror"
              ? low + (1 - Math.abs((((t % 2) + 2) % 2) - 1)) * (high - low)
              : clamp(z, low, high);
        });
      } else if (type === "Luma Level") {
        const l = gray(...(rgba.slice(0, 3) as [number, number, number])),
          f = (l * n("gain") + n("offset")) / Math.max(0.00001, l);
        result = rgba.map((z, c) => (c === 3 ? z : z * f));
      } else if (type === "Math" || type === "Subtract") {
        result = rgba.map((z, c) => {
          if (c === 3) return z;
          const other = b![i + c] / 255,
            operation = type === "Subtract" ? "subtract" : s("operation");
          const val =
            operation === "add"
              ? z + other
              : operation === "subtract"
                ? z - other
                : operation === "multiply"
                  ? z * other
                  : operation === "divide"
                    ? Math.abs(other) < 1e-6
                      ? 0
                      : z / other
                    : operation === "minimum"
                      ? Math.min(z, other)
                      : Math.max(z, other);
          return val * n("gain") + (Number(p.offset) || 0);
        });
      } else if (type === "Pack")
        result = [rgba[0], rgba[1], b![i] / 255, b![i + 1] / 255];
      else if (type === "Anti Alias") {
        const g =
            Math.abs(sample(a, x + 1, y, 0) - sample(a, x - 1, y, 0)) +
            Math.abs(sample(a, x, y + 1, 0) - sample(a, x, y - 1, 0)),
          f = clamp(g / 100) * n("strength");
        result = rgba.map((z, c) => z * (1 - f) + (anti![i + c] / 255) * f);
      } else if (type === "Normal Map" || type === "Slope") {
        const lum = (xx: number, yy: number) =>
            gray(
              sample(a, xx, yy, 0),
              sample(a, xx, yy, 1),
              sample(a, xx, yy, 2),
            ) / 255,
          dx = (lum(x + 1, y) - lum(x - 1, y)) * 0.5 * n("strength"),
          dy = (lum(x, y + 1) - lum(x, y - 1)) * 0.5 * n("strength");
        if (type === "Normal Map") {
          const length = Math.hypot(dx, dy, 1);
          result = [
            (-dx / length) * 0.5 + 0.5,
            (-dy / length) * 0.5 + 0.5,
            (1 / length) * 0.5 + 0.5,
            1,
          ];
        } else {
          const z =
            s("mode") === "x"
              ? dx * 0.5 + 0.5
              : s("mode") === "y"
                ? dy * 0.5 + 0.5
                : Math.hypot(dx, dy);
          result = [z, z, z, 1];
        }
      } else if (type === "Point Transform") {
        const angle = (n("angle") * Math.PI) / 180,
          xx = (rgba[0] - 0.5) * n("scale"),
          yy = (rgba[1] - 0.5) * n("scale");
        result = [
          xx * Math.cos(angle) - yy * Math.sin(angle) + 0.5 + n("x"),
          xx * Math.sin(angle) + yy * Math.cos(angle) + 0.5 + n("y"),
          (rgba[2] - 0.5) * n("scale") + 0.5 + n("z"),
          rgba[3],
        ];
      } else if (type === "Depth") {
        const near = n("near"),
          far = n("far");
        if (far <= near) throw new Error("远裁面必须大于近裁面");
        const z = (near * far) / (far - rgba[0] * (far - near)) / far;
        result = [z, z, z, 1];
      } else if (type === "SSAO") {
        const center = rgba[0],
          radius = n("radius");
        let occlusion = 0;
        for (let k = 0; k < 12; k++) {
          const angle = (k * Math.PI) / 6,
            depth =
              sample(
                a,
                x + Math.cos(angle) * radius,
                y + Math.sin(angle) * radius,
                0,
              ) / 255;
          occlusion += clamp((center - depth - n("bias")) * n("strength"));
        }
        const z = 1 - occlusion / 12;
        result = [z, z, z, 1];
      } else if (
        [
          "Corner Pin",
          "Projection",
          "Remap",
          "Lookup",
          "Cube Map",
          "Point File Select",
        ].includes(type)
      ) {
        let tx = u,
          ty = v,
          inside = true;
        if (type === "Corner Pin") {
          const m = homography!,
            den = m[6] * u + m[7] * v + 1;
          tx = (m[0] * u + m[1] * v + m[2]) / den;
          ty = (m[3] * u + m[4] * v + m[5]) / den;
          inside = tx >= 0 && tx <= 1 && ty >= 0 && ty <= 1;
        } else if (type === "Remap") {
          tx = b![i] / 255;
          ty = b![i + 1] / 255;
          if (p.wrap) {
            tx = fract(tx);
            ty = fract(ty);
          }
        } else if (type === "Lookup") {
          tx = gray(...(rgba.slice(0, 3) as [number, number, number]));
          ty = n("row");
        } else if (type === "Point File Select") {
          const count = n("count"),
            index = n("start") + Math.floor(u * count);
          inside = index < input.width * input.height;
          tx = ((index % input.width) + 0.5) / input.width;
          ty = (Math.floor(index / input.width) + 0.5) / input.height;
        } else if (type === "Cube Map") {
          const face = Math.min(5, Math.floor(u * 6)),
            a = fract(u * 6) * 2 - 1,
            b = v * 2 - 1,
            vector = [
              [1, -b, -a],
              [-1, -b, a],
              [a, 1, b],
              [a, -1, -b],
              [a, -b, 1],
              [-a, -b, -1],
            ][face];
          tx = fract(
            Math.atan2(vector[2], vector[0]) / (Math.PI * 2) +
              0.5 +
              n("rotation"),
          );
          ty =
            Math.acos(clamp(vector[1] / Math.hypot(...vector), -1, 1)) /
            Math.PI;
        } else {
          const mode = s("mode");
          if (mode === "sphere") {
            const xx = u * 2 - 1,
              yy = v * 2 - 1,
              r = xx * xx + yy * yy;
            inside = r <= 1;
            tx = fract(
              Math.atan2(xx, Math.sqrt(Math.max(0, 1 - r))) / (Math.PI * 2) +
                0.5 +
                n("rotation"),
            );
            ty = Math.acos(clamp(-yy, -1, 1)) / Math.PI;
          } else if (mode === "cylinder")
            tx = fract(
              Math.asin(clamp(u * 2 - 1, -1, 1)) / Math.PI +
                0.5 +
                n("rotation"),
            );
          else tx = fract(u + n("rotation"));
        }
        const source = type === "Lookup" ? b! : a;
        result = inside
          ? [0, 1, 2, 3].map(
              (c) => sample(source, tx * (pw - 1), ty * (ph - 1), c) / 255,
            )
          : [0, 0, 0, 0];
      }
      for (let c = 0; c < 4; c++) out[i + c] = result[c] * 255;
    }
  paint(out, pw, ph);
  return true;
}
