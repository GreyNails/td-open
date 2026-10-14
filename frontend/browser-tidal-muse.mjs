/** Real browser, real local GPU jobs, no request interception or synthetic media. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8778",
  artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
const health = await fetch(base + "/api/health").then((r) => r.json());
if (!health.data_dir.includes("/.cache/"))
  throw new Error("Use isolated QA data");
const project = JSON.parse(
    await fs.readFile(
      path.join(root, "examples/tidal-muse.tdopen.json"),
      "utf8",
    ),
  ),
  stage = project.nodes.find((n) => n.type === "pointcloud_stage_top");
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
  expect = baseExpect.configure({ timeout: 30000 });
page.setDefaultTimeout(30000);
const errors = [],
  jobs = [],
  report = { checks: [], errors, jobs };
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", async (response) => {
  if (
    response.url().endsWith("/api/local-ai/generate") &&
    response.request().method() === "POST" &&
    response.ok()
  ) {
    const job = await response.json();
    jobs.push(job);
    console.log("GPU JOB", job.profile_id, job.id);
  }
});
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page
    .locator('input[accept=".json,.tdopen"]')
    .setInputFiles(path.join(root, "examples/tidal-muse.tdopen.json"));
  await expect(page.getByLabel("作品名称")).toHaveValue(project.name);
  await page.getByTitle("适应全部节点").click();
  await page.locator('.react-flow__node[data-id="' + stage.id + '"]').click();
  await expect(page.locator(".performance-panel")).toBeVisible();
  await page.getByRole("button", { name: "生成整件作品", exact: true }).click();
  const started = Date.now();
  let previous = "";
  while (Date.now() - started < 3600000) {
    const text = await page
      .locator('.performance-panel [role="status"]')
      .textContent();
    if (text !== previous) {
      console.log(text);
      previous = text;
    }
    if (text?.includes("四步素材已生成")) break;
    if (text && /失败|不能|没有完成|请先|已取消|已停止后续/.test(text))
      throw new Error(text);
    await page.waitForTimeout(2200);
  }
  expect(jobs).toHaveLength(4);
  report.jobs = [];
  for (const job of jobs) {
    const actual = await fetch(base + "/api/local-ai/jobs/" + job.id).then(
      (r) => r.json(),
    );
    expect(actual.status).toBe("succeeded");
    expect(actual.peak_vram_mib).toBeLessThanOrEqual(24576);
    report.jobs.push(actual);
  }
  report.checks.push(
    "Four local GPU jobs generated through one real workflow button",
  );
  await page
    .getByRole("button", { name: "启用音频并演出", exact: true })
    .click();
  await expect(page.locator(".performance-panel")).toContainText("4 个声部");
  await expect(page.locator(".performance-panel")).toContainText("同步播放");
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "保存作品", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(artifacts, "tidal-muse-studio.png"),
  });
  const projectList = await fetch(base + "/api/projects").then((r) => r.json());
  const saved = projectList.find((p) => p.name === project.name);
  if (!saved) throw new Error("Saved performance project missing");
  report.project = await fetch(base + "/api/projects/" + saved.id).then((r) =>
    r.json(),
  );
  await fs.writeFile(
    path.join(artifacts, "tidal-muse-generated-project.json"),
    JSON.stringify(report.project, null, 2) + "\n",
  );
  report.checks.push(
    "All four actual WAV stems decoded and played on one shared audio clock",
  );
  expect(errors).toEqual([]);
  console.log(
    "PASS real local generation and synchronized point cloud performance",
  );
} catch (error) {
  errors.push(error.message);
  await page
    .screenshot({ path: path.join(artifacts, "tidal-muse-failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "tidal-muse-live-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
