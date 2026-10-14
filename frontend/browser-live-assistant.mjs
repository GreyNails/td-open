/** Opt-in paid provider check: actual chat, reviewed graph changes, save and undo. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

if (process.env.TD_LIVE_AI !== "1")
  throw new Error("Set TD_LIVE_AI=1 to authorize real provider requests.");
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8782",
  provider = process.env.TD_PROVIDER_ID || "deepseek-official",
  artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
const health = await fetch(base + "/api/health").then((r) => r.json());
if (!health.data_dir.includes("/.cache/"))
  throw new Error("Use an isolated QA data directory.");
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
  expect = baseExpect.configure({ timeout: 25000 }),
  checks = [],
  errors = [],
  responses = [];
page.on("pageerror", (error) => errors.push(error.message));
const mark = (name) => {
  checks.push(name);
  console.log("PASS " + name);
};
const api = async (url) => {
  const response = await fetch(base + url);
  if (!response.ok) throw new Error("Local API HTTP " + response.status);
  return response.json();
};
async function requestAI(message) {
  await page.getByLabel("对话指令", { exact: true }).fill(message);
  const result = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().method() === "POST",
    { timeout: 200000 },
  );
  const started = Date.now();
  await page.getByRole("button", { name: "发送对话", exact: true }).click();
  const response = await result,
    data = await response.json();
  expect(response.status(), JSON.stringify(data)).toBe(200);
  expect(data.mode).toBe("ai");
  expect(data.reply.length).toBeGreaterThan(5);
  responses.push({ elapsed_seconds: (Date.now() - started) / 1000, ...data });
  return data;
}
async function savedProject() {
  await expect(page.locator(".save-state")).toContainText("已自动保存");
  const id = await page.evaluate(() =>
    localStorage.getItem("td-open-last-project"),
  );
  return api("/api/projects/" + id);
}
const noiseParams = (graph) =>
  graph.nodes.find((n) => n.id === "noise_1").data.params;
try {
  const original = await api("/api/examples/example_flow"),
    providers = await api("/api/providers"),
    connection = providers.find((p) => p.id === provider);
  expect(connection.has_api_key).toBe(true);
  expect(connection.capability).toBe("text");
  expect(providers.every((p) => !("api_key" in p))).toBe(true);
  mark("Saved provider is available and browser responses contain no API key");

  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.locator('[data-example="flow"]').click();
  await expect(page.locator(".save-state")).toContainText("案例预览");
  await page.getByTitle("暂停（空格）").click();
  await page.getByLabel("对话模型", { exact: true }).selectOption(provider);
  await expect(page.locator(".assistant-mode")).toContainText("AI 已连接");
  await page.locator('.react-flow__node[data-id="noise_1"]').click();
  const beforeProjects = await api("/api/projects");

  const edits = await requestAI(
    "将 noise_1 的 speed 改为 0.17、scale 改为 4，并将作品重命名为“DeepSeek 创作助手验证”。只提出这三项修改，不新增、删除或连接节点。",
  );
  expect(edits.commands).toEqual(
    expect.arrayContaining([
      { op: "set_param", id: "noise_1", key: "speed", value: 0.17 },
      { op: "set_param", id: "noise_1", key: "scale", value: 4 },
      { op: "rename_project", name: "DeepSeek 创作助手验证" },
    ]),
  );
  expect(edits.commands).toHaveLength(3);
  await expect(page.locator(".command-preview")).toContainText("3 项修改");
  await expect(page.getByLabel("流动速度", { exact: true })).toHaveValue(
    String(noiseParams(original).speed),
  );
  await expect(page.locator(".save-state")).toContainText("案例预览");
  expect(await api("/api/projects")).toEqual(beforeProjects);
  mark(
    "Real AI proposes valid parameter and rename commands without applying or saving them",
  );

  await page.getByRole("button", { name: "应用修改", exact: true }).click();
  await expect(page.getByLabel("流动速度", { exact: true })).toHaveValue(
    "0.17",
  );
  await expect(page.getByLabel("纹理尺度", { exact: true })).toHaveValue("4");
  const edited = await savedProject();
  expect(edited.id).not.toBe(original.id);
  expect(edited.name).toContain("DeepSeek 创作助手验证");
  expect(edited.nodes).toHaveLength(5);
  expect(edited.edges).toEqual(original.edges);
  expect(edited.settings.source_example_id).toBe(original.id);
  expect(await api("/api/examples/example_flow")).toEqual(original);
  mark(
    "Apply updates the real graph and saves an independent project while protecting the example",
  );

  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(page.getByLabel("流动速度", { exact: true })).toHaveValue(
    String(noiseParams(original).speed),
  );
  await page.getByTitle("重做 Ctrl+Shift+Z").click();
  await expect(page.getByLabel("流动速度", { exact: true })).toHaveValue(
    "0.17",
  );
  expect((await savedProject()).id).toBe(edited.id);
  mark("AI changes support undo and redo without creating another project");

  const additions = await requestAI(
    "新增 blur 节点，id 为 deepseek_blur，radius 为 6，位置 x=520、y=250。将 color_2 的 out 连接到 deepseek_blur 的 in，再将 deepseek_blur 的 out 连接到 blur_3 的 in，替换 blur_3 原有输入。保留其他节点和参数。",
  );
  expect(
    additions.commands.some(
      (c) =>
        c.op === "add_node" && c.type === "blur" && c.id === "deepseek_blur",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "应用修改", exact: true })
    .last()
    .click();
  await expect(page.locator(".studio-node")).toHaveCount(6);
  const extended = await savedProject();
  expect(extended.id).toBe(edited.id);
  expect(
    extended.nodes.find((n) => n.id === "deepseek_blur").data.params.radius,
  ).toBe(6);
  expect(
    extended.edges.filter(
      (e) => e.target === "blur_3" && e.targetHandle === "in",
    ),
  ).toHaveLength(1);
  expect(extended.edges.find((e) => e.target === "deepseek_blur").source).toBe(
    "color_2",
  );
  expect(extended.edges.find((e) => e.target === "blur_3").source).toBe(
    "deepseek_blur",
  );
  const valid = await page.request.post(base + "/api/validate", {
    data: extended,
  });
  expect((await valid.json()).valid).toBe(true);
  expect(await api("/api/examples/example_flow")).toEqual(original);
  mark(
    "AI can add a real node and rewire compatible ports into a valid saved workflow",
  );

  await page.getByTitle("适应全部节点").click();
  await page.screenshot({
    path: path.join(artifacts, "deepseek-assistant-live.png"),
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".studio-node")).toHaveCount(6);
  expect(
    await page.evaluate(() => localStorage.getItem("td-open-last-project")),
  ).toBe(edited.id);
  mark("Reload preserves the actual AI-created workflow");
  expect(errors).toEqual([]);
} catch (error) {
  errors.push(error.message);
  await page
    .screenshot({
      path: path.join(artifacts, "deepseek-assistant-failure.png"),
    })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "deepseek-assistant-browser-report.json"),
    JSON.stringify(
      { provider_id: provider, checks, errors, responses },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
