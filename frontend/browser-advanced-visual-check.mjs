// Pixel/parameter checks run in real Chromium using the same Canvas runtime as the editor.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const frontend = import.meta.dirname,
  root = path.resolve(frontend, ".."),
  artifacts = path.join(root, "data/artifacts"),
  temp = path.join(root, ".cache/tmp");
await fs.mkdir(artifacts, { recursive: true });
await fs.mkdir(temp, { recursive: true });
const server = await createServer({
  root: frontend,
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
    args: ["--no-sandbox"],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1080 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/advanced-visual-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>Advanced visual node checks</title><body></body></html>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "advanced-visual-qa.html");
  const report = await page.evaluate(async () => {
    const { advancedVisualCatalog: catalog } =
      await import("/src/nodes/advancedVisualCatalog.ts");
    const { cookAdvancedVisualNode: cook } =
      await import("/src/nodes/advancedVisual.ts");
    const w = 160,
      h = 90;
    const make = (width = w, height = h) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      return c;
    };
    const input = make(),
      input2 = make();
    for (const [j, canvas] of [input, input2].entries()) {
      const ctx = canvas.getContext("2d"),
        data = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          data.data[i] = (x * 13 + y * 5 + j * 63) % 256;
          data.data[i + 1] = (x * 3 + y * 19 + j * 71) % 256;
          data.data[i + 2] = (x * 17 + y * 7 + j * 101) % 256;
          data.data[i + 3] = 80 + ((x * 5 + y * 7) % 176);
        }
      ctx.putImageData(data, 0, 0);
    }
    const hash = (data) => {
      let hash = 2166136261;
      for (const value of data) hash = Math.imul(hash ^ value, 16777619);
      return hash >>> 0;
    };
    const defaults = (spec) =>
      Object.fromEntries(spec.params.map((p) => [p.key, p.default]));
    const nodeFor = (spec, params = defaults(spec)) => ({
      id: spec.type,
      type: spec.type,
      position: { x: 0, y: 0 },
      data: { label: spec.label, params },
    });
    const operators = [];
    for (const spec of catalog) {
      const params = defaults(spec);
      const run = (p = params, options = {}) => {
        const canvas = make(),
          ctx = canvas.getContext("2d"),
          state = new Map();
        ctx.save();
        const start = performance.now();
        const handled = cook({
          node: nodeFor(spec, p),
          ctx,
          canvas,
          input,
          input2,
          time: 0.37,
          mod: 0,
          width: w,
          height: h,
          state,
          ...options,
        });
        const elapsedMs = performance.now() - start;
        ctx.restore();
        return {
          handled,
          elapsedMs,
          signature: hash(ctx.getImageData(0, 0, w, h).data),
        };
      };
      try {
        const baseline = run(),
          unresponsiveParams = [];
        for (const param of spec.params) {
          const alternatives =
            param.type === "number"
              ? [
                  param.min,
                  param.max,
                  param.min + (param.max - param.min) * 0.37,
                ]
              : param.type === "color"
                ? ["#000000", "#ffffff", "#00ff00"]
                : param.options || [];
          if (
            !alternatives.some(
              (alternate) =>
                run({ ...params, [param.key]: alternate }).signature !==
                baseline.signature,
            )
          )
            unresponsiveParams.push(param.key);
        }
        const missing = run(params, { input: undefined, input2: undefined });
        const invalid = run(
          Object.fromEntries(
            spec.params.map((p) => [
              p.key,
              p.type === "number" ? Infinity : p.default,
            ]),
          ),
        );
        const modResponsive =
          !spec.inputs.some((p) => p.id === "mod") ||
          run(params, { mod: 0.231 }).signature !== baseline.signature;
        operators.push({
          type: spec.type,
          ...baseline,
          unresponsiveParams,
          missingHandled: missing.handled,
          invalidHandled: invalid.handled,
          modResponsive,
        });
      } catch (error) {
        operators.push({ type: spec.type, error: String(error) });
      }
    }
    const rgba = (color) => {
      const c = make(1, 1);
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return c;
    };
    const pixelAt = (type, a, b, params = {}) => {
      const canvas = rgba("magenta"),
        ctx = canvas.getContext("2d"),
        spec = catalog.find((item) => item.type === type);
      ctx.save();
      cook({
        node: nodeFor(spec, { ...defaults(spec), ...params }),
        ctx,
        canvas,
        input: a,
        input2: b,
        time: 0,
        mod: 0,
        width: 1,
        height: 1,
        state: new Map(),
      });
      ctx.restore();
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const alphaPixel = pixelAt(
      "exposure",
      rgba("rgba(80,40,20,0.5)"),
      undefined,
      { stops: 0 },
    );
    const xorPixel = pixelAt("composite_xor", rgba("red"), rgba("blue"), {
      opacity: 1,
    });
    const screenPixel = pixelAt(
      "composite_screen",
      rgba("rgb(128,0,0)"),
      rgba("rgb(0,128,0)"),
      { opacity: 1 },
    );
    const invariants = {
      preservesTransparentSource:
        alphaPixel[3] === 128 && Math.abs(alphaPixel[0] - 80) < 2,
      xorRemovesOpaqueIntersection: xorPixel[3] === 0,
      screenCombinesComplementaryChannels:
        screenPixel[0] === 128 &&
        screenPixel[1] === 128 &&
        screenPixel[2] === 0,
    };
    document.head.insertAdjacentHTML(
      "beforeend",
      "<style>body{margin:0;padding:36px;background:#10131d;color:#eee;font:14px sans-serif}.qa-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}.qa-item{padding:12px;background:#1b2030;border:1px solid #32394c;border-radius:12px}.qa-item canvas{width:100%;height:auto;border-radius:5px;display:block}.qa-item h3{margin:0 0 8px;font-size:15px}.qa-item p{margin:8px 0 0;color:#a2adc5;font-size:12px}h1{font-size:27px}header{margin-bottom:28px}header p{color:#9aa7c5}</style>",
    );
    document.body.innerHTML = `<header><h1>TD Open · 47 个进阶画面节点</h1><p>实际 Canvas 渲染 · 分形生成 / 色彩处理 / 光学扭曲 / 多图合成</p></header><div class="qa-grid"></div>`;
    const preview = make(320, 180),
      pc = preview.getContext("2d"),
      gradient = pc.createLinearGradient(0, 0, 320, 180);
    gradient.addColorStop(0, "#604ada");
    gradient.addColorStop(1, "#fc8367");
    pc.fillStyle = gradient;
    pc.fillRect(0, 0, 320, 180);
    pc.fillStyle = "#101932";
    pc.fillRect(44, 39, 96, 92);
    pc.fillStyle = "#faffac";
    pc.beginPath();
    pc.arc(229, 81, 46, 0, Math.PI * 2);
    pc.fill();
    pc.strokeStyle = "white";
    pc.lineWidth = 5;
    pc.beginPath();
    pc.moveTo(0, 159);
    pc.lineTo(320, 21);
    pc.stroke();
    const second = make(320, 180),
      mc = second.getContext("2d"),
      radial = mc.createRadialGradient(160, 90, 0, 160, 90, 160);
    radial.addColorStop(0, "#79ffe7");
    radial.addColorStop(1, "transparent");
    mc.fillStyle = radial;
    mc.fillRect(0, 0, 320, 180);
    for (const spec of catalog) {
      const canvas = make(320, 180),
        ctx = canvas.getContext("2d");
      ctx.save();
      cook({
        node: nodeFor(spec),
        ctx,
        canvas,
        input: preview,
        input2: second,
        time: 0.37,
        mod: 0,
        width: 320,
        height: 180,
        state: new Map(),
      });
      ctx.restore();
      const item = document.createElement("div");
      item.className = "qa-item";
      item.innerHTML = `<h3>${spec.label}</h3>`;
      item.append(canvas);
      item.insertAdjacentHTML("beforeend", `<p>${spec.english}</p>`);
      document.querySelector(".qa-grid").append(item);
    }
    return { count: catalog.length, operators, invariants };
  });
  report.errors = errors;
  report.ok =
    !errors.length &&
    Object.values(report.invariants).every(Boolean) &&
    report.operators.every(
      (op) =>
        op.handled &&
        op.missingHandled &&
        op.invalidHandled &&
        !op.unresponsiveParams.length &&
        op.modResponsive,
    );
  await fs.writeFile(
    path.join(artifacts, "advanced-visual-report.json"),
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({
    path: path.join(root, "docs/images/advanced-visual-contact-sheet.png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        count: report.count,
        failures: report.operators.filter(
          (op) =>
            !op.handled ||
            !op.missingHandled ||
            !op.invalidHandled ||
            op.unresponsiveParams.length ||
            !op.modResponsive,
        ),
        errors,
      },
      null,
      2,
    ),
  );
  if (!report.ok) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await server.close();
}
