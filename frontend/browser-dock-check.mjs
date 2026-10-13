import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8766";
const artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
await fs.mkdir(artifacts, { recursive: true });
await fs.mkdir(process.env.TMPDIR, { recursive: true });
const expect = baseExpect.configure({ timeout: 15000 }),
  checks = [],
  errors = [];
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
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => errors.push(e.message));
const panel = (id) => page.locator(`[data-panel="${id}"]`);
const tab = (id) => page.locator(`.dock-panel:visible [data-dock-tab="${id}"]`);
const saved = () =>
  expect(page.locator(".save-state")).toHaveText(/已自动保存|已保存/);
const bounds = async (id) => panel(id).boundingBox();
const drag = async (locator, destination) => {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await page.mouse.up();
};
const resize = async (id, dx, dy) => {
  const locator = page.locator(`[data-splitter="${id}"]`),
    b = await locator.boundingBox();
  await drag(locator, {
    x: b.x + b.width / 2 + dx,
    y: b.y + b.height / 2 + dy,
  });
};
try {
  const seed = JSON.parse(
    await fs.readFile(path.join(root, "examples/flow.tdopen.json"), "utf8"),
  );
  seed.id = "dock_qa_" + Date.now();
  seed.name = "联动工作台验证";
  seed.settings = {};
  expect(
    (await page.request.post(base + "/api/projects", { data: seed })).ok(),
  ).toBeTruthy();
  await page.goto(base, { waitUntil: "networkidle" });
  await saved();
  await expect(page.locator(".dock-splitter")).toHaveCount(4);
  const canvas = page.getByLabel("节点实时渲染画面");
  await canvas.evaluate((el) => (el.dataset.dockQa = "persistent-canvas"));
  await page.getByTitle("暂停（空格）").click();
  const l1 = await bounds("library"),
    p1 = await bounds("preview");
  await resize("studio-main", 60, 0);
  const l2 = await bounds("library"),
    p2 = await bounds("preview");
  expect(l2.width - l1.width).toBeGreaterThan(50);
  expect(p2.x - p1.x).toBeGreaterThan(50);
  expect(p2.width).toBeLessThan(p1.width);
  mark(
    "shared vertical separator expands the left area while shrinking the neighboring area",
  );
  const p3 = await bounds("preview"),
    g3 = await bounds("graph");
  await resize("studio-editors", 0, 48);
  const p4 = await bounds("preview"),
    g4 = await bounds("graph");
  expect(p4.height - p3.height).toBeGreaterThan(40);
  expect(g3.height - g4.height).toBeGreaterThan(40);
  expect(p4.height + g4.height).toBeCloseTo(p3.height + g3.height, 1);
  mark("shared horizontal separator preserves total area height");
  await page.locator('[data-splitter="studio-main"]').focus();
  const beforeKey = await bounds("library");
  await page.keyboard.press("ArrowRight");
  expect((await bounds("library")).width).toBeGreaterThan(beforeKey.width);
  mark("shared separators are keyboard adjustable");
  const target = await bounds("inspector");
  await drag(tab("assistant"), {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  });
  await expect(page.locator(".dock-splitter")).toHaveCount(3);
  await expect(panel("assistant")).toBeVisible();
  await expect(panel("inspector")).toBeHidden();
  await expect(tab("inspector")).toBeVisible();
  await tab("inspector").click();
  await expect(panel("inspector")).toBeVisible();
  await expect(panel("assistant")).toBeHidden();
  mark(
    "dragging a panel into the center merges it into a switchable tab group",
  );
  const preview = await bounds("preview");
  await drag(tab("assistant"), {
    x: preview.x + 12,
    y: preview.y + preview.height / 2,
  });
  await expect(page.locator(".dock-splitter")).toHaveCount(4);
  const moved = await bounds("assistant"),
    previewMoved = await bounds("preview");
  expect(moved.x + moved.width).toBeCloseTo(previewMoved.x - 4, 1);
  expect(moved.y).toBeCloseTo(previewMoved.y, 1);
  mark("dragging a merged tab to a side creates a new adjoining split area");
  for (const side of ["right", "top", "bottom"]) {
    const area = await bounds("preview");
    const destination =
      side === "right"
        ? { x: area.x + area.width - 12, y: area.y + area.height / 2 }
        : {
            x: area.x + area.width / 2,
            y: side === "top" ? area.y + 40 : area.y + area.height - 12,
          };
    await drag(tab("assistant"), destination);
    const assistantArea = await bounds("assistant"),
      previewArea = await bounds("preview");
    if (side === "right")
      expect(assistantArea.x).toBeCloseTo(
        previewArea.x + previewArea.width + 4,
        1,
      );
    if (side === "top")
      expect(assistantArea.y + assistantArea.height + 4).toBeCloseTo(
        previewArea.y,
        1,
      );
    if (side === "bottom")
      expect(assistantArea.y).toBeCloseTo(
        previewArea.y + previewArea.height + 4,
        1,
      );
  }
  mark("right, top, and bottom drop zones also produce adjoining split areas");
  expect(await canvas.getAttribute("data-dock-qa")).toBe("persistent-canvas");
  mark("docking keeps the existing preview canvas mounted");
  await saved();
  const beforeReload = await bounds("assistant");
  await page.reload({ waitUntil: "networkidle" });
  await expect(panel("assistant")).toBeVisible();
  expect((await bounds("assistant")).x).toBeCloseTo(beforeReload.x, 1);
  expect((await bounds("assistant")).width).toBeCloseTo(beforeReload.width, 1);
  const stored = await (
    await page.request.get(base + "/api/projects/" + seed.id)
  ).json();
  expect(stored.settings.workspace.version).toBe(2);
  mark("split tree, tab groups, and resized boundaries persist across reload");
  await page.getByTitle("最大化实时预览面板").click();
  await expect(panel("preview")).toBeVisible();
  await expect(panel("graph")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(panel("graph")).toBeVisible();
  await page.getByTitle("隐藏节点资源面板").click();
  await expect(panel("library")).toBeHidden();
  await page
    .locator(".workbench-foot")
    .getByRole("button", { name: "节点资源", exact: true })
    .click();
  await expect(panel("library")).toBeVisible();
  mark("maximize, Escape restore, hide, and reopen operate on docked areas");
  await page.getByTitle("恢复默认工作区布局").click();
  await saved();
  await page.screenshot({
    path: path.join(artifacts, "dock-workspace-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workbench.compact")).toBeVisible();
  for (const id of ["preview", "graph", "library", "inspector", "assistant"])
    await expect(panel(id)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(artifacts, "dock-workspace-mobile.png"),
    fullPage: true,
  });
  mark("narrow screens stack all editors without horizontal overflow");
  expect(errors).toEqual([]);
  mark("no browser JavaScript exceptions");
} catch (error) {
  await page.screenshot({
    path: path.join(artifacts, "dock-workspace-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "dock-workspace-results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  await browser.close();
}
