import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts"),
  temp = path.join(root, ".cache/tmp");
await fs.mkdir(temp, { recursive: true });
await fs.mkdir(path.join(artifacts, "reference-projects"), { recursive: true });
await fs.mkdir(path.join(root, "frontend/public/examples"), {
  recursive: true,
});
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
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage({
      viewport: { width: 1520, height: 1160 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/reference-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;padding:32px;background:#11121b;color:#f4f1fe;font-family:Arial,sans-serif"><p style="color:#bca1fb;letter-spacing:4px;font-size:12px">TD OPEN · REFERENCE CAPABILITIES</p><h1 style="margin:12px 0 8px">新的创作工具，真实可运行的案例</h1><p style="color:#a6a3b5;margin-bottom:26px">可编辑场景 · 网格建模 · 骨骼与刚体 · 图像与音频频谱 · 嵌套组件</p><div id="gallery" style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px"></div></body></html>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "reference-qa.html");
  const result = await page.evaluate(async () => {
    const { referenceTemplates, decorateReferenceProject } =
        await import("/src/referenceTemplates.ts"),
      { makeNode, byType } = await import("/src/catalog.ts"),
      { StudioEngine } = await import("/src/engine.ts");
    const results = [];
    for (const example of referenceTemplates) {
      let engine;
      try {
        const nodes = example.recipe.nodes.map((item, i) => {
          const [type, params] = typeof item === "string" ? [item, {}] : item;
          if (!byType[type]) throw Error("Missing node " + type);
          for (const key of Object.keys(params))
            if (!byType[type].params.some((p) => p.key === key))
              throw Error(type + " unknown parameter " + key);
          const node = makeNode(type, i * 245, 0);
          node.data.params = { ...node.data.params, ...params };
          return node;
        });
        const edges = example.recipe.edges.map(([from, to, handle], i) => {
          const port = handle ?? "in";
          if (!byType[nodes[to].type].inputs.some((p) => p.id === port))
            throw Error(nodes[to].type + " invalid input " + port);
          return {
            id: "edge_" + i,
            source: nodes[from].id,
            target: nodes[to].id,
            sourceHandle: "out",
            targetHandle: port,
          };
        });
        const project = decorateReferenceProject(
          {
            id: example.id,
            name: example.name,
            version: 1,
            nodes,
            edges,
            settings: { preset: example.id },
          },
          makeNode,
        );
        engine = new StudioEngine(project);
        let canvas;
        for (const time of [0, 0.016, 0.033, 0.1, 0.25, 0.5, 1, 1.5])
          canvas = engine.render(time);
        const failures = [...engine.errors.entries()].map(([id, error]) => ({
          type: engine.project.nodes.find((n) => n.id === id)?.type,
          id,
          error,
        }));
        if (failures.length) throw Error(JSON.stringify(failures));
        const pixels = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, canvas.height).data,
          colors = new Set();
        for (let i = 0; i < pixels.length; i += 32)
          colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        if (colors.size < 3)
          throw Error("Output has no useful visual variation");
        const thumb = document.createElement("canvas");
        thumb.width = 480;
        thumb.height = 270;
        thumb.getContext("2d").drawImage(canvas, 0, 0, 480, 270);
        const image = thumb.toDataURL("image/webp", 0.85),
          card = document.createElement("div");
        card.style.cssText =
          "border:1px solid #2c2b3d;border-radius:10px;overflow:hidden;background:#1a1b28";
        card.innerHTML = `<img src="${image}" style="display:block;width:100%;aspect-ratio:16/9"><div style="padding:12px 15px;font-size:14px">${example.name}</div>`;
        document.querySelector("#gallery").append(card);
        results.push({
          id: example.id,
          name: example.name,
          nodeCount: engine.project.nodes.length,
          colors: colors.size,
          ok: true,
          image,
          project,
        });
      } catch (error) {
        results.push({ id: example.id, ok: false, error: String(error) });
      } finally {
        engine?.dispose();
      }
    }
    return results;
  });
  const reports = [];
  for (const item of result) {
    const { image, project, ...report } = item;
    reports.push(report);
    if (image)
      await fs.writeFile(
        path.join(root, "frontend/public/examples", item.id + ".webp"),
        Buffer.from(image.split(",")[1], "base64"),
      );
    if (project)
      await fs.writeFile(
        path.join(artifacts, "reference-projects", item.id + ".td.json"),
        JSON.stringify(project, null, 2) + "\n",
      );
  }
  await page.screenshot({
    path: path.join(root, "docs/images/reference-examples.png"),
    fullPage: true,
  });
  const report = {
    examples: reports,
    errors,
    ok: errors.length === 0 && reports.every((x) => x.ok),
  };
  await fs.writeFile(
    path.join(artifacts, "reference-examples-browser.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
