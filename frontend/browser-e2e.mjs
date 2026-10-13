import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts");
await fs.mkdir(artifacts, { recursive: true });
process.env.TMPDIR = path.join(root, ".cache/tmp");
await fs.mkdir(process.env.TMPDIR, { recursive: true });
const checks = [],
  errors = [];
const expect = baseExpect.configure({ timeout: 20000 });
const mark = (name, extra = {}) => {
  checks.push({ name, passed: true, ...extra });
  console.log("PASS " + name);
};
const browser = await chromium.launch({
  executablePath: process.env.TD_CHROMIUM,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
  env: { ...process.env, TMPDIR: path.join(root, ".cache/tmp") },
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TD_BASE_URL || "http://127.0.0.1:8765";
let mock;
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /流光实验/ }).click();
  await page.getByTitle("暂停（空格）").click();
  await expect(page.locator(".studio-node")).toHaveCount(5);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await page.locator(".studio-node").filter({ hasText: "流动噪声" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "流动速度数值" }),
  ).toBeVisible();
  const canvas = page.getByLabel("节点实时渲染画面");
  const before = await canvas.evaluate((c) => c.toDataURL());
  await page.getByRole("spinbutton", { name: "纹理尺度数值" }).fill("6");
  await page.getByRole("spinbutton", { name: "纹理尺度数值" }).blur();
  await page.waitForTimeout(1200);
  const after = await canvas.evaluate((c) => c.toDataURL());
  expect(after).not.toBe(before);
  mark("parameter changes actual rendered pixels");
  await page.getByRole("spinbutton", { name: "流动速度数值" }).fill("0.73");
  await page.getByRole("spinbutton", { name: "流动速度数值" }).blur();
  await page.getByRole("button", { name: "保存作品", exact: true }).click();
  await expect(page.locator(".save-state")).toHaveText(/已保存|已自动保存/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("spinbutton", { name: "流动速度数值" }),
  ).toHaveValue("0.73");
  await page.getByTitle("暂停（空格）").click();
  mark("save and reload retain parameter edits");
  await page.getByLabel("对话指令").fill("速度调为 0.5");
  await page.getByRole("button", { name: "发送对话" }).click();
  await page.getByRole("button", { name: "应用修改" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "流动速度数值" }),
  ).toHaveValue("0.5");
  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(
    page.getByRole("spinbutton", { name: "流动速度数值" }),
  ).toHaveValue("0.73");
  mark("local conversation command preview, apply and undo");
  await page.getByRole("button", { name: "复制节点", exact: true }).click();
  await expect(page.locator(".studio-node")).toHaveCount(6);
  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(page.locator(".studio-node")).toHaveCount(5);
  mark("node duplicate and undo");
  await page.getByTitle("导出 PNG").click();
  await expect(page.getByRole("status")).toContainText("data/exports/");
  mark("PNG export persisted under project data directory");
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  const projects = await (
    await page.request.get(base + "/api/projects")
  ).json();
  const pid = projects[0].id;
  const original = await (
    await page.request.get(base + "/api/projects/" + pid)
  ).json();
  original.name = "MCP external edit test";
  await page.request.post(base + "/api/projects", { data: original });
  await expect(page.getByLabel("作品名称")).toHaveValue(
    "MCP external edit test",
    { timeout: 12000 },
  );
  mark("external API/MCP changes sync to clean editor");
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /空间练习/ }).click();
  await expect(page.locator(".studio-node")).toHaveCount(4);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(artifacts, "studio-3d.png") });
  mark("3D geometry preset renders and persists");
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /声音的形状/ }).click();
  await expect(page.locator(".studio-node")).toHaveCount(4);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifacts, "studio-particles.png") });
  mark("audio particle preset renders without microphone permission");
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /流光实验/ }).click();
  await expect(page.locator(".studio-node")).toHaveCount(5);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await page.getByTitle("播放（空格）").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(artifacts, "studio-desktop.png") });
  await page.getByTitle("暂停（空格）").click();
  const png = (await canvas.evaluate((c) => c.toDataURL())).split(",")[1];
  mock = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer e2e-test-secret") {
      res.writeHead(401);
      res.end(JSON.stringify({ error: { message: "missing key" } }));
      return;
    }
    res.end(JSON.stringify({ data: [{ b64_json: png }] }));
  });
  await new Promise((r) => mock.listen(8767, "127.0.0.1", r));
  await page.getByTitle("连接 AI 与 MCP").click();
  const dialog = page.getByRole("dialog");
  const initialProviders = await dialog.locator(".service").count();
  const fixtureName = "E2E Image Fixture " + Date.now();
  await dialog.getByLabel("服务名称", { exact: true }).fill(fixtureName);
  await dialog.getByLabel("生成类型").selectOption("image");
  await dialog.getByLabel("模型名称").fill("fixture-image");
  await dialog.getByLabel("API 基础地址").fill("http://127.0.0.1:8767/v1");
  await dialog.locator("input[type=password]").fill("e2e-test-secret");
  await dialog.getByRole("button", { name: "保存服务" }).click();
  await expect(dialog.locator(".service")).toHaveCount(initialProviders + 1);
  await dialog.locator(".service").filter({ hasText: fixtureName }).click();
  await dialog.getByRole("button", { name: "保存服务" }).click();
  await expect(page.getByRole("status")).toContainText("服务已保存");
  const ps = await (await page.request.get(base + "/api/providers")).json();
  const savedProvider = ps.find((p) => p.name === fixtureName);
  expect(savedProvider.has_api_key).toBe(true);
  expect(JSON.stringify(ps)).not.toContain("e2e-test-secret");
  mark("provider config updates preserve masked secrets");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.locator(".library-node").filter({ hasText: "AI 图片" }).click();
  await expect(page.locator(".studio-node")).toHaveCount(6);
  await page
    .locator(".inspector-content")
    .getByLabel("节点 AI 服务", { exact: true })
    .selectOption(savedProvider.id);
  await page.getByLabel("提示词", { exact: true }).fill("test image");
  await page.getByRole("button", { name: /运行生成/ }).click();
  await expect(page.locator(".generation-result")).toContainText("打开资源");
  const href = await page.locator(".generation-result a").getAttribute("href");
  expect(href).toMatch(/^\/api\/assets\//);
  expect((await page.request.get(base + href)).ok()).toBe(true);
  mark("AI image call, base64 asset persistence and result preview");
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /流光实验/ }).click();
  await expect(page.locator(".studio-node")).toHaveCount(5);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await page
    .locator('input[type=file][accept="image/*,video/*,audio/*"]')
    .setInputFiles({
      name: "qa-image.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await expect(page.locator(".studio-node")).toHaveCount(6);
  await expect(page.locator(".preview-title")).toContainText("qa-image.png");
  mark("local image upload and preview");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  expect(size.width).toBeLessThanOrEqual(size.viewport);
  await page.screenshot({
    path: path.join(artifacts, "studio-mobile.png"),
    fullPage: true,
  });
  mark("390px mobile layout without horizontal overflow");
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.locator('input[type=file][accept=".json,.tdopen"]').setInputFiles({
    name: "minimal-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        id: "minimal-import",
        name: "Minimal imported graph",
        version: 1,
        nodes: [
          { id: "noise", type: "noise" },
          { id: "output", type: "output" },
        ],
        edges: [{ id: "e1", source: "noise", target: "output" }],
      }),
    ),
  });
  await expect(page.locator(".studio-node")).toHaveCount(2);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  mark("minimal JSON import normalizes defaults and missing handles");
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /流光实验/ }).click();
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await page.getByTitle("播放（空格）").click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(artifacts, "studio-desktop.png") });
  expect(errors).toEqual([]);
  mark("no browser JavaScript errors");
} catch (e) {
  console.error(e);
  checks.push({ name: "failure", passed: false, message: e.message });
  await page.screenshot({
    path: path.join(artifacts, "e2e-failure.png"),
    fullPage: true,
  });
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.join(artifacts, "browser-e2e-results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
  if (mock) await new Promise((r) => mock.close(r));
}
