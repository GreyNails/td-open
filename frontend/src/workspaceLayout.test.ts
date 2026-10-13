import { describe, it, expect } from "vitest";
import {
  presetLayout,
  readLayout,
  measureLayout,
  groups,
  dockPanel,
  hidePanel,
  restorePanel,
  resizeSplit,
  findGroup,
  findNode,
  activatePanel,
  dropZone,
  panelIds,
  SPLITTER_SIZE,
} from "./workspaceLayout";
import type { WorkspaceLayout, DockSplit } from "./workspaceLayout";
const visible = (layout: WorkspaceLayout) =>
  groups(layout.root).flatMap((g) => g.tabs);
const groupId = (layout: WorkspaceLayout, panel: (typeof panelIds)[number]) =>
  findGroup(layout.root, panel)!.id;
function assertPartition(layout: WorkspaceLayout) {
  const { groups: leaves, splits } = measureLayout(layout),
    { width, height } = layout.reference;
  let total = 0;
  for (const { rect: r } of leaves) {
    expect(r.width).toBeGreaterThanOrEqual(0);
    expect(r.height).toBeGreaterThanOrEqual(0);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(width);
    expect(r.y + r.height).toBeLessThanOrEqual(height);
    total += r.width * r.height;
  }
  for (const { handle } of splits) total += handle.width * handle.height;
  expect(total).toBeCloseTo(width * height, 5);
  for (let a = 0; a < leaves.length; a++)
    for (let b = a + 1; b < leaves.length; b++) {
      const x = leaves[a].rect,
        y = leaves[b].rect;
      const overlap =
        Math.max(
          0,
          Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x),
        ) *
        Math.max(
          0,
          Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y),
        );
      expect(overlap).toBe(0);
    }
}
describe("shared dock workspace", () => {
  it("all presets tile the full viewport with no overlaps or unused holes", () => {
    for (const preset of ["studio", "canvas", "visual"])
      for (const width of [380, 800, 1200, 1600]) {
        const layout = presetLayout(width, 720, preset);
        assertPartition(layout);
        expect(new Set([...visible(layout), ...layout.hidden])).toEqual(
          new Set(panelIds),
        );
      }
  });
  it("central dropping merges tabs, removes the empty area and activates the moved panel", () => {
    const initial = presetLayout(1360, 760),
      source = groupId(initial, "assistant"),
      target = groupId(initial, "inspector");
    const next = dockPanel(initial, "assistant", target, "center");
    expect(findNode(next.root, source)).toBeUndefined();
    expect(findGroup(next.root, "inspector")?.tabs).toEqual([
      "inspector",
      "assistant",
    ]);
    expect(findGroup(next.root, "assistant")?.active).toBe("assistant");
    expect(measureLayout(next).splits).toHaveLength(3);
    assertPartition(next);
  });
  it("edge dropping a tab splits it back out with the requested orientation and order", () => {
    for (const direction of ["left", "right", "top", "bottom"] as const) {
      const base = presetLayout(1360, 760, "canvas"),
        destination = groupId(base, "inspector");
      const next = dockPanel(base, "assistant", destination, direction);
      const added = measureLayout(next).splits.find(
        (s) =>
          s.node.first.id === destination || s.node.second.id === destination,
      )!.node;
      expect(added.axis).toBe(
        direction === "left" || direction === "right" ? "row" : "column",
      );
      expect(visible(next).sort()).toEqual([...panelIds].sort());
      expect(findGroup(next.root, "assistant")?.tabs).toEqual(["assistant"]);
      const first =
        direction === "left" || direction === "top"
          ? added.first
          : added.second;
      expect(groups(first)[0].tabs).toEqual(["assistant"]);
      assertPartition(next);
    }
  });
  it("moving the only tab within its own area leaves the tree intact", () => {
    const base = presetLayout(1300, 800);
    expect(dockPanel(base, "graph", groupId(base, "graph"), "left")).toEqual(
      base,
    );
  });
  it("one boundary moves both adjacent areas and remains clamped by their minimum sizes", () => {
    const base = presetLayout(1600, 900),
      before = measureLayout(base);
    const divider = before.splits.find((s) => s.node.id === "studio-editors")!;
    const next = resizeSplit(base, divider.node.id, 0.65),
      after = measureLayout(next);
    const oldPreview = before.groups.find((g) =>
        g.node.tabs.includes("preview"),
      )!.rect,
      oldGraph = before.groups.find((g) => g.node.tabs.includes("graph"))!.rect;
    const preview = after.groups.find((g) =>
        g.node.tabs.includes("preview"),
      )!.rect,
      graph = after.groups.find((g) => g.node.tabs.includes("graph"))!.rect;
    expect(preview.height).toBeGreaterThan(oldPreview.height);
    expect(graph.height).toBeLessThan(oldGraph.height);
    expect(preview.height + graph.height).toBe(
      oldPreview.height + oldGraph.height,
    );
    expect(preview.y + preview.height + SPLITTER_SIZE).toBe(graph.y);
    const clamped = measureLayout(resizeSplit(base, "studio-main", 999));
    expect(
      clamped.groups.find((g) => g.node.tabs.includes("graph"))!.rect.width,
    ).toBeGreaterThanOrEqual(280);
    assertPartition(next);
  });
  it("horizontal shared boundary preserves both sides' combined width", () => {
    const base = presetLayout(1600, 900),
      before = measureLayout(base).groups.find((g) =>
        g.node.tabs.includes("library"),
      )!.rect;
    const next = resizeSplit(base, "studio-main", 0.28),
      after = measureLayout(next).groups.find((g) =>
        g.node.tabs.includes("library"),
      )!.rect;
    expect(after.width).toBeGreaterThan(before.width);
    assertPartition(next);
  });
  it("hiding collapses empty branches and restoring cannot lose or duplicate panels", () => {
    let layout = presetLayout(1360, 760);
    for (const id of ["assistant", "inspector", "library", "preview"] as const)
      layout = hidePanel(layout, id);
    expect(visible(layout)).toEqual(["graph"]);
    expect(measureLayout(layout).splits).toHaveLength(0);
    expect(hidePanel(layout, "graph")).toBe(layout);
    for (const id of [...layout.hidden]) layout = restorePanel(layout, id);
    expect(new Set(visible(layout))).toEqual(new Set(panelIds));
    expect(visible(layout)).toHaveLength(5);
    assertPartition(layout);
  });
  it("restores the node library along the outer left edge and preview above the graph", () => {
    const base = presetLayout(1360, 760);
    const restoredLibrary = restorePanel(hidePanel(base, "library"), "library");
    const library = measureLayout(restoredLibrary).groups.find((g) =>
      g.node.tabs.includes("library"),
    )!.rect;
    expect(library.x).toBe(0);
    expect(library.y).toBe(0);
    expect(library.height).toBe(760);
    const restoredPreview = restorePanel(hidePanel(base, "preview"), "preview");
    const areas = measureLayout(restoredPreview).groups;
    const preview = areas.find((g) => g.node.tabs.includes("preview"))!.rect;
    const graph = areas.find((g) => g.node.tabs.includes("graph"))!.rect;
    expect(preview.y + preview.height + SPLITTER_SIZE).toBe(graph.y);
  });
  it("v1 floating saves migrate to contiguous panels while retaining visibility", () => {
    const legacy = {
      version: 1,
      preset: "canvas",
      panels: Object.fromEntries(
        panelIds.map((id) => [id, { visible: id !== "assistant" }]),
      ),
    };
    const layout = readLayout(legacy, 1200, 720);
    expect(layout.version).toBe(2);
    expect(layout.hidden).toEqual(["assistant"]);
    assertPartition(layout);
  });
  it("recovers the node canvas when all legacy windows were hidden", () => {
    const legacy = {
      version: 1,
      panels: Object.fromEntries(
        panelIds.map((id) => [id, { visible: false }]),
      ),
    };
    expect(visible(readLayout(legacy, 1200, 720))).toEqual(["graph"]);
  });
  it("validates imported trees, eliminates duplicate panels and supplies missing IDs", () => {
    const invalid = {
      version: 2,
      root: {
        type: "split",
        id: "x",
        axis: "row",
        ratio: NaN,
        first: {
          type: "group",
          id: "x",
          tabs: ["graph", "graph", "bad"],
          active: "bad",
        },
        second: {
          type: "group",
          tabs: ["graph", "preview"],
          active: "preview",
        },
      },
    };
    const layout = readLayout(invalid, 1000, 700);
    expect(visible(layout)).toEqual(["graph", "preview"]);
    expect(
      new Set(measureLayout(layout).groups.map((g) => g.node.id)).size,
    ).toBe(2);
    expect((layout.root as DockSplit).ratio).toBe(0.5);
    expect(layout.hidden).toEqual(["library", "inspector", "assistant"]);
    assertPartition(layout);
  });
  it("round-trips tab groups and split ratios through project JSON", () => {
    const initial = presetLayout(1500, 850),
      merged = dockPanel(
        initial,
        "assistant",
        groupId(initial, "inspector"),
        "center",
      );
    const activated = activatePanel(merged, "inspector"),
      resized = resizeSplit(activated, "studio-main", 0.23);
    const restored = readLayout(JSON.parse(JSON.stringify(resized)), 1500, 850);
    expect(restored).toEqual(resized);
  });
  it("offers all four edge drop targets and central/header tab merging", () => {
    const rect = { x: 100, y: 100, width: 500, height: 400 };
    expect(dropZone(rect, 102, 250)).toBe("left");
    expect(dropZone(rect, 598, 250)).toBe("right");
    expect(dropZone(rect, 350, 140)).toBe("top");
    expect(dropZone(rect, 350, 498)).toBe("bottom");
    expect(dropZone(rect, 350, 300)).toBe("center");
    expect(dropZone(rect, 200, 110)).toBe("center");
  });
});
