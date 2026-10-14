/** Real editing sessions, immutable case API, box selection and endpoint geometry. */
import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  base = process.env.TD_BASE_URL || "http://127.0.0.1:8780",
  artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
const health = await fetch(base + "/api/health").then((r) => r.json());
if (!health.data_dir.includes("/.cache/"))
  throw new Error("Use isolated QA store");
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
  expect = baseExpect.configure({ timeout: 20000 }),
  errors = [],
  checks = [];
const a = await browser.newContext({ viewport: { width: 1700, height: 1150 } }),
  b = await browser.newContext({ viewport: { width: 1700, height: 1150 } }),
  page = await a.newPage(),
  other = await b.newPage();
for (const p of [page, other]) p.on("pageerror", (e) => errors.push(e.message));
const api = async (url) => (await fetch(base + url)).json(),
  selected = () => page.locator(".react-flow__node.selected"),
  loc = (id) => page.locator('.react-flow__node[data-id="' + id + '"]');
async function openExample(p, id) {
  await p.getByRole("button", { name: "示例作品", exact: true }).click();
  await p.locator('[data-example="' + id + '"]').click();
  await expect(p.locator(".save-state")).toContainText("案例预览");
  await p.getByTitle("适应全部节点").click();
}
async function savedProject(p) {
  await expect(p.locator(".save-state")).toContainText("已自动保存");
  const id = await p.evaluate(() =>
    localStorage.getItem("td-open-last-project"),
  );
  return api("/api/projects/" + id);
}
try {
  const original = await api("/api/examples/example_flow");
  await page.goto(base, { waitUntil: "networkidle" });
  await other.goto(base, { waitUntil: "networkidle" });
  await openExample(page, "flow");
  await openExample(other, "flow");
  const before = await api("/api/projects");
  await page.waitForTimeout(1600);
  expect((await api("/api/projects")).length).toBe(before.length);
  checks.push(
    "Viewing an example in two browser sessions does not save or modify its original",
  );
  await loc("noise_1").click();
  await page.getByLabel("纹理尺度", { exact: true }).fill("4");
  const copyA = await savedProject(page);
  await other.locator('.react-flow__node[data-id="noise_1"]').click();
  await other.getByLabel("纹理尺度", { exact: true }).fill("5");
  const copyB = await savedProject(other);
  expect(copyA.id).not.toBe(copyB.id);
  expect(copyA.id).not.toBe(original.id);
  expect(copyA.name).toContain("我的作品");
  expect(copyA.settings.source_example_id).toBe(original.id);
  expect(copyB.nodes[0].data.params.scale).toBe(5);
  expect(await api("/api/examples/example_flow")).toEqual(original);
  checks.push(
    "First edit automatically creates different saved project copies for two users",
  );
  await page.getByLabel("纹理尺度", { exact: true }).fill("6");
  const again = await savedProject(page);
  expect(again.id).toBe(copyA.id);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("作品名称")).toHaveValue(copyA.name);
  expect(
    await page.evaluate(() => localStorage.getItem("td-open-last-project")),
  ).toBe(copyA.id);
  checks.push(
    "Further edits and reload continue the same personal project without altering the example",
  );
  await page.getByTitle("适应全部节点").click();
  await page.getByRole("button", { name: "框选节点", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "框选节点", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const nbox = await loc("noise_1").boundingBox(),
    cbox = await loc("color_2").boundingBox();
  const start = { x: nbox.x - 10, y: nbox.y - 8 },
    end = { x: cbox.x + cbox.width + 7, y: cbox.y + cbox.height + 7 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(page.locator(".react-flow__selection")).toBeVisible();
  await page.screenshot({
    path: path.join(artifacts, "editor-box-selection.png"),
  });
  await page.mouse.up();
  await expect(selected()).toHaveCount(2);
  checks.push(
    "Left-drag marquee selects both intersecting nodes and retains the selection",
  );
  const oldNoise = await loc("noise_1").boundingBox(),
    oldColor = await loc("color_2").boundingBox();
  await page.mouse.move(oldNoise.x + oldNoise.width * 0.5, oldNoise.y + 12);
  await page.mouse.down();
  await page.mouse.move(
    oldNoise.x + oldNoise.width * 0.5 + 35,
    oldNoise.y + 45,
    { steps: 8 },
  );
  await page.mouse.up();
  const newNoise = await loc("noise_1").boundingBox(),
    newColor = await loc("color_2").boundingBox();
  expect(newNoise.x - oldNoise.x).toBeGreaterThan(20);
  expect(newColor.x - oldColor.x).toBeCloseTo(newNoise.x - oldNoise.x, 0);
  await expect(selected()).toHaveCount(2);
  checks.push("Dragging a selected node moves the selected group together");
  await page.locator(".flow-container").focus();
  await page.keyboard.press("Control+d");
  await expect(selected()).toHaveCount(2);
  await expect(page.locator(".studio-node")).toHaveCount(7);
  await page.keyboard.press("Delete");
  await expect(page.locator(".studio-node")).toHaveCount(5);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".studio-node")).toHaveCount(7);
  checks.push("Box-selected nodes support group copy, delete and undo");
  await openExample(page, "tidal-muse");
  const dance = loc("pointcloud_dance_sop_14");
  const containment = await dance.evaluate((el) => {
    const card = el.querySelector(".studio-node").getBoundingClientRect();
    return [...el.querySelectorAll(".react-flow__handle")].map((handle) => {
      const h = handle.getBoundingClientRect();
      return {
        id: handle.dataset.handleid,
        y: h.y + h.height / 2,
        top: card.top,
        bottom: card.bottom,
      };
    });
  });
  expect(containment).toHaveLength(6);
  for (const p of containment) {
    expect(p.y).toBeGreaterThan(p.top);
    expect(p.y).toBeLessThan(p.bottom);
  }
  checks.push(
    "All five input ports and the output remain inside the choreography node",
  );
  const source = page.locator(
      '.react-flow__node[data-id="audio_envelope_chop_10"] .react-flow__handle[data-handleid="out"]',
    ),
    target = page.locator(
      '.react-flow__node[data-id="pointcloud_dance_sop_14"] .react-flow__handle[data-handleid="other"]',
    );
  await source.hover();
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const rewired = await savedProject(page);
  expect(
    rewired.edges.filter(
      (e) =>
        e.target === "pointcloud_dance_sop_14" && e.targetHandle === "other",
    ),
  ).toHaveLength(1);
  expect(rewired.edges.find((e) => e.targetHandle === "other").source).toBe(
    "audio_envelope_chop_10",
  );
  checks.push(
    "Dragging to the fifth input port creates a real saved connection",
  );

  const verifyEndpoints = async () => {
    const graph = await savedProject(page);
    // Measure paths and their ports in one frame, including during fit-view animation.
    const rows = await page.evaluate(
      (graph) =>
        [...document.querySelectorAll(".react-flow__edge[data-testid]")].map(
          (element) => {
            const id = element
                .getAttribute("data-testid")
                .replace("rf__edge-", ""),
              edge = graph.edges.find((e) => e.id === id),
              path = element.querySelector(".react-flow__edge-path");
            if (!edge || !path)
              throw new Error("Missing saved edge or SVG path: " + id);
            const matrix = path.getScreenCTM(),
              points = [
                path.getPointAtLength(0).matrixTransform(matrix),
                path
                  .getPointAtLength(path.getTotalLength())
                  .matrixTransform(matrix),
              ];
            return {
              id,
              distances: [
                [edge.source, "source", edge.sourceHandle],
                [edge.target, "target", edge.targetHandle],
              ].map(([node, type, handle], i) => {
                const port = document.querySelector(
                  '.react-flow__node[data-id="' +
                    CSS.escape(node) +
                    '"] .react-flow__handle.' +
                    type +
                    '[data-handleid="' +
                    CSS.escape(handle) +
                    '"]',
                );
                if (!port)
                  throw new Error("Missing port: " + node + "/" + handle);
                const r = port.getBoundingClientRect(),
                  x = type === "source" ? r.right : r.left,
                  y = r.y + r.height / 2;
                return Math.hypot(x - points[i].x, y - points[i].y);
              }),
            };
          },
        ),
      graph,
    );
    for (const row of rows)
      for (const distance of row.distances)
        expect(distance, "Endpoint of " + row.id).toBeLessThan(3);
    return rows.length;
  };
  const edgesChecked = await verifyEndpoints();
  expect(edgesChecked).toBe(18);
  checks.push(
    "All 18 curve endpoints meet their actual input and output ports",
  );
  await page.getByRole("button", { name: "整理", exact: true }).click();
  await page.getByTitle("适应全部节点").click();
  await verifyEndpoints();
  const boxes = await page
    .locator(".studio-node")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getBoundingClientRect().toJSON()),
    );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(
        a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top,
      ).toBe(true);
    }
  checks.push(
    "Arrange accounts for tall nodes and recalculates connected endpoints",
  );
  await page.screenshot({
    path: path.join(artifacts, "editor-fixes-studio.png"),
  });
  expect(errors).toEqual([]);
  console.log("PASS editor fixes", JSON.stringify(checks));
} catch (error) {
  errors.push(error.message);
  await page
    .screenshot({ path: path.join(artifacts, "editor-fixes-failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await fs.writeFile(
    path.join(artifacts, "editor-fixes-browser-report.json"),
    JSON.stringify({ checks, errors }, null, 2) + "\n",
  );
  await browser.close();
}
