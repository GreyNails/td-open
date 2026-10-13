// Reproducible gallery assets: actual StudioEngine output, never a mock screenshot.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  assets = path.join(root, "frontend/public/examples"),
  artifacts = path.join(root, "data/artifacts");
await fs.mkdir(assets, { recursive: true });
await fs.mkdir(artifacts, { recursive: true });
await fs.mkdir(path.join(root, ".cache/tmp"), { recursive: true });
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
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
    env: { ...process.env, TMPDIR: path.join(root, ".cache/tmp") },
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/gallery-render.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>TD Open gallery</title><body></body></html>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "gallery-render.html");
  await page.evaluate(async () => {
    const { StudioEngine } = await import("/src/engine.ts"),
      { preset } = await import("/src/catalog.ts"),
      { templates } = await import("/src/templates.ts");
    window.gallery = {
      engine: new StudioEngine(preset()),
      preset,
      templates,
      images: new Map(),
    };
  });
  const templates = await page.evaluate(() =>
      window.gallery.templates.map(({ id, name, category, requires }) => ({
        id,
        name,
        category,
        requires,
      })),
    ),
    results = [];
  for (const template of templates) {
    const result = await page.evaluate(async (id) => {
      const { engine, preset, images, templates } = window.gallery,
        project = preset(id);
      engine.setProject(project);
      let canvas;
      for (let frame = 0; frame < 10; frame++)
        canvas = engine.render(frame / 12);
      const failures = Array.from(engine.errors),
        small = document.createElement("canvas");
      small.width = 480;
      small.height = 270;
      const ctx = small.getContext("2d");
      ctx.drawImage(canvas, 0, 0, 480, 270);
      const data = ctx.getImageData(0, 0, 480, 270).data;
      let sum = 0,
        square = 0;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += lum;
        square += lum * lum;
      }
      const mean = sum / (480 * 270),
        variance = square / (480 * 270) - mean * mean;
      const template = templates.find((t) => t.id === id);
      if (template.requires === "ai" || template.requires === "mcp" || template.requires === "local") {
        // Explicit instruction card: no fabricated AI result is presented as a generated asset.
        ctx.fillStyle = "#171320";
        ctx.fillRect(0, 0, 480, 270);
        ctx.strokeStyle = "#624877";
        for (let j = 0; j < 3; j++) {
          ctx.strokeRect(68 + j * 126, 90, 94, 65);
          if (j < 2) {
            ctx.beginPath();
            ctx.moveTo(162 + j * 126, 122);
            ctx.lineTo(194 + j * 126, 122);
            ctx.stroke();
          }
        }
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#c6abdf";
        ctx.textAlign = "center";
        [template.requires === "local" ? "LOCAL" : "API", "NODES", "OUTPUT"].forEach((t, i) =>
          ctx.fillText(t, 115 + i * 126, 128),
        );
        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#ded2e9";
        ctx.fillText(
          template.requires === "mcp"
            ? "连接 MCP 后手动运行"
            : template.requires === "local" ? "安装本地模型后手动运行" : "配置 AI 服务后手动运行",
          240,
          197,
        );
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#8e7fa3";
        ctx.fillText("工作流示意 · 不包含预生成结果", 240, 222);
      }
      images.set(id, small);
      return {
        id,
        failures,
        mean,
        variance,
        nodes: project.nodes.length,
        image: small.toDataURL("image/webp", 0.85),
      };
    }, template.id);
    await fs.writeFile(
      path.join(assets, `${template.id}.webp`),
      Buffer.from(result.image.split(",")[1], "base64"),
    );
    delete result.image;
    results.push(result);
    console.log(
      `${result.failures.length ? "FAIL" : "PASS"} ${template.id} nodes=${result.nodes} variance=${result.variance.toFixed(1)}`,
    );
  }
  const showcase = await page.evaluate(() => {
    const { images, templates } = window.gallery,
      selected = [
        "flow",
        "cell-lights",
        "fractal-window",
        "julia-orbit",
        "plasma-flow",
        "spiral-vortex",
        "moire-field",
        "lava-lamp",
        "hex-hud",
        "liquid-metal",
        "helix-sculpture",
        "knot-sculpture",
        "lathe-vase",
        "wave-surface",
        "twist-sculpture",
        "radial-architecture",
      ];
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1140;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#121117";
    ctx.fillRect(0, 0, 1600, 1140);
    ctx.fillStyle = "#e9dff4";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("TD OPEN / EXAMPLE EXPLORER", 40, 55);
    ctx.fillStyle = "#a598b3";
    ctx.font = "16px sans-serif";
    ctx.fillText(
      `${templates.length} editable examples · actual Canvas / WebGL output · no external API required for the selection below`,
      40,
      88,
    );
    selected.forEach((id, i) => {
      const x = 40 + (i % 4) * 385,
        y = 120 + Math.floor(i / 4) * 250;
      ctx.drawImage(images.get(id), x, y, 365, 205);
      ctx.fillStyle = "#c4b5d5";
      ctx.font = "15px sans-serif";
      ctx.fillText(id.replaceAll("-", " / "), x, y + 230);
    });
    return canvas.toDataURL("image/png");
  });
  await fs.mkdir(path.join(root, "docs/images"), { recursive: true });
  await fs.writeFile(
    path.join(root, "docs/images/example-showcase.png"),
    Buffer.from(showcase.split(",")[1], "base64"),
  );
  await page.evaluate(() => window.gallery.engine.dispose());
  await fs.writeFile(
    path.join(artifacts, "examples-render-report.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  if (errors.length || results.some((r) => r.failures.length))
    throw new Error(
      "Example runtime errors; inspect data/artifacts/examples-render-report.json",
    );
  console.log(`Rendered ${results.length} examples and showcase image.`);
} finally {
  await browser?.close();
  await server.close();
}
