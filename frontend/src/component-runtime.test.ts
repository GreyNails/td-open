import { describe, it, expect } from "vitest";
import type { GraphNode, Params, Project } from "./types";
import { compileNetworks, networkTime, networkTypes } from "./networks";
import { componentCatalog } from "./nodes/componentCatalog";
import { byType } from "./catalog";
import { cookComponentNode } from "./nodes/componentRuntime";
import { isChannelBuffer, type ChannelBuffer } from "./runtimeValues";
const node = (id: string, type: string, params: Params = {}): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    label: id,
    params: {
      ...Object.fromEntries(
        (
          componentCatalog.find((entry) => entry.type === type)?.params ?? []
        ).map((p) => [p.key, p.default]),
      ),
      ...params,
    },
  },
});
const project = (
  nodes: GraphNode[],
  edges: Project["edges"] = [],
): Project => ({
  id: "scope_test",
  name: "Scope test",
  version: 1,
  nodes,
  edges,
});
const connect = (a: string, b: string, targetHandle = "in") => ({
  id: `${a}_${b}_${targetHandle}`,
  source: a,
  target: b,
  sourceHandle: "out",
  targetHandle,
});
const animation = (params: Params = {}, time = 0): ChannelBuffer => {
  const result = cookComponentNode(
    node("animation", "animation_comp", params),
    time,
    () => undefined,
    new Map(),
  );
  if (!result.handled || !isChannelBuffer(result.value))
    throw new Error("Animation must return channels");
  return result.value;
};
const curve = (buffer: ChannelBuffer, name = "x") =>
  buffer.channels.find((channel) => channel.name === name)!.samples;
