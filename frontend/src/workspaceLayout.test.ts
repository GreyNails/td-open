import { describe, it, expect } from "vitest";
import {
  presetLayout,
  readLayout,
  resizeRect,
  dragRect,
  panelIds,
} from "./workspaceLayout";
describe("free workspace geometry", () => {
  it("presets keep every panel within the stage", () => {
    for (const preset of ["studio", "canvas", "visual"]) {
      const layout = presetLayout(1360, 740, preset);
      for (const id of panelIds) {
        const r = layout.panels[id];
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1360);
        expect(r.y + r.height).toBeLessThanOrEqual(740);
      }
    }
  });
  it("restores/scales layout without accepting invalid geometry or order", () => {
    const original = presetLayout(1200, 800);
    original.panels.preview.x = NaN;
    original.order = ["graph", "graph", "bad" as never];
    const restored = readLayout(original, 1000, 600);
    expect(restored.order.length).toBe(5);
    expect(new Set(restored.order).size).toBe(5);
    expect(Number.isFinite(restored.panels.preview.x)).toBe(true);
    expect(restored.reference).toEqual({ width: 1000, height: 600 });
  });
  it("west/north resizing holds the opposite edge and minimum size", () => {
    const rect = { x: 100, y: 100, width: 500, height: 400 };
    const r = resizeRect(rect, 999, 999, "nw", "graph", 1200, 800, false);
    expect(r.x + r.width).toBe(600);
    expect(r.y + r.height).toBe(500);
    expect(r.width).toBe(320);
    expect(r.height).toBe(210);
  });
  it("dragging respects snap and viewport boundaries", () => {
    const rect = { x: 100, y: 100, width: 500, height: 400 };
    expect(dragRect(rect, 11, 13, "graph", 1200, 800, true).x).toBe(112);
    const r = dragRect(rect, 2000, -2000, "graph", 1200, 800, false);
    expect(r.x).toBe(700);
    expect(r.y).toBe(0);
  });
  it("ensures an imported hidden workspace has a visible canvas", () => {
    const saved = presetLayout(1200, 800);
    for (const p of Object.values(saved.panels)) p.visible = false;
    expect(readLayout(saved, 1200, 800).panels.graph.visible).toBe(true);
  });
  it("keeps desktop columns separate and retains the actual short viewport", () => {
    for (const width of [800, 900, 1040, 1360]) {
      const { panels } = presetLayout(width, 700);
      expect(panels.library.x + panels.library.width).toBeLessThan(
        panels.preview.x,
      );
      expect(panels.preview.x + panels.preview.width).toBeLessThan(
        panels.inspector.x,
      );
      expect(panels.graph.x + panels.graph.width).toBeLessThan(
        panels.assistant.x,
      );
    }
    const layout = readLayout(presetLayout(1200, 700), 900, 200);
    expect(layout.reference.height).toBe(200);
    for (const rect of Object.values(layout.panels))
      expect(rect.y + rect.height).toBeLessThanOrEqual(200);
  });
});
