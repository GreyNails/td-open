/** Native input interactions against a real isolated backend; no AI billing. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8782";
process.env.TMPDIR = path.join(root, ".cache/tmp");
const health = await fetch(base + "/api/health").then((r) => r.json());
if (!health.data_dir.includes("/.cache/"))
  throw new Error("Use isolated QA data");
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
  expect = baseExpect.configure({ timeout: 20000 }),
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const mark = (name) => {
  checks.push(name);
  console.log("PASS " + name);
};
const box = page.getByLabel("对话指令", { exact: true });
const node = (id) =>
  page.locator(`.react-flow__node[data-id="${id}"] .node-heading`);
async function send() {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/chat") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送对话", exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(200);
  await expect(page.locator(".thinking")).toHaveCount(0);
  return r.request().postDataJSON();
}
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.locator('[data-example="star-points"]').click();
  await expect(page.locator(".studio-node")).toHaveCount(4);
  await page.getByTitle("暂停（空格）").click();
  await page.getByTitle("适应全部节点").click();
  await box.fill("请查看 @");
  await node("media_1").click();
  await expect(box).toHaveValue("请查看 @media_1 ");
  await expect(box).toBeFocused();
  await expect(page.getByLabel("引用的节点")).toContainText("图片 / 视频");
  mark(
    "Typing @ then clicking a canvas node inserts its ID and restores input focus",
  );
  await box.press("End");
  await box.pressSequentially("以及 @");
  await node("image_to_pointcloud_sop_2").click();
  await expect(box).toHaveValue(
    "请查看 @media_1 以及 @image_to_pointcloud_sop_2 ",
  );
  const first = await box.inputValue(),
    request = await send();
  expect(request.mentioned_nodes).toEqual([
    "media_1",
    "image_to_pointcloud_sop_2",
  ]);
  expect(
    request.node_runtime.find((n) => n.id === "image_to_pointcloud_sop_2")
      .outputs.out.point_count,
  ).toBeGreaterThan(2000);
  mark(
    "Multiple canvas picks reach the backend with the correct runtime snapshots",
  );
  await box.fill("解释一下当前项目");
  await send();
  await box.press("ArrowUp");
  await expect(box).toHaveValue("解释一下当前项目");
  await box.press("ArrowUp");
  await expect(box).toHaveValue(first);
  await box.press("ArrowUp");
  await expect(box).toHaveValue(first);
  await box.press("ArrowDown");
  await expect(box).toHaveValue("解释一下当前项目");
  await box.press("ArrowDown");
  await expect(box).toHaveValue("");
  mark(
    "Up recalls sent messages oldest-bound safely; Down returns through history to the empty draft",
  );
  await box.fill("这段草稿还没有发送");
  await box.press("ArrowUp");
  await expect(box).toHaveValue("解释一下当前项目");
  await box.press("ArrowDown");
  await expect(box).toHaveValue("这段草稿还没有发送");
  mark("Unsent draft survives history navigation");
  await box.fill("首行\n正在编辑的第二行");
  await box.press("ArrowUp");
  await expect(box).toHaveValue("首行\n正在编辑的第二行");
  await box.fill("@");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(box).toHaveValue("@image_to_pointcloud_sop_2 ");
  mark(
    "Multiline editing and mention-menu arrows take precedence over history",
  );
  await box.fill("比较 @ 后面的文字");
  await box.press("Home");
  for (let i = 0; i < 4; i++) await box.press("ArrowRight");
  await node("media_1").click();
  await expect(box).toHaveValue("比较 @media_1  后面的文字");
  mark("Picking in the middle preserves the text before and after the mention");
  await box.fill("@不存在");
  await box.press("Escape");
  await node("media_1").click();
  await expect(box).toHaveValue("@不存在");
  await box.fill("普通编辑");
  await node("image_to_pointcloud_sop_2").click();
  await expect(box).toHaveValue("普通编辑");
  mark(
    "Escape cancels even an unmatched mention; ordinary node selection does not change the draft",
  );
  await expect(page.locator(".save-state")).toContainText("案例预览");
  await box.fill("@");
  await node("media_1").click();
  await page.screenshot({
    path: path.join(root, "data/artifacts/assistant-input-interactions.png"),
  });
  expect(errors).toEqual([]);
  mark(
    "Input actions leave the example unchanged and produce no browser errors",
  );
} catch (e) {
  errors.push(e.message);
  await page
    .screenshot({
      path: path.join(root, "data/artifacts/assistant-input-failure.png"),
    })
    .catch(() => {});
  throw e;
} finally {
  await fs.writeFile(
    path.join(root, "data/artifacts/assistant-input-report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
