import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts");
const base = process.env.TD_BASE_URL || "http://127.0.0.1:8766";
process.env.TMPDIR = path.join(root, ".cache/tmp");
await fs.mkdir(artifacts, { recursive: true });
await fs.mkdir(process.env.TMPDIR, { recursive: true });
const expect = baseExpect.configure({ timeout: 15000 }),
  checks = [],
  errors = [];
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
  env: { ...process.env },
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => errors.push(e.message));
let projectId;
const latest = async () => {
  const all = await (await page.request.get(base + "/api/projects")).json();
  return (
    await page.request.get(base + "/api/projects/" + (projectId || all[0].id))
  ).json();
};
const saved = () =>
  expect(page.locator(".save-state")).toHaveText(/已自动保存|已保存/);
const panel = (id) => page.locator(`[data-panel="${id}"]`);
const rect = async (id) =>
  panel(id).evaluate((el) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  }));
const pointerDrag = async (locator, dx, dy) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + dx,
    box.y + box.height / 2 + dy,
    { steps: 8 },
  );
  await page.mouse.up();
};
try {
  const seed = JSON.parse(
    await fs.readFile(path.join(root, "examples/flow.tdopen.json"), "utf8"),
  );
  seed.id = "workspace_qa_" + Date.now();
  seed.name = "自由工作台验证";
  projectId = seed.id;
  expect(
    (await page.request.post(base + "/api/projects", { data: seed })).ok(),
  ).toBeTruthy();
  await page.goto(base, { waitUntil: "networkidle" });
  await saved();
  await expect(page.locator(".workbench-title")).toContainText("99 个可用节点");
  await expect(page.locator(".dock-panel")).toHaveCount(5);
  const catalog = await (await page.request.get(base + "/api/catalog")).json();
  const specs = Array.isArray(catalog) ? catalog : catalog.nodes;
  expect(specs.filter((n) => n.type !== "python_scale")).toHaveLength(99);
  mark("99 built-in schemas agree across frontend and backend");
  await page.getByTitle("暂停（空格）").click();
  for (const id of ["library", "preview", "graph", "inspector", "assistant"]) {
    await page.getByTitle("恢复默认工作区布局").click();
    const before = await rect(id);
    await pointerDrag(panel(id).locator(".resize-se"), -32, -32);
    const resized = await rect(id);
    expect(resized.width).toBeLessThan(before.width);
    expect(resized.height).toBeLessThan(before.height);
    await pointerDrag(panel(id).locator(".dock-titlebar"), 16, 16);
    const moved = await rect(id);
    expect(moved.x).not.toBe(resized.x);
    expect(moved.y).not.toBe(resized.y);
    await saved();
    const stored = (await latest()).settings.workspace.panels[id];
    for (const key of ["x", "y", "width", "height"])
      expect(stored[key]).toBeCloseTo(moved[key], 0);
    mark(id + " panel resizes, moves and persists");
  }
  const beforeReload = await rect("assistant");
  await page.reload({ waitUntil: "networkidle" });
  await saved();
  expect(await rect("assistant")).toEqual(beforeReload);
  mark("panel geometry survives browser reload");
  await panel("preview").getByTitle("最大化实时预览面板").click();
  await expect(panel("preview")).toHaveClass(/maximized/);
  await expect(panel("graph")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel("graph")).toBeVisible();
  await panel("assistant").getByTitle("隐藏创作助手面板").click();
  await expect(panel("assistant")).not.toBeVisible();
  await page
    .locator(".workbench-foot")
    .getByRole("button", { name: "创作助手" })
    .click();
  await expect(panel("assistant")).toBeVisible();
  mark("maximize, Escape restore and hidden panel recovery");
  await page.getByRole("button", { name: "布局与面板" }).click();
  await page.getByRole("button", { name: /画布优先/ }).click();
  const bigGraph = await rect("graph");
  expect(bigGraph.width).toBeGreaterThan(1100);
  await expect(panel("assistant")).not.toBeVisible();
  await panel("graph")
    .locator(".graph-toolbar")
    .click({ position: { x: 150, y: 16 } });
  await expect(panel("preview")).toBeVisible();
  const floatingPreview = await panel("preview").boundingBox();
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-panel]")
          ?.getAttribute("data-panel"),
      { x: floatingPreview.x + 100, y: floatingPreview.y + 100 },
    ),
  ).toBe("preview");
  await page.screenshot({
    path: path.join(artifacts, "studio-canvas-layout.png"),
  });
  await page.getByTitle("恢复默认工作区布局").click();
  await saved();
  mark("canvas layout preset and one-click reset");
  await page.locator(".studio-node").filter({ hasText: "流动噪声" }).click();
  await expect(page.locator(".studio-node.selected")).toHaveCount(1);
  const beforeAdd = await latest();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("dialog", { name: "快捷添加节点" }),
  ).toBeVisible();
  await expect(page.locator(".node-search-footer input")).toBeEnabled();
  await expect(page.locator(".node-search-footer input")).toBeChecked();
  await page.getByLabel("搜索全部节点").fill("kaleidoscope");
  await expect(page.locator(".search-node-row")).toHaveCount(1);
  await page.getByTitle("收藏万花筒").click();
  await page.getByLabel("搜索全部节点").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "快捷添加节点" })).toHaveCount(
    0,
  );
  await saved();
  const added = await latest();
  expect(added.nodes.length).toBe(beforeAdd.nodes.length + 1);
  expect(added.edges.length).toBe(beforeAdd.edges.length + 1);
  expect(added.settings.favoriteNodes).toContain("kaleidoscope");
  expect(
    added.edges.some(
      (e) => e.target === added.nodes.at(-1).id && e.targetHandle === "in",
    ),
  ).toBeTruthy();
  mark("keyboard node search, favorites and automatic compatible connection");
  await page.getByTitle("适应全部节点").click();
  await page.waitForTimeout(500);
  const noise = page.locator(".studio-node").filter({ hasText: "流动噪声" }),
    color = page.locator(".studio-node").filter({ hasText: "色彩调整" });
  await noise.click();
  await page.keyboard.down("Control");
  await color.click();
  await page.keyboard.up("Control");
  await expect(page.locator(".studio-node.selected")).toHaveCount(2);
  await page.keyboard.press("Control+d");
  await saved();
  const duplicated = await latest();
  expect(duplicated.nodes.length).toBe(added.nodes.length + 2);
  expect(duplicated.edges.length).toBe(added.edges.length + 1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".studio-node")).toHaveCount(added.nodes.length);
  mark(
    "multiple selection duplicates nodes and internal links together, undo restores graph",
  );
  await noise.click();
  await page.keyboard.down("Control");
  await noise.click();
  await page.keyboard.up("Control");
  await expect(page.locator(".studio-node.selected")).toHaveCount(0);
  await page.keyboard.press("Control+d");
  await expect(page.locator(".studio-node")).toHaveCount(added.nodes.length);
  mark(
    "Ctrl-click deselects the final node; duplicate with empty selection is a no-op",
  );
  await page
    .locator(".react-flow__pane")
    .click({ button: "right", position: { x: 20, y: 20 } });
  await expect(
    page.getByRole("dialog", { name: "快捷添加节点" }),
  ).toBeVisible();
  await page.getByLabel("关闭节点搜索").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "快捷添加节点" })).toHaveCount(
    0,
  );
  await expect(page.locator(".studio-node")).toHaveCount(added.nodes.length);
  mark("canvas right-click opens search; keyboard Close does not add a node");
  await page.keyboard.press("Control+k");
  await page.getByLabel("搜索全部节点").fill("json");
  await expect(page.locator(".search-node-row").first()).toBeVisible();
  await page.keyboard.press("Escape");
  mark("Ctrl+K opens searchable DAT nodes and Escape dismisses");
  await page.getByTitle("恢复默认工作区布局").click();
  await page.screenshot({
    path: path.join(artifacts, "studio-workspace-desktop.png"),
  });
  for (const [name, count] of [
    ["万花筒与反馈", 5],
    ["双物体空间", 7],
    ["数据变成画面", 6],
  ]) {
    await page.getByRole("button", { name: "示例作品", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator(".studio-node")).toHaveCount(count);
    await saved();
    await page.waitForTimeout(400);
    const colors = await page.getByLabel("节点实时渲染画面").evaluate((c) => {
      const pixels = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      const set = new Set();
      for (let i = 0; i < pixels.length; i += 64)
        set.add(pixels.slice(i, i + 3).join(","));
      return set.size;
    });
    expect(colors).toBeGreaterThan(10);
    if (name === "数据变成画面") {
      const canvas = page.getByLabel("节点实时渲染画面");
      const before = await canvas.evaluate((c) => c.toDataURL());
      await page
        .getByLabel("CSV 内容", { exact: true })
        .fill("name,value\nangle,0.25");
      await page.getByLabel("CSV 内容", { exact: true }).blur();
      await page.waitForTimeout(500);
      expect(await canvas.evaluate((c) => c.toDataURL())).not.toBe(before);
      mark(
        "editing multiline CSV changes real output pixels through DAT and CHOP",
      );
    }

    mark(name + " preset produces varied output pixels", {
      nodes: count,
      colors,
    });
  }
  for (const width of [870, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(400);
    const dimensions = await page.evaluate(() => ({
      scroll: document.body.scrollWidth,
      viewport: innerWidth,
      height: document.body.scrollHeight,
      windowHeight: innerHeight,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(width);
    expect(dimensions.height).toBeGreaterThan(dimensions.windowHeight);
    await panel("assistant").scrollIntoViewIfNeeded();
    await expect(page.getByLabel("对话指令")).toBeVisible();
    mark(
      width +
        "px compact workspace scrolls to every panel without horizontal overflow",
    );
  }
  expect(errors).toEqual([]);
  mark("no browser JavaScript exceptions");
} catch (error) {
  await page.screenshot({
    path: path.join(artifacts, "workspace-qa-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "workspace-qa-results.json"),
    JSON.stringify({ base, checks, errors }, null, 2),
  );
  await browser.close();
}
