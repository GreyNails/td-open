import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8766";
process.env.TMPDIR = path.join(root, ".cache/tmp");
const browser = await chromium.launch({
  executablePath: process.env.TD_CHROMIUM,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
  env: process.env,
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } }),
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const mark = (name) => {
  checks.push({ name, passed: true });
  console.log("PASS " + name);
};
const catalog = await fetch(base + "/api/catalog").then((r) => r.json());
const specs = Array.isArray(catalog) ? catalog : catalog.nodes;
const make = (id, type, x = 0, y = 0, params = {}) => ({
  id,
  type,
  position: { x, y },
  data: {
    label: specs.find((n) => n.type === type)?.label || type,
    params: {
      ...Object.fromEntries(
        (specs.find((n) => n.type === type)?.params || []).map((p) => [
          p.key,
          p.default,
        ]),
      ),
      ...params,
    },
  },
});
const edge = (source, target, targetHandle = "in", sourceHandle = "out") => ({
  id: "e_" + source + "_" + target,
  source,
  target,
  sourceHandle,
  targetHandle,
});
const open = async (project) => {
  await page.goto("about:blank");
  await page.waitForTimeout(300);
  const response = await fetch(base + "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error(await response.text());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(750);
};
try {
  const input = make("input", "network_in_top"),
    inv = make("invert", "invert", 250),
    out = make("out", "network_out_top", 500);
  const comp = make("component", "base_comp", 260);
  comp.data.graph = {
    id: "inner",
    name: "内部颜色",
    version: 1,
    nodes: [input, inv, out],
    edges: [edge("input", "invert"), edge("invert", "out")],
  };
  const project = {
    id: "qa_reference_nested",
    name: "组件与真实数据",
    version: 1,
    nodes: [
      make("red", "solid", 0, 0, { color: "#ff0000" }),
      comp,
      make("output", "output", 520),
    ],
    edges: [edge("red", "component"), edge("component", "output")],
  };
  await open(project);
  const preview = page.getByLabel("节点实时渲染画面");
  const sample = () =>
    preview.evaluate((c) =>
      Array.from(c.getContext("2d").getImageData(320, 180, 1, 1).data),
    );
  await expect
    .poll(async () => (await sample()).slice(0, 3), { timeout: 20000 })
    .toEqual([0, 255, 255]);
  await page.locator('.react-flow__node[data-id="component"]').dblclick();
  await expect(page.locator(".graph-breadcrumb")).toContainText("基础组件");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect
    .poll(async () => (await sample()).slice(0, 3), { timeout: 20000 })
    .toEqual([0, 255, 255]);
  await page.locator('.react-flow__node[data-id="invert"]').click();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await page.getByRole("button", { name: "保存作品", exact: true }).click();
  let saved = await fetch(base + "/api/projects/qa_reference_nested").then(
    (r) => r.json(),
  );
  expect(saved.nodes.length).toBe(3);
  expect(
    saved.nodes.find((n) => n.id === "component").data.graph.nodes.length,
  ).toBe(4);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page
    .locator(".graph-breadcrumb")
    .getByRole("button", { name: "project", exact: true })
    .click();
  await expect
    .poll(async () => (await sample()).slice(0, 3), { timeout: 20000 })
    .toEqual([0, 255, 255]);
  mark(
    "nested ports, double-click navigation, child save, undo and parent output",
  );
  const py = make("python", "python_script_chop");
  await open({
    id: "qa_reference_python",
    name: "Python 采样",
    version: 1,
    nodes: [py],
    edges: [],
  });
  await page.locator('.react-flow__node[data-id="python"]').click();
  await page.getByRole("button", { name: "运行 Python（本机权限）" }).click();
  await expect(page.locator(".runtime-values")).toContainText("128 样本", {
    timeout: 15000,
  });
  mark(
    "explicit Python execution returns real named sample buffer to inspector",
  );
  const web = make("web", "web_render_top", 0, 0, {
    html: '<!doctype html><title>Capture test</title><body style="background:rgb(220,30,50);color:white"><h1>TD OPEN WEB</h1></body>',
  });
  await open({
    id: "qa_reference_web",
    name: "网页捕获",
    version: 1,
    nodes: [web, make("output", "output", 250)],
    edges: [edge("web", "output")],
  });
  await page.locator('.react-flow__node[data-id="web"]').click();
  await page.getByRole("button", { name: "捕获网页", exact: true }).click();
  await expect
    .poll(async () => (await sample()).slice(0, 3), { timeout: 25000 })
    .toEqual([220, 30, 50]);
  mark(
    "Web Render actually loads isolated Chromium and returns screenshot pixels",
  );
  const movie = make("movie", "movie_file_out_top", 250);
  await open({
    id: "qa_reference_movie",
    name: "视频文件输出",
    version: 1,
    nodes: [
      make("red", "solid", 0, 0, { color: "#55aaee" }),
      movie,
      make("output", "output", 500),
    ],
    edges: [edge("red", "movie"), edge("movie", "output")],
  });
  await page.locator('.react-flow__node[data-id="movie"]').click();
  await page.getByRole("button", { name: "开始 / 停止视频录制" }).click();
  await page.waitForTimeout(1300);
  const upload = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/artifacts") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "开始 / 停止视频录制" }).click();
  const response = await upload;
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  const bytes = new Uint8Array(
    await fetch(base + result.url).then((r) => r.arrayBuffer()),
  );
  expect(Array.from(bytes.slice(0, 4))).toEqual([26, 69, 223, 163]);
  mark("Movie File Out saves a real WebM container inside project exports");
  expect(errors).toEqual([]);
  mark("no application JavaScript errors");
  await page.screenshot({
    path: path.join(root, "data/artifacts/reference-integration.png"),
  });
} finally {
  await fs.writeFile(
    path.join(root, "data/artifacts/reference-integration.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
