/** Verify the saved production artwork and real recording/export buttons. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8765",
  artifacts = path.join(root, "data/artifacts");
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
  }),
  page = await browser.newPage({ viewport: { width: 1700, height: 1080 } }),
  expect = baseExpect.configure({ timeout: 30000 }),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const report = { checks, errors };
const time = async () =>
  Number(
    (await page.locator(".performance-panel small").textContent()).match(
      /· ([\d.]+) s$/,
    )[1],
  );
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTitle("我的作品").click();
  await page
    .locator(".project-row")
    .filter({ hasText: "潮汐之像 · 已生成可播放" })
    .click();
  await expect(page.getByLabel("作品名称")).toHaveValue(
    "潮汐之像 · 已生成可播放",
  );
  await page.getByTitle("适应全部节点").click();
  await page
    .locator('.react-flow__node[data-id="pointcloud_stage_top_15"]')
    .click();
  await page
    .getByRole("button", { name: "启用音频并演出", exact: true })
    .click();
  await expect(page.locator(".performance-panel")).toContainText("4 个声部");
  await expect(page.locator(".resolution")).toHaveText("1280 × 720");
  await page.waitForTimeout(1800);
  checks.push(
    "Saved production project opens and plays all four actual WAVs at 1280x720",
  );
  await page.getByTitle("暂停（空格）").click();
  await expect(page.locator(".performance-panel")).toContainText("已暂停");
  const frozen = await time();
  await page.waitForTimeout(700);
  expect(await time()).toBeCloseTo(frozen, 1);
  await page.getByTitle("播放（空格）").click();
  await expect(page.locator(".performance-panel")).toContainText("同步播放");
  await page.waitForTimeout(800);
  await expect.poll(time,{timeout:15000}).toBeGreaterThan(frozen + 0.2);
  checks.push("Global pause and resume preserve the shared audio clock");
  await page.getByTitle("回到起点").click();
  await page.waitForTimeout(500);
  expect(await time()).toBeLessThan(1.5);
  checks.push("Rewind restarts sound and point choreography together");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前点云 PLY" }).click();
  const download = await downloading;
  await download.saveAs(path.join(artifacts, "tidal-gui-export.ply"));
  const ply = await fs.readFile(
    path.join(artifacts, "tidal-gui-export.ply"),
    "utf8",
  );
  expect(ply).toContain("element vertex 28000");
  expect(ply).not.toMatch(/NaN|Infinity/);
  checks.push("Actual GUI exports 28000 finite deformed points");
  await page.getByTitle("录制画面 WebM").click();
  await page.waitForTimeout(3500);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/artifacts") && r.request().method() === "POST",
  );
  await page.getByTitle("停止录制").click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  report.recording = await response.json();
  const media = await fetch(base + report.recording.url);
  expect(media.ok).toBe(true);
  await fs.writeFile(
    path.join(artifacts, "tidal-gui-recording.webm"),
    Buffer.from(await media.arrayBuffer()),
  );
  checks.push("Real GUI records video and performance audio into a saved WebM");
  await page.screenshot({
    path: path.join(artifacts, "tidal-muse-ready-studio.png"),
  });
  await page.getByRole("button", { name: "停止声音", exact: true }).click();
  await expect(page.locator(".performance-panel small")).toHaveCount(0);
  await page
    .getByRole("button", { name: "启用音频并演出", exact: true })
    .click();
  await expect(page.locator(".performance-panel")).toContainText("同步播放");
  checks.push("Stopping and preparing another performance works");
  await page.goto(base + "/#guide/tidal", { waitUntil: "networkidle" });
  await expect(page.locator(".docs-center")).toContainText("潮汐之像");
  const picture = page.locator(".docs-center img").first();
  await expect(picture).toHaveCount(1);
  await expect
    .poll(() => picture.evaluate((el) => el.complete && el.naturalWidth))
    .toBe(1280);
  checks.push("In-app artwork documentation and bundled screenshot work");
  expect(errors).toEqual([]);
  console.log("PASS saved artwork UI", checks);
} catch (error) {
  errors.push(error.message);
  await page
    .screenshot({ path: path.join(artifacts, "tidal-ready-failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "tidal-ready-browser-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
