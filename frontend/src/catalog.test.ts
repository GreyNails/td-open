import { describe, it, expect } from "vitest";
import { catalog, byType, preset, makeNode, connectionError } from "./catalog";
describe("typed graph contracts", () => {
  it("all templates have existing, compatible acyclic edges", () => {
    for (const name of ["flow", "particles", "3d", "ai", "empty"]) {
      const p = preset(name);
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
