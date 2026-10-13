// Run with a current Node.js: TD_CHROMIUM=/path/to/chrome node browser-visual-check.mjs
// Starts its own temporary Vite server and saves the report inside this project.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";

const frontend = import.meta.dirname;
const root = path.resolve(frontend, "..");
const artifacts = path.join(root, "data/artifacts");
const temp = path.join(root, ".cache/tmp");
await fs.mkdir(artifacts, { recursive: true });
await fs.mkdir(temp, { recursive: true });
const server = await createServer({
  root: frontend,
  server: { host: "127.0.0.1", port: 0 },
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
    viewport: { width: 1380, height: 1080 },
  });
  await page.route("**/visual-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>Visual node checks</title><body></body></html>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "visual-qa.html");
  const report = await page.evaluate(async () => {
    const { visualCatalog } = await import("/src/nodes/visualCatalog.ts");
    const { cookVisualNode } = await import("/src/nodes/visual.ts");
    const w = 160,
      h = 90;
    const make = (width = w, height = h) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
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
          data.data[i + 3] = 255;
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
    for (const spec of visualCatalog) {
      const params = defaults(spec);
      const run = (p = params, options = {}) => {
        const canvas = make(),
          ctx = canvas.getContext("2d"),
          state = new Map();
        let handled;
        for (
          let frame = 0;
          frame < (spec.type === "feedback" ? 3 : 1);
          frame++
        ) {
          ctx.save();
          handled = cookVisualNode({
            node: nodeFor(spec, p),
            ctx,
            canvas,
            input,
            input2,
            time: 0.37 + frame / 30,
            mod: 0,
            width: w,
            height: h,
            state,
            ...options,
          });
          ctx.restore();
        }
        return { handled, signature: hash(ctx.getImageData(0, 0, w, h).data) };
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
              p.type === "number" ? Number.POSITIVE_INFINITY : p.default,
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
    const feedback = visualCatalog.find((s) => s.type === "feedback"),
      history = new Map(),
      canvas = make(),
      ctx = canvas.getContext("2d");
    const frameAt = (time) => {
      ctx.save();
      cookVisualNode({
        node: nodeFor(feedback),
        ctx,
        canvas,
        input,
        input2,
        time,
        mod: 0,
        width: w,
        height: h,
        state: history,
      });
      ctx.restore();
      return hash(ctx.getImageData(0, 0, w, h).data);
    };
    const firstFrame = frameAt(1);
    frameAt(2);
    const historyFrame = frameAt(3);
    const resetFrame = frameAt(0);
    const invariants = {
      feedbackAccumulates: firstFrame !== historyFrame,
      feedbackRewinds: firstFrame === resetFrame,
    };
    // Make a readable contact sheet from the exact same runtime used by the app.
    document.head.insertAdjacentHTML(
      "beforeend",
      "<style>body{margin:0;padding:30px;background:#11131c;color:#eee;font:14px sans-serif}.qa-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}.qa-item{padding:12px;background:#202332;border:1px solid #35394b;border-radius:14px}.qa-item canvas{width:100%;height:auto;border-radius:5px;display:block}.qa-item h3{margin:0 0 8px;font-size:15px}.qa-item p{margin:8px 0 0;color:#a2a6be;font-size:12px}h1{font-size:24px}</style>",
    );
    document.body.innerHTML = `<h1>TD Open · ${visualCatalog.length} 个新增画面节点 · 实际 Canvas 渲染</h1><div class="qa-grid"></div>`;
    const preview = make(320, 180),
      pc = preview.getContext("2d"),
      gradient = pc.createLinearGradient(0, 0, 320, 180);
    gradient.addColorStop(0, "#a266e9");
    gradient.addColorStop(1, "#fd9356");
    pc.fillStyle = gradient;
    pc.fillRect(0, 0, 320, 180);
    pc.fillStyle = "#16182b";
    pc.fillRect(50, 40, 90, 75);
    pc.fillStyle = "#f6ffc7";
    pc.beginPath();
    pc.arc(227, 82, 44, 0, Math.PI * 2);
    pc.fill();
    pc.strokeStyle = "#ffffff";
    pc.lineWidth = 4;
    pc.beginPath();
    pc.moveTo(0, 150);
    pc.lineTo(320, 23);
    pc.stroke();
    const previewMask = make(320, 180),
      mc = previewMask.getContext("2d"),
      radial = mc.createRadialGradient(160, 90, 0, 160, 90, 160);
    radial.addColorStop(0, "white");
    radial.addColorStop(1, "black");
    mc.fillStyle = radial;
    mc.fillRect(0, 0, 320, 180);
    for (const spec of visualCatalog) {
      const canvas = make(320, 180),
        ctx = canvas.getContext("2d"),
        state = new Map();
      for (
        let frame = 0;
        frame < (spec.type === "feedback" ? 12 : 1);
        frame++
      ) {
        ctx.save();
        cookVisualNode({
          node: nodeFor(spec),
          ctx,
          canvas,
          input: preview,
          input2: previewMask,
          time: 0.37 + frame / 30,
          mod: 0,
          width: 320,
          height: 180,
          state,
        });
        ctx.restore();
      }
      const item = document.createElement("div");
      item.className = "qa-item";
      item.innerHTML = `<h3>${spec.label}</h3>`;
      item.append(canvas);
      item.insertAdjacentHTML(
        "beforeend",
        `<p>${spec.english} · ${spec.type}</p>`,
      );
      document.querySelector(".qa-grid").append(item);
    }
    return { operators, invariants };
  });
  await fs.writeFile(
    path.join(artifacts, "visual-node-check.json"),
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({
    path: path.join(artifacts, "visual-node-contact-sheet.png"),
    fullPage: true,
  });
  const failures = report.operators.filter(
    (r) =>
      r.error ||
      !r.handled ||
      !r.missingHandled ||
      !r.invalidHandled ||
      !r.modResponsive ||
      r.unresponsiveParams.length,
  );
  const passed =
    failures.length === 0 && Object.values(report.invariants).every(Boolean);
  console.log(
    JSON.stringify(
      {
        passed,
        operators: report.operators.length,
        invariants: report.invariants,
        failures,
      },
      null,
      2,
    ),
  );
  if (!passed) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
