import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
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
    viewport: { width: 1460, height: 1100 },
  });
  await page.route("**/variants.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><meta charset="UTF-8"><body></body></html>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "variants.html");
  const report = await page.evaluate(async () => {
    const { StudioEngine } = await import("/src/engine.ts"),
      { preset, makeNode } = await import("/src/catalog.ts");
    const variants = [
      ["cell-lights", "default", {}],
      [
        "cell-lights",
        "neon cells 10",
        {
          cellular: { scale: 10, color: "#ffffff", background: "#000000" },
          edge: { amount: 8, threshold: 0.12 },
          duotone: { color: "#86f6ff", background: "#050d20" },
        },
      ],
      [
        "cell-lights",
        "neon cells 14",
        {
          cellular: { scale: 14, color: "#ffffff", background: "#000000" },
          edge: { amount: 6, threshold: 0.15 },
          duotone: { color: "#ba9bff", background: "#090821" },
        },
      ],
      ["cell-lights", "gain 4", { edge: { amount: 4, threshold: 0.02 } }],
      ["cell-lights", "gain 8", { edge: { amount: 8, threshold: 0.06 } }],
      [
        "cell-lights",
        "silver 10",
        {
          cellular: { scale: 10, color: "#ffffff", background: "#050512" },
          edge: { amount: 4, threshold: 0.14 },
        },
      ],
      [
        "cell-lights",
        "azure 14",
        {
          cellular: { scale: 14, color: "#aef8ff", background: "#0b1027" },
          edge: { amount: 5, threshold: 0.2 },
        },
      ],
      [
        "cell-lights",
        "wide contour",
        {
          cellular: { scale: 12, color: "#ffffff", background: "#050512" },
          edge: { amount: 8, threshold: 0.45 },
        },
      ],
      ["liquid-metal", "default", {}],
      ["liquid-metal", "gain 8", { emboss: { amount: 8, angle: 45 } }],
      [
        "liquid-metal",
        "silver rough",
        {
          fbm_noise: {
            scale: 6,
            octaves: 5,
            roughness: 0.72,
            color: "#ffffff",
            background: "#05050a",
          },
          emboss: { amount: 7, angle: 45 },
          color_balance: { red: 0.85, green: 1, blue: 1.2 },
        },
      ],
      [
        "liquid-metal",
        "gold terrain",
        {
          fbm_noise: {
            scale: 8,
            octaves: 5,
            roughness: 0.65,
            color: "#ffffff",
            background: "#000000",
          },
          emboss: { amount: 8, angle: 45 },
          color_balance: { red: 1.3, green: 1, blue: 0.7 },
        },
      ],
      [
        "liquid-metal",
        "cool coarse",
        {
          fbm_noise: {
            scale: 8,
            octaves: 3,
            roughness: 0.7,
            color: "#ffffff",
            background: "#000000",
          },
          emboss: { amount: 8, angle: 135 },
          color_balance: { red: 0.9, green: 1, blue: 1.2 },
        },
      ],
      [
        "liquid-metal",
        "silver fine",
        {
          fbm_noise: {
            scale: 12,
            octaves: 5,
            roughness: 0.65,
            color: "#ffffff",
            background: "#000000",
          },
          emboss: { amount: 8, angle: 45 },
          color_balance: { red: 0.9, green: 1, blue: 1.1 },
        },
      ],
    ];
    document.head.insertAdjacentHTML(
      "beforeend",
      "<style>body{background:#10141e;color:#eee;padding:24px;font:18px sans-serif}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.item canvas{width:100%}.item h3{margin:0 0 10px}.item p{font-size:13px}</style>",
    );
    document.body.innerHTML = '<div class="grid"></div>';
    const engine = new StudioEngine(preset()),
      report = [];
    for (const [id, label, params] of variants) {
      const project = preset(id);
      if (label.includes("neon")) {
        project.nodes = [
          "cellular",
          "edge",
          "invert",
          "duotone",
          "blur",
          "output",
        ].map((type) => makeNode(type, 0, 0));
        project.edges = project.nodes
          .slice(1)
          .map((n, i) => ({
            id: "e" + i,
            source: project.nodes[i].id,
            target: n.id,
            sourceHandle: "out",
            targetHandle: "in",
          }));
      }
      for (const node of project.nodes)
        Object.assign(node.data.params, params[node.type] ?? {});
      engine.setProject(project);
      const output = engine.render(0.75),
        canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(output, 0, 0);
      const data = ctx.getImageData(0, 0, 640, 360).data;
      let sum = 0,
        square = 0;
      for (let i = 0; i < data.length; i += 4) {
        const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += l;
        square += l * l;
      }
      const mean = sum / (640 * 360),
        variance = square / (640 * 360) - mean * mean;
      report.push({
        id,
        label,
        params,
        mean,
        variance,
        errors: [...engine.errors],
      });
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `<h3>${id} / ${label}</h3><p>mean ${mean.toFixed(1)} / variance ${variance.toFixed(1)}</p>`;
      item.append(canvas);
      document.querySelector(".grid").append(item);
    }
    engine.dispose();
    return report;
  });
  await fs.writeFile(
    path.join(root, "data/artifacts/template-variant-report.json"),
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({
    path: path.join(root, "data/artifacts/template-variant-sheet.png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify(
      report.map(({ id, label, mean, variance, errors }) => ({
        id,
        label,
        mean,
        variance,
        errors,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
