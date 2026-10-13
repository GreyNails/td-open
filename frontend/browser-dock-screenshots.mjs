import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8766";
process.env.TMPDIR = path.join(root, ".cache/tmp");
await fs.mkdir(process.env.TMPDIR, { recursive: true });
await fs.mkdir(path.join(root, "docs/images"), { recursive: true });
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
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const saved = () =>
  expect(page.locator(".save-state")).toHaveText(/已自动保存|已保存/, {
    timeout: 15000,
  });
try {
  for (const name of ["flow", "geometry-lab"]) {
    const seed = JSON.parse(
      await fs.readFile(
        path.join(root, `examples/${name}.tdopen.json`),
        "utf8",
      ),
    );
    seed.id = `dock_showcase_${name}_${Date.now()}`;
    seed.settings = {};
    if (name === "flow") seed.name = "流光地形 · Generative landscape";
    expect(
      (await page.request.post(base + "/api/projects", { data: seed })).ok(),
    ).toBeTruthy();
    await page.goto(base, { waitUntil: "networkidle" });
    await saved();
    await page.waitForTimeout(1500);
    const pause = page.getByTitle("暂停（空格）");
    if (await pause.isVisible()) await pause.click();
    if (name === "geometry-lab") {
      const source = await page
        .locator('.dock-panel:visible [data-dock-tab="assistant"]')
        .boundingBox();
      const target = await page
        .locator('[data-panel="inspector"]')
        .boundingBox();
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 12 },
      );
      await page.mouse.up();
      await page
        .locator('.dock-panel:visible [data-dock-tab="inspector"]')
        .click();
      await expect(page.locator('[data-panel="assistant"]')).toBeHidden();
    }
    await page.getByTitle("适应全部节点").click();
    await saved();
    await page.waitForTimeout(800);
    await page.mouse.move(17, 900);
    const file = name === "flow" ? "studio-docked.png" : "studio-merged.png";
    await page.screenshot({
      path: path.join(root, "docs/images", file),
      fullPage: true,
    });
    console.log("Saved docs/images/" + file);
  }
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
