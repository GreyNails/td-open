import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts"),
  temp = path.join(root, ".cache/tmp");
await fs.mkdir(artifacts, { recursive: true });
await fs.mkdir(temp, { recursive: true });
const server = await createServer({
  root: import.meta.dirname,
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { usePolling: true, interval: 1000 },
  },
  logLevel: "error",
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.TD_CHROMIUM,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage();
  await page.route("**/reference-top-qa.html", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "reference-top-qa.html");
  const report = await page.evaluate(async () => {
    const { referenceTopCatalog: catalog } =
        await import("/src/nodes/referenceTopCatalog.ts"),
      { cookReferenceTopNode: cook, disposeReferenceTopState: dispose } =
        await import("/src/nodes/referenceTopRuntime.ts");
    const w = 96,
      h = 64,
      make = (width = w, height = h) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
      },
      a = make(),
      b = make();
    [a, b].forEach((c, j) => {
      const ctx = c.getContext("2d"),
        pixels = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          pixels.data[i] = (x * 7 + y * 3 + j * 43) % 256;
          pixels.data[i + 1] = (y * 9 + x * 3 + j * 89) % 256;
          pixels.data[i + 2] = (x * 5 + y * 11 + j * 59) % 256;
          pixels.data[i + 3] = j && x < w / 2 ? 128 : 255;
        }
      ctx.putImageData(pixels, 0, 0);
    });
    const THREE = await import("/node_modules/three/build/three.module.js");
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(w, h, false);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 20);
    camera.position.z = 3;
    const material = new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(a),
      }),
      geometry = new THREE.SphereGeometry(0.8, 20, 12),
      mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const attachments = {};
    for (const pass of ["color", "depth", "normal"]) {
      const override =
        pass === "depth"
          ? new THREE.MeshDepthMaterial()
          : pass === "normal"
            ? new THREE.MeshNormalMaterial()
            : null;
      scene.overrideMaterial = override;
      renderer.render(scene, camera);
      const copy = make();
      copy.getContext("2d").drawImage(renderer.domElement, 0, 0);
      attachments[pass] = copy;
      override?.dispose();
    }
    scene.overrideMaterial = null;
    const run = (
      name,
      params = {},
      input = a,
      input2 = b,
      state = new Map(),
      time = 1,
    ) => {
      const spec = catalog.find((s) => s.english === name),
        canvas = make(),
        ctx = canvas.getContext("2d"),
        node = {
          id: spec.type,
          type: spec.type,
          position: { x: 0, y: 0 },
          data: {
            label: spec.label,
            params: {
              ...Object.fromEntries(spec.params.map((p) => [p.key, p.default])),
              ...(name === "OP Viewer" ? { source: "test" } : {}),
              ...params,
            },
          },
        };
      cook({
        node,
        canvas,
        ctx,
        input,
        input2,
        state,
        time,
        mod: 0,
        width: w,
        height: h,
        resolveNode: () => a,
        resolveRenderPass: (_source, pass) => attachments[pass],
        resolveImportedTexture: () => material.map.image,
        rawInput: {
          kind: "channels",
          channels: [
            { name: "x", samples: [0, 0.5, 1] },
            { name: "y", samples: [1, 0.5, 0] },
          ],
          sampleRate: 60,
          start: 0,
          timeSlice: false,
        },
      });
      return { canvas, state, ctx };
    };
    const operators = [];
    for (const spec of catalog) {
      const start = performance.now();
      try {
        let input = a;
        if (spec.english === "Cache Select") input = run("Cache").canvas;
        const value = run(spec.english, {}, input),
          data = value.ctx.getImageData(
            0,
            0,
            value.canvas.width,
            value.canvas.height,
          ).data;
        const nonempty = data.some((v, i) => i % 4 === 3 && v > 0);
        if (!nonempty) throw new Error("No visible output pixels");
        operators.push({
          type: spec.type,
          ok: true,
          width: value.canvas.width,
          height: value.canvas.height,
          ms: performance.now() - start,
        });
        dispose(value.state);
      } catch (error) {
        operators.push({ type: spec.type, ok: false, error: String(error) });
      }
    }
    const assertions = [];
    const assert = (name, value) => {
      assertions.push({ name, ok: Boolean(value) });
    };
    const resized = run("Resolution", { width: 37, height: 19 });
    assert(
      "resolution changes actual dimensions",
      resized.canvas.width === 37 && resized.canvas.height === 19,
    );
    const shader = run("GLSL", {
      code: "#version 300 es\nprecision highp float;out vec4 fragColor;void main(){fragColor=vec4(1,0.25,0,1);}",
    });
    const pixel = shader.ctx.getImageData(10, 10, 1, 1).data;
    assert(
      "GLSL executes real fragment shader",
      pixel[0] === 255 && Math.abs(pixel[1] - 64) < 2 && pixel[2] === 0,
    );
    dispose(shader.state);
    let invalid = false;
    try {
      run("GLSL", { code: "this is invalid shader code" });
    } catch (e) {
      invalid = String(e).includes("编译失败");
    }
    assert("GLSL compilation errors are visible", invalid);
    const history = new Map(),
      first = run("Cache", {}, a, b, history, 0),
      second = run("Cache", {}, b, a, history, 1),
      selection = run("Cache Select", { offset: 1 }, second.canvas);
    assert(
      "cache select reads an actual earlier frame",
      selection.ctx.getImageData(5, 5, 1, 1).data[0] ===
        a.getContext("2d").getImageData(5, 5, 1, 1).data[0],
    );
    const gray = make(64, 64),
      grayctx = gray.getContext("2d"),
      data = grayctx.createImageData(64, 64);
    for (let i = 0; i < 4096; i++) {
      data.data[i * 4] =
        data.data[i * 4 + 1] =
        data.data[i * 4 + 2] =
          (i % 64) * 4;
      data.data[i * 4 + 3] = 255;
    }
    grayctx.putImageData(data, 0, 0);
    const frequency = run("Spectrum", { size: "64" }, gray),
      restored = run("Spectrum", { mode: "inverse" }, frequency.canvas);
    const restoredPixel = restored.ctx.getImageData(w / 2, h / 2, 1, 1).data[0];
    assert(
      "image FFT inverse restores spatial brightness",
      Math.abs(restoredPixel - 128) < 7,
    );
    const chop = run("CHOP to");
    assert(
      "CHOP to emits actual sample grid",
      chop.canvas.width === 3 &&
        chop.canvas.height === 2 &&
        chop.ctx.getImageData(2, 0, 1, 1).data[0] === 255,
    );
    const points = run("Point File In", { points: "0,0,0\n1,1,1" });
    assert(
      "point text produces actual point pixels",
      points.canvas.width === 2 &&
        points.ctx.getImageData(1, 0, 1, 1).data[0] === 255,
    );
    geometry.dispose();
    material.map.dispose();
    material.dispose();
    renderer.dispose();
    return {
      operators,
      assertions,
      passed: operators.every((o) => o.ok) && assertions.every((a) => a.ok),
    };
  });
  await fs.writeFile(
    path.join(artifacts, "reference-top-browser-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        nodes: report.operators.length,
        checks: report.assertions.length,
        passed: report.passed,
        failures: [...report.operators, ...report.assertions].filter(
          (x) => !x.ok,
        ),
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
