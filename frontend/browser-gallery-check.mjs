import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8766";
process.env.TMPDIR = path.join(root, ".cache/tmp");
const expect = baseExpect.configure({ timeout: 15000 }),
  errors = [],
  checks = [];
const mark = (name) => {
  checks.push({ name, passed: true });
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
  env: { ...process.env },
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1020 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await expect(page.locator(".example-card")).toHaveCount(62);
  await expect(page.locator(".example-summary")).toContainText("62 个案例");
  await expect(page.locator(".example-card img").first()).toHaveJSProperty(
    "complete",
    true,
  );
  expect(
    await page
      .locator(".example-card img")
      .first()
      .evaluate((img) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await page.mouse.move(18, 950);
  await page.screenshot({
    path: path.join(root, "docs/images/example-browser.png"),
    fullPage: true,
  });
  mark("62 searchable examples with real rendered preview images");
  await page.getByLabel("搜索案例", { exact: true }).fill("螺旋雕塑");
  await expect(page.locator(".example-card")).toHaveCount(1);
  await expect(page.locator(".example-card")).toHaveAttribute(
    "data-example",
    "helix-sculpture",
  );
  mark("keyword search finds the intended 3D example");
  await page.getByLabel("清空案例搜索", { exact: true }).click();
  await page
    .locator(".example-categories")
    .getByRole("button", { name: /^三维/ })
    .click();
  const threeD = await page.locator(".example-card").count();
  expect(threeD).toBeGreaterThan(3);
  expect(threeD).toBeLessThan(62);
  const categories = await page
    .locator(".example-card .example-meta span:first-child")
    .allTextContents();
  expect(categories.every((c) => c === "三维")).toBe(true);
  mark("category filter shows only 3D examples");
  await page.locator('[data-example="helix-sculpture"]').click();
  await expect(page.getByRole("dialog", { name: "示例作品" })).toBeHidden();
  await expect(page.locator(".studio-node")).toHaveCount(3);
  await expect(page.locator(".save-state")).toHaveText(/已保存|已自动保存/);
  const projects = await (
    await page.request.get(base + "/api/projects")
  ).json();
  const match = projects.find((p) => p.name.includes("螺旋雕塑"));
  expect(match).toBeTruthy();
  const project = await (
    await page.request.get(base + "/api/projects/" + match.id)
  ).json();
  expect(project.nodes.map((n) => n.type)).toEqual([
    "helix_sop",
    "render",
    "output",
  ]);
  const canvas = page.getByLabel("节点实时渲染画面");
  await page.waitForTimeout(1200);
  const colors = await canvas.evaluate((canvas) => {
    const p = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const values = new Set();
    for (let i = 0; i < p.length; i += 16)
      values.add(`${p[i]},${p[i + 1]},${p[i + 2]}`);
    return values.size;
  });
  expect(colors).toBeGreaterThan(15);
  mark(
    "opening helix sculpture creates and renders its editable three-node graph",
  );
  expect(errors).toEqual([]);
  mark("no JavaScript exceptions while browsing and opening examples");
} finally {
  await fs.writeFile(
    path.join(root, "data/artifacts/gallery-browser-results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
