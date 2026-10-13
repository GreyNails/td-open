import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";

// Read the actual published JSON files. No createPreset/decorator/reconstruction is used.
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts"),
  temp = path.join(root, ".cache/tmp");
const definitions = await fs.readFile(
  path.join(root, "frontend/src/referenceTemplates.ts"),
  "utf8",
);
const ids = [...definitions.matchAll(/^\s+id: "([a-z][a-z0-9-]+)",/gm)].map(
  (match) => match[1],
);
if (ids.length !== 20)
  throw Error(`Expected 20 reference templates, received ${ids.length}`);
const exports = await Promise.all(
  ids.map(async (id) => ({
    id,
    filename: `examples/${id}.tdopen.json`,
    project: JSON.parse(
      await fs.readFile(
        path.join(root, "examples", id + ".tdopen.json"),
        "utf8",
      ),
    ),
  })),
);
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
  await page.route("**/reference-exports-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:32px;background:#14131e;color:#eee;font-family:Arial,sans-serif"><p style="color:#bca1f0;letter-spacing:4px;font-size:12px">TD OPEN · EXPORTED PROJECTS</p><h1>20 个开源案例文件，直接载入并运行</h1><p style="color:#aaa">从 examples/*.tdopen.json 读取 · 检查稳定 ID、节点引用与组件内部连接 · 使用实际渲染引擎</p><div id="gallery" style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px"></div>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "reference-exports-qa.html");
  const results = await page.evaluate(async (exports) => {
    const { byType } = await import("/src/catalog.ts"),
      { StudioEngine } = await import("/src/engine.ts"),
      { operatorPath } = await import("/src/networks.ts");
    const reports = [];
    for (const item of exports) {
      let engine;
      try {
        let nestedGraphs = 0,
          edgesChecked = 0;
        const validateGraph = (project) => {
          if (
            new Set(project.nodes.map((node) => node.id)).size !==
            project.nodes.length
          )
            throw Error("Duplicate IDs in " + project.id);
          for (const node of project.nodes) {
            if (!byType[node.type])
              throw Error("Unregistered node " + node.type);
            for (const key of Object.keys(node.data.params))
              if (!byType[node.type].params.some((param) => param.key === key))
                throw Error(`${node.type} has unknown parameter ${key}`);
            if (node.data.graph) {
              nestedGraphs++;
              validateGraph(node.data.graph);
            }
          }
          for (const edge of project.edges) {
            const source = project.nodes.find(
                (node) => node.id === edge.source,
              ),
              target = project.nodes.find((node) => node.id === edge.target);
            if (!source || !target) throw Error("Dangling edge " + edge.id);
            const sourcePort = byType[source.type].outputs.find(
                (port) => port.id === (edge.sourceHandle ?? "out"),
              ),
              targetPort = byType[target.type].inputs.find(
                (port) => port.id === (edge.targetHandle ?? "in"),
              );
            if (!sourcePort || !targetPort)
              throw Error("Unknown port " + edge.id);
            if (
              sourcePort.kind !== targetPort.kind &&
              ![sourcePort.kind, targetPort.kind].includes("any")
            )
              throw Error("Port kind mismatch " + edge.id);
            edgesChecked++;
          }
        };
        validateGraph(item.project);
        engine = new StudioEngine(item.project);
        const compiledIDs = new Set(
            engine.project.nodes.map((node) => node.id),
          ),
          references = [];
        for (const node of engine.project.nodes)
          for (const key of ["source", "path"]) {
            const value = node.data.params[key];
            if (typeof value !== "string" || !value.startsWith("/")) continue;
            const scope = node.id.includes("/")
                ? node.id.slice(0, node.id.lastIndexOf("/") + 1)
                : "",
              resolved = operatorPath(scope, value);
            if (!compiledIDs.has(resolved))
              throw Error(
                `${node.id}.${key} unresolved stable reference ${value} → ${resolved}`,
              );
            references.push({ node: node.id, key, value, resolved });
          }
        let frame;
        for (const time of [0, 0.016, 0.033, 0.1, 0.25, 0.5, 1, 1.5])
          frame = engine.render(time);
        if (engine.errors.size) throw Error(JSON.stringify([...engine.errors]));
        const rgba = frame
            .getContext("2d")
            .getImageData(0, 0, frame.width, frame.height).data,
          colors = new Set();
        let lit = 0;
        for (let i = 0; i < rgba.length; i += 32) {
          colors.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
          if (rgba[i] + rgba[i + 1] + rgba[i + 2] > 90) lit++;
        }
        if (colors.size < 3 || !lit)
          throw Error("Output lacks visible variation");
        const thumb = document.createElement("canvas");
        thumb.width = 480;
        thumb.height = 270;
        thumb.getContext("2d").drawImage(frame, 0, 0, 480, 270);
        const card = document.createElement("div");
        card.style.cssText =
          "border:1px solid #393141;border-radius:10px;overflow:hidden;background:#201c2b";
        const image = document.createElement("img");
        image.src = thumb.toDataURL("image/webp", 0.85);
        image.style.cssText = "width:100%;display:block";
        card.append(image);
        const title = document.createElement("p");
        title.textContent = item.project.name;
        title.style.cssText = "margin:0;padding:13px;font-size:14px";
        card.append(title);
        document.querySelector("#gallery").append(card);
        reports.push({
          id: item.id,
          file: item.filename,
          ok: true,
          nodes: engine.project.nodes.length,
          edgesChecked,
          nestedGraphs,
          references,
          colors: colors.size,
          litSamples: lit,
        });
      } catch (error) {
        reports.push({
          id: item.id,
          file: item.filename,
          ok: false,
          error: String(error),
        });
      } finally {
        engine?.dispose();
      }
    }
    return reports;
  }, exports);
  const report = {
    generatedAt: new Date().toISOString(),
    source: "examples/*.tdopen.json",
    examples: results,
    errors,
    ok: errors.length === 0 && results.every((result) => result.ok),
  };
  await page.screenshot({
    path: path.join(root, "docs/images/exported-reference-examples.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(artifacts, "reference-exports-browser.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
