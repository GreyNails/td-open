import { describe, it, expect } from "vitest";
import { preset, byType } from "./catalog";
import {
  exampleDraft,
  isExampleProject,
  savedExampleDraft,
} from "./exampleProjects";
import { arrangeNodes, nodeCardHeight } from "./nodeLayout";
describe("Immutable examples and independent editing identities", () => {
  it("two editors receive different project IDs and cannot mutate shared nested data", () => {
    const original = preset("nested-image-component");
    original.id = "example_nested-image-component";
    original.settings = { ...original.settings, is_example: true };
    const before = structuredClone(original),
      a = exampleDraft(original),
      b = exampleDraft(original);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(original.id);
    a.nodes[0].data.params.custom = "changed";
    expect(original).toEqual(before);
    expect(b.nodes[0].data.params.custom).toBeUndefined();
    expect(a.settings?.source_example_id).toBe(original.id);
    expect(isExampleProject(a)).toBe(false);
  });
  it("saving keeps the same editing identity, including node IDs and internal references", () => {
    const source = preset("tidal-muse");
    source.id = "example_tidal-muse";
    const draft = exampleDraft(source),
      saved = savedExampleDraft(draft);
    expect(saved.id).toBe(draft.id);
    expect(saved.nodes).toEqual(source.nodes);
    expect(saved.edges).toEqual(source.edges);
    expect(saved.name).toContain("我的作品");
    expect(source.name).not.toContain("我的作品");
  });
  it("arranges high-port-count cards without overlapping the next row", () => {
    const project = preset("tidal-muse"),
      arranged = arrangeNodes(project.nodes, byType);
    for (let i = 4; i < arranged.length; i++) {
      const previous = arranged[i - 4];
      expect(arranged[i].position.y).toBeGreaterThanOrEqual(
        previous.position.y + nodeCardHeight(byType[previous.type]) + 40,
      );
    }
  });
});
