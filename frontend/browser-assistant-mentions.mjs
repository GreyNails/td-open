/** Real provider + native UI check. Run only with TD_LIVE_AI=1 and isolated data. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
if (process.env.TD_LIVE_AI !== "1") throw new Error("TD_LIVE_AI=1 required");
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8782";
process.env.TMPDIR = path.join(root, ".cache/tmp");
const artifacts = path.join(root, "data/artifacts"),
  expect = baseExpect.configure({ timeout: 30000 });
const api = async (url, body) => {
  const r = await fetch(
    base + "/api" + url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
};
if (!(await api("/health")).data_dir.includes("/.cache/"))
  throw new Error("Isolated QA required");
const fixture = await api("/examples/example_star-points");
const source = structuredClone(fixture.nodes[0]);
source.data.label = "五角星原图";
const output = structuredClone(fixture.nodes.at(-1));
output.position = { x: 750, y: 25 };
const original = {
  id: "mentions_star_" + Date.now(),
  name: "五角星 · AI 像素计算验证",
  version: 1,
  nodes: [source, output],
  edges: [
    {
      id: "original_edge",
      source: source.id,
      target: output.id,
      sourceHandle: "out",
      targetHandle: "in",
    },
  ],
};
await api("/projects", original);
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
const page = await browser.newPage({ viewport: { width: 1700, height: 1150 } }),
  checks = [],
  responses = [],
  requests = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const mark = (s) => {
  checks.push(s);
  console.log("PASS " + s);
};
async function ask(text) {
  await page.getByLabel("对话指令", { exact: true }).fill(text);
  const pending = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST",
    { timeout: 200000 },
  );
  await page.getByRole("button", { name: "发送对话", exact: true }).click();
  const r = await pending,
    data = await r.json();
  requests.push(r.request().postDataJSON());
  responses.push(data);
  expect(r.status(), JSON.stringify(data)).toBe(200);
  expect(data.mode).toBe("ai");
  return data;
}
try {
  await page.addInitScript(
    (id) => localStorage.setItem("td-open-last-project", id),
    original.id,
  );
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.locator(".studio-node")).toHaveCount(2);
  await page.getByTitle("暂停（空格）").click();
  await page
    .getByLabel("对话模型", { exact: true })
    .selectOption("deepseek-official");
  const composer = page.getByLabel("对话指令", { exact: true });
  await composer.fill("@五角星");
  await expect(
    page.getByRole("listbox", { name: "选择引用节点" }),
  ).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("@" + source.id + " ");
  await expect(page.getByLabel("引用的节点")).toContainText("五角星原图");
  mark("Chinese node search and keyboard @ selection insert an exact node ID");
  const plan = await ask(
    `@${source.id} 这张是黑底白色五角星图片。请通过节点的计算处理变成五角星的平面点云，填充内部，Z 必须为 0。不要重新生图、不要生成三维模型，不改原图。采样最长边 200，显示清晰的金色小点，连到已有输出，保留原图节点。请直接给出完整可应用的工作流提案。`,
  );
  expect(requests[0].mentioned_nodes).toEqual([source.id]);
  expect(requests[0].node_runtime[0].outputs.out).toMatchObject({
    kind: "image",
    width: 640,
    height: 360,
  });
  expect(
    plan.commands.some(
      (c) => c.op === "add_node" && c.type === "image_to_pointcloud_sop",
    ),
  ).toBe(true);
  expect(
    plan.commands.some(
      (c) => c.op === "add_node" && c.type === "pointcloud_project_top",
    ),
  ).toBe(true);
  expect(
    plan.commands.some(
      (c) => c.op === "add_node" && /^(local_|ai_|comfy_)/.test(c.type),
    ),
  ).toBe(false);
  expect((await api("/projects/" + original.id)).nodes).toHaveLength(2);
  mark(
    "Real DeepSeek receives image runtime and proposes a connected pixel-processing pipeline without generation",
  );
  await page
    .getByRole("button", { name: "应用修改", exact: true })
    .last()
    .click();
  await expect(page.locator(".studio-node")).toHaveCount(4);
  await expect(page.locator(".save-state")).toContainText("已自动保存");
  const saved = await api("/projects/" + original.id),
    cloud = saved.nodes.find((n) => n.type === "image_to_pointcloud_sop"),
    view = saved.nodes.find((n) => n.type === "pointcloud_project_top");
  expect(saved.nodes.find((n) => n.id === source.id)).toEqual(source);
  expect(
    saved.edges.some((e) => e.source === source.id && e.target === cloud.id),
  ).toBe(true);
  expect(
    saved.edges.some((e) => e.source === cloud.id && e.target === view.id),
  ).toBe(true);
  expect((await api("/validate", saved)).valid).toBe(true);
  mark(
    "Applying the proposal preserves the source and saves a valid image → points → view → output graph",
  );
  const inspection = await ask(
    `@${cloud.id} @${view.id} 只读取这两个节点的当前参数、输入输出运行摘要。报告真实点数、Z 最小最大值、图片输入尺寸和正视图输出尺寸，若还没有计算就明确说明。不修改任何节点。`,
  );
  expect(inspection.commands).toEqual([]);
  const cloudRuntime = requests[1].node_runtime.find((n) => n.id === cloud.id),
    viewRuntime = requests[1].node_runtime.find((n) => n.id === view.id);
  expect(cloudRuntime.error).toBeNull();
  expect(cloudRuntime.inputs.in.kind).toBe("image");
  expect(cloudRuntime.outputs.out.point_count).toBeGreaterThan(2000);
  expect(cloudRuntime.outputs.out.face_count).toBe(0);
  expect(cloudRuntime.outputs.out.bounds.min[2]).toBe(0);
  expect(cloudRuntime.outputs.out.bounds.max[2]).toBe(0);
  expect(viewRuntime.outputs.out).toMatchObject({
    kind: "image",
    width: 960,
    height: 540,
  });
  expect(inspection.reply).toContain(
    String(cloudRuntime.outputs.out.point_count),
  );
  mark(
    "Real @ readback reports measured point count, Z=0 bounds, connected inputs and rendered output dimensions",
  );
  await page.getByTitle("适应全部节点").click();
  await page.screenshot({
    path: path.join(artifacts, "assistant-star-pointcloud.png"),
  });
  await fs.writeFile(
    path.join(artifacts, "assistant-star-created-project.json"),
    JSON.stringify(saved, null, 2),
  );
  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(page.locator(".studio-node")).toHaveCount(2);
  await page.getByTitle("重做 Ctrl+Shift+Z").click();
  await expect(page.locator(".studio-node")).toHaveCount(4);
  mark("Generated workflow supports undo and redo");
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.locator('[data-example="star-points"]').click();
  await expect(page.locator(".studio-node")).toHaveCount(4);
  await expect(page.locator(".save-state")).toContainText("案例预览");
  expect(await api("/examples/example_star-points")).toEqual(fixture);
  mark("Bundled star raster example opens independently and remains immutable");
  expect(errors).toEqual([]);
} catch (e) {
  errors.push(e.message);
  await page
    .screenshot({
      path: path.join(artifacts, "assistant-mentions-failure.png"),
    })
    .catch(() => {});
  throw e;
} finally {
  await fs.writeFile(
    path.join(artifacts, "assistant-mentions-report.json"),
    JSON.stringify({ checks, errors, requests, responses }, null, 2),
  );
  await browser.close();
}
