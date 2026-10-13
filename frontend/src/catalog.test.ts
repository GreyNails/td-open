import { describe, it, expect } from "vitest";
import { templates } from "./templates";
import { catalog, byType, preset, makeNode, connectionError } from "./catalog";
import { cookDataNode } from "./nodes/dataRuntime";
import { compileNetworks } from "./networks";
describe("typed graph contracts", () => {
  it("all shipped examples connect every node to a single output with compatible acyclic edges", () => {
    for (const name of [...templates.map((t) => t.id), "empty"]) {
      const p = preset(name);
      expect(p.settings?.preset).toBe(name);
      for (const node of p.nodes) {
        const spec = byType[node.type];
        for (const [key, value] of Object.entries(node.data.params)) {
          const parameter = spec.params.find((p) => p.key === key);
          expect(parameter, `${name}: ${node.type}.${key}`).toBeDefined();
          if (parameter?.options) expect(parameter.options).toContain(value);
          if (typeof value === "number") {
            if (parameter?.min !== undefined)
              expect(value).toBeGreaterThanOrEqual(parameter.min);
            if (parameter?.max !== undefined)
              expect(value).toBeLessThanOrEqual(parameter.max);
          }
        }
      }
      const outputs = p.nodes.filter((node) => node.type === "output");
      expect(outputs).toHaveLength(1);
      // Use the same dependency graph as cooking: path references are real
      // dependencies, and component output ports can route to nested nodes.
      const compiled = compileNetworks(p);
      const contributing = new Set([outputs[0].id]);
      for (let pass = 0; pass < compiled.nodes.length; pass++) {
        for (const edge of compiled.edges) {
          if (contributing.has(edge.target)) contributing.add(edge.source);
        }
      }
      const contributingTopLevel = new Set(
        [...contributing].map((id) => id.split("/")[0]),
      );
      expect(
        p.nodes
          .filter((node) => !contributingTopLevel.has(node.id))
          .map((node) => node.type),
        `${name}: nodes do not contribute to output through wires or references`,
      ).toEqual([]);
      expect(
        new Set(p.edges.map((edge) => `${edge.target}:${edge.targetHandle}`))
          .size,
      ).toBe(p.edges.length);
      for (const edge of p.edges) {
        const rest = { ...p, edges: p.edges.filter((e) => e.id !== edge.id) };
        expect(
          connectionError(
            rest,
            edge.source,
            edge.target,
            edge.sourceHandle!,
            edge.targetHandle!,
          ),
        ).toBeNull();
      }
    }
  });
  it("CSV edits in the data-driven template change its connected visual modulation", () => {
    const p = preset("data-driven");
    const table = p.nodes.find((node) => node.type === "table_dat")!;
    const rotation = p.nodes.find((node) => node.type === "rotate")!;
    const modulation = p.edges.find(
      (edge) => edge.target === rotation.id && edge.targetHandle === "mod",
    )!;
    const calculate = (id: string): unknown => {
      const node = p.nodes.find((entry) => entry.id === id)!;
      const result = cookDataNode(
        node,
        0,
        (handle = "in") => {
          const incoming = p.edges.find(
            (edge) => edge.target === id && edge.targetHandle === handle,
          );
          return incoming ? calculate(incoming.source) : undefined;
        },
        new Map(),
      );
      expect(result.handled).toBe(true);
      if (!result.handled) throw new Error(`Missing runtime for ${node.type}`);
      return result.value;
    };
    expect(calculate(modulation.source)).toBeCloseTo(1.2);
    table.data.params.csv = "name,value\nangle,0.25";
    expect(calculate(modulation.source)).toBeCloseTo(0.5);
  });
  it("rejects incompatible connections and cycles", () => {
    const p = preset();
    const noise = p.nodes.find((n) => n.type === "noise")!,
      color = p.nodes.find((n) => n.type === "color")!,
      lfo = p.nodes.find((n) => n.type === "lfo")!;
    expect(connectionError(p, noise.id, lfo.id)).toBeTruthy();
    expect(connectionError(p, noise.id, noise.id)).toContain("自身");
    const a = makeNode("color"),
      b = makeNode("color");
    p.nodes.push(a, b);
    p.edges.push({
      id: "ab",
      source: a.id,
      target: b.id,
      sourceHandle: "out",
      targetHandle: "in",
    });
    expect(connectionError(p, b.id, a.id)).toContain("循环");
    expect(connectionError(p, lfo.id, color.id)).toContain("CHOP");
  });
  it("creates independent defaults and stable unique IDs", () => {
    const first = makeNode("noise"),
      second = makeNode("noise");
    first.data.params.scale = 9;
    expect(second.data.params.scale).toBe(3);
    expect(first.id).not.toBe(second.id);
    expect(new Set(catalog.map((n) => n.type)).size).toBe(catalog.length);
  });
  it("can compose generated text and microphone visualizers", () => {
    const p = preset("empty");
    const text = makeNode("text"),
      ai = makeNode("ai_text"),
      audio = makeNode("audio"),
      spectrum = makeNode("spectrum");
    p.nodes.push(text, ai, audio, spectrum);
    expect(connectionError(p, ai.id, text.id)).toBeNull();
    expect(connectionError(p, audio.id, spectrum.id)).toBeNull();
    expect(byType.ai_image.outputs[0].kind).toBe("TOP");
  });
});