const replicaGraph = (count = 3) => {
  const replica = node("copies", "replicator_comp", { count });
  replica.data.graph = project(
    [node("index", "replica_index_chop"), node("out", "network_out_top")],
    [connect("index", "out")],
  );
  return replica;
};
describe("Time COMP and scoped network clocks", () => {
  it("Time and Replicator are actual network components with distinct schemas", () => {
    expect(networkTypes.has("time_comp")).toBe(true);
    expect(networkTypes.has("replicator_comp")).toBe(true);
    expect(networkTypes.has("animation_comp")).toBe(false);
    expect(
      componentCatalog.find((n) => n.type === "animation_comp")?.outputs[0]
        .kind,
    ).toBe("CHOP");
  });
  it("applies nested rate, offset and loop in parent-to-child order", () => {
    const inner = node("inner", "time_comp", { rate: 0.5, offset: 2 }),
      outer = node("outer", "time_comp", { rate: 2, offset: 1 });
    inner.data.graph = project([node("leaf", "animation_comp")]);
    outer.data.graph = project([inner]);
    const source = project([outer, node("outside", "animation_comp")]),
      before = JSON.stringify(source),
      flat = compileNetworks(source),
      leaf = flat.nodes.find((n) => n.id === "outer/inner/leaf")!,
      outside = flat.nodes.find((n) => n.id === "outside")!;
    expect(networkTime(3, leaf.data.params)).toBe(5.5);
    expect(networkTime(3, outside.data.params)).toBe(3);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("looping clock handles negative time and reverse playback", () => {
    expect(
      networkTime(-0.5, {
        __td_clocks: JSON.stringify([
          { rate: 1, offset: 0, loop: true, duration: 2 },
        ]),
      }),
    ).toBe(1.5);
    expect(
      networkTime(3, {
        __td_clocks: JSON.stringify([
          { rate: -2, offset: 1, loop: true, duration: 4 },
        ]),
      }),
    ).toBe(3);
    expect(() => networkTime(Infinity, {})).toThrow("有限");
  });
  it("child output routing preserves the local clock on the evaluated leaf", () => {
    const clock = node("clock", "time_comp", { rate: 2, offset: 1 });
    clock.data.graph = project(
      [node("animation", "animation_comp"), node("out", "network_out_chop")],
      [connect("animation", "out")],
    );
    const flat = compileNetworks(
      project([clock, node("sink", "null_chop")], [connect("clock", "sink")]),
    );
    expect(flat.edges.find((e) => e.target === "sink")?.source).toBe(
      "clock/out",
    );
    const leaf = flat.nodes.find((n) => n.id === "clock/animation")!;
    const output = cookComponentNode(
      leaf,
      networkTime(0.25, leaf.data.params),
      () => undefined,
      new Map(),
    );
    expect(
      output.handled && isChannelBuffer(output.value) && output.value.start,
    ).toBe(90);
  });
});
describe("Animation COMP executable keyframes", () => {
  it("returns independently named sample arrays with the declared rate", () => {
    const value = animation({
      keys: '{"x":[[0,0],[1,1]],"y":[[0,10],[1,0]]}',
      samples: 4,
      sample_rate: 4,
      loop: false,
    });
    expect(value.sampleRate).toBe(4);
    expect(curve(value)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(curve(value, "y")).toEqual([10, 7.5, 5, 2.5]);
  });
  it("linear, smooth and hold are observably different interpolations", () => {
    const common = { keys: '{"x":[[0,0],[1,1]]}', samples: 1, loop: false };
    expect(curve(animation({ ...common, mode: "linear" }, 0.25))[0]).toBe(0.25);
    expect(curve(animation({ ...common, mode: "smooth" }, 0.25))[0]).toBe(
      0.15625,
    );
    expect(curve(animation({ ...common, mode: "hold" }, 0.25))[0]).toBe(0);
  });
  it("holds endpoints with looping off and loops exactly with looping on", () => {
    const common = { keys: '{"x":[[1,3],[3,7]]}', samples: 1 };
    expect(curve(animation({ ...common, loop: false }, -1))[0]).toBe(3);
    expect(curve(animation({ ...common, loop: false }, 5))[0]).toBe(7);
    expect(curve(animation({ ...common, loop: true }, 3))[0]).toBe(3);
    expect(curve(animation({ ...common, loop: true }, 4))[0]).toBe(5);
  });
  it("rejects duplicate or non-finite key times without executing code", () => {
    expect(() => animation({ keys: '{"x":[[0,0],[0,1]]}' })).toThrow("重复");
    expect(() => animation({ keys: '{"x":[[0,0],[1e309,1]]}' })).toThrow(
      "关键帧",
    );
  });
});
describe("Replicator independent cook scopes", () => {
  it("each copy has a unique cook ID, state key and 0-based index", () => {
    const flat = compileNetworks(project([replicaGraph(3)])),
      indices = flat.nodes.filter((n) => n.type === "replica_index_chop");
    expect(indices.map((n) => n.id)).toEqual([
      "copies/index",
      "copies/_copy1/index",
      "copies/_copy2/index",
    ]);
    expect(
      indices.map((n) => {
        const result = cookComponentNode(n, 0, () => undefined, new Map());
        return result.handled && isChannelBuffer(result.value)
          ? result.value.channels[0].samples[0]
          : -1;
      }),
    ).toEqual([0, 1, 2]);
    expect(
      flat.edges
        .filter(
          (e) => e.target === "copies" && e.targetHandle?.startsWith("copy_"),
        )
        .map((e) => e.targetHandle),
    ).toEqual(["copy_0", "copy_1", "copy_2"]);
  });
  it("all replicas read the same external input through distinct child inlet nodes", () => {
    const copies = replicaGraph(3);
    copies.data.graph!.nodes.unshift(node("input", "network_in_top"));
    const flat = compileNetworks(
      project([node("image", "noise"), copies], [connect("image", "copies")]),
    );
    expect(
      flat.edges.filter(
        (e) => e.target.endsWith("/input") && e.source === "image",
      ),
    ).toHaveLength(3);
  });
  it("a nested replicator starts its own index at zero for every parent copy", () => {
    const inner = replicaGraph(3);
    inner.id = "inner";
    const outer = replicaGraph(2);
    outer.data.graph = project(
      [inner, node("out", "network_out_top")],
      [connect("inner", "out")],
    );
    const flat = compileNetworks(project([outer])),
      inside = flat.nodes.filter((n) => n.type === "replica_index_chop");
    expect(inside.map((n) => n.data.params.__td_replica)).toEqual([
      0, 1, 2, 0, 1, 2,
    ]);
  });
  it("relative parent references are preserved in every generated copy", () => {
    const copies = replicaGraph(2);
    copies.data.graph!.nodes.push(
      node("reference", "operator_select_top", { path: "../source" }),
    );
    const flat = compileNetworks(project([node("source", "noise"), copies]));
    const refs = flat.edges.filter((e) => e.id.endsWith("reference/reference"));
    expect(refs).toHaveLength(2);
    expect(refs.every((e) => e.source === "source")).toBe(true);
  });
  it("GLSL declares the modulation port used to distinguish replica outputs", () => {
    expect(
      byType.ref_top_glsl?.inputs.some(
        (p) => p.id === "mod" && p.kind === "CHOP",
      ),
    ).toBe(true);
  });
  it("replicators reject ambiguous duplicate output port numbers", () => {
    const replica = replicaGraph(2);
    replica.data.graph!.nodes.push(
      node("second_out", "network_out_top", { index: 1 }),
    );
    expect(() => compileNetworks(project([replica]))).toThrow("重复");
  });
  it("replication still enforces the global expanded-node limit", () => {
    const copies = replicaGraph(16);
    copies.data.graph!.nodes.push(
      ...Array.from({ length: 320 }, (_, i) => node("extra_" + i, "constant")),
    );
    expect(() => compileNetworks(project([copies]))).toThrow("5000");
  });
});
