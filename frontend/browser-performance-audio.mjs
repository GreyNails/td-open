/** Actual WAV, native AudioContext, post-volume PCM and visible transport controls. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8779",
  artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
const health = await fetch(base + "/api/health").then((r) => r.json());
if (!health.data_dir.includes("/.cache/"))
  throw new Error("Use isolated QA projects");
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
  checks = [],
  levels = {};
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const NativeContext = window.AudioContext;
  window.__audioContexts = [];
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args);
      window.__audioContexts.push(this);
    }
  };
});
try {
  const originalExample = await fetch(
    base + "/api/examples/example_tidal-muse",
  ).then((r) => r.json());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.locator('[data-example="tidal-muse"]').click();
  const controls = page.getByRole("region", { name: "案例音乐控制" }),
    meter = controls.getByRole("meter", { name: "音乐输出电平" }),
    level = () => meter.evaluate((el) => el.value);
  await expect(controls).toContainText("音乐未启用");
  await expect(
    controls.getByRole("button", { name: "播放生成音乐" }),
  ).toBeVisible();
  await expect.poll(level).toBe(0);
  checks.push(
    "Playback prompt and music button visible without selecting any node",
  );
  await page.getByTitle("播放音乐与画面（空格）").click();
  await expect(controls).toContainText("音乐与点云同步播放");
  await expect.poll(level, { timeout: 15000 }).toBeGreaterThan(0.001);
  await expect(page.locator(".save-state")).toContainText("案例预览");
  levels.playing = await level();
  await expect(
    page.getByRole("button", { name: "启用麦克风", exact: true }),
  ).toBeVisible();
  checks.push(
    "Ordinary transport play enables the actual music and emits nonzero post-volume PCM",
  );
  const wav = controls.getByRole("link", { name: "试听原始音乐" });
  const url = await wav.getAttribute("href");
  const bytes = Buffer.from(
    await fetch(base + url).then((r) => r.arrayBuffer()),
  );
  expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
  expect(bytes.length).toBeGreaterThan(1000000);
  checks.push("Original music audition link reads the real saved WAV");
  await controls.getByRole("button", { name: "静音音乐", exact: true }).click();
  await expect(controls).toContainText("音乐已静音");
  await expect.poll(level).toBeLessThan(0.000001);
  levels.muted = await level();
  await controls.getByRole("button", { name: "取消音乐静音" }).click();
  await expect.poll(level, { timeout: 15000 }).toBeGreaterThan(0.001);
  checks.push("Mute silences actual PCM and unmute restores it");
  await controls.getByRole("button", { name: "暂停音乐", exact: true }).click();
  await expect(controls).toContainText("音乐已暂停");
  await expect.poll(level).toBeLessThan(0.000001);
  await controls.getByRole("button", { name: "继续音乐", exact: true }).click();
  await expect.poll(level, { timeout: 15000 }).toBeGreaterThan(0.001);
  checks.push("Visible music pause and resume control the real output");
  await page.evaluate(() => window.__audioContexts.at(-1).suspend());
  await expect(controls).toContainText("浏览器声音尚未启用");
  await expect(
    controls.getByRole("button", { name: "启用浏览器声音" }),
  ).toBeVisible();
  await expect.poll(level).toBe(0);
  await controls.getByRole("button", { name: "启用浏览器声音" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__audioContexts.at(-1).state))
    .toBe("running");
  await expect.poll(level, { timeout: 15000 }).toBeGreaterThan(0.001);
  checks.push(
    "Suspended browser audio is identified and resumes from an explicit click",
  );
  await page.getByTitle("适应全部节点").click();
  await page
    .locator('.react-flow__node[data-id="pointcloud_stage_top_15"]')
    .click();
  await expect(page.locator(".performance-panel")).toContainText("4 个声部");
  await controls.getByRole("slider", { name: "音乐音量" }).fill("0.35");
  await expect(controls).toContainText("35%");
  await expect(page.getByLabel("音乐音量", { exact: true }).last()).toHaveValue(
    "0.35",
  );
  await expect.poll(level, { timeout: 15000 }).toBeGreaterThan(0.001);
  checks.push(
    "Preview volume updates the stage parameter while four stems stay synchronized",
  );
  await page.getByTitle("录制画面 WebM").click();
  await page.waitForTimeout(2400);
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/artifacts") && r.request().method() === "POST",
  );
  await page.getByTitle("停止录制").click();
  const recording = await (await saved).json();
  await fs.writeFile(
    path.join(artifacts, "music-controls-recording.webm"),
    Buffer.from(await fetch(base + recording.url).then((r) => r.arrayBuffer())),
  );
  levels.recorded = await level();
  checks.push(
    "The new audio routing still records an actual audible soundtrack",
  );
  await controls.getByRole("slider", { name: "音乐音量" }).fill("0.65");
  await expect(page.locator(".save-state")).toContainText("已自动保存");
  expect(
    await fetch(base + "/api/examples/example_tidal-muse").then((r) =>
      r.json(),
    ),
  ).toEqual(originalExample);
  await page.screenshot({
    path: path.join(artifacts, "music-controls-studio.png"),
  });
  expect(errors).toEqual([]);
  console.log("PASS music controls", JSON.stringify({ checks, levels }));
} catch (error) {
  errors.push(error.message);
  await page
    .screenshot({ path: path.join(artifacts, "music-controls-failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "music-controls-browser-report.json"),
    JSON.stringify({ checks, levels, errors }, null, 2) + "\n",
  );
  await browser.close();
}
