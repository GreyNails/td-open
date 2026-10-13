import { describe, it, expect } from "vitest";
import {
  compileNetworks,
  graphAt,
  updateGraph,
  operatorPath,
} from "./networks";
import type { GraphNode, Project } from "./types";
const node = (id: string, type: string, params = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, params },
});
const graph = (nodes: GraphNode[], edges: Project["edges"] = []): Project => ({
  id: "test",
  name: "test",
  version: 1,
  nodes,
  edges,
});
describe("nested component networks", () => {
  it("routes parent inputs and numbered child outputs without collisions", () => {
    const comp = node("effect", "base_comp");
    comp.data.graph = graph(
      [
        node("input", "network_in_top"),
        node("result", "network_out_top", { index: 2 }),
      ],
      [{ id: "a", source: "input", target: "result" }],
    );
    const p = compileNetworks(
      graph(
        [node("image", "noise"), comp, node("sink", "output")],
        [
          { id: "b", source: "image", target: "effect" },
          { id: "c", source: "effect", sourceHandle: "out2", target: "sink" },
        ],
      ),
    );
    expect(p.edges.find((e) => e.id === "effect/input/input")?.source).toBe(
      "image",
    );
    expect(p.edges.find((e) => e.id === "c")?.source).toBe("effect/result");
  });
  it("updates a child immutably and preserves parent metadata", () => {
    const comp = node("component", "base_comp");
    comp.data.graph = graph([]);
    const original = graph([comp]);
    const changed = updateGraph(original, ["component"], (p) => ({
      ...p,
      name: "edited",
    }));
    expect(graphAt(changed, ["component"]).name).toBe("edited");
    expect(comp.data.graph.name).toBe("test");
    expect(changed.id).toBe(original.id);
  });
  it("resolves relative paths and rejects absent references", () => {
    expect(operatorPath("base/nested/", "../input")).toBe("base/input");
    expect(operatorPath("base/", "/source")).toBe("source");
    expect(() =>
      compileNetworks(
        graph([node("ref", "operator_select_top", { path: "missing" })]),
      ),
    ).toThrow("不存在");
  });
  it("rejects duplicate output port numbers", () => {
    const comp = node("c", "base_comp");
    comp.data.graph = graph([
      node("a", "network_out_top"),
      node("b", "network_out_top"),
    ]);
    expect(() => compileNetworks(graph([comp]))).toThrow("重复");
  });
  it("tracks viewer/import references and removes forged scope metadata", () => {
    const source = node("source", "noise", {
      __td_clocks: '[{"rate":100}]',
      __td_replica: 99,
    });
    const compiled = compileNetworks(
      graph([
        source,
        node("viewer", "ref_top_op_viewer", { source: "source" }),
        node("texture", "ref_top_import_select", { parent: "source" }),
      ]),
    );
    expect(
      compiled.edges
        .filter((e) => e.targetHandle === "reference")
        .map((e) => e.source),
    ).toEqual(["source", "source"]);
    expect(compiled.nodes[0].data.params.__td_clocks).toBeUndefined();
    expect(compiled.nodes[0].data.params.__td_replica).toBe(0);
    expect(source.data.params.__td_replica).toBe(99);
    expect(() =>
      compileNetworks(
        graph([node("v", "ref_top_op_viewer", { source: "absent" })]),
      ),
    ).toThrow("不存在");
  });
});
