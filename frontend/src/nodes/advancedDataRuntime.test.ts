import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { GraphNode, Params } from "../types";
import { advancedDataCatalog } from "./advancedDataCatalog";
import { cookAdvancedDataNode } from "./advancedDataRuntime";
import { buildGeometryObject, type GeometrySpec } from "./geometry";
const node = (type: string, params: Params = {}): GraphNode => ({
  id: type,
  type,
  position: { x: 0, y: 0 },
  data: {
    label: type,
    params: {
      ...Object.fromEntries(
        advancedDataCatalog
          .find((n) => n.type === type)
          ?.params.map((p) => [p.key, p.default]) ?? [],
      ),
      ...params,
    },
  },
});
function evaluate(
  type: string,
  value: unknown = 0,
  params: Params = {},
  time = 0,
  extra: Record<string, unknown> = {},
  state = new Map<string, unknown>(),
) {
  const result = cookAdvancedDataNode(
    node(type, params),
    time,
    (key = "in") => (key === "in" ? value : extra[key]),
    state,
  );
  if (!result.handled) throw new Error(`Unhandled ${type}`);
  return result.value;
}
const objects = (object: THREE.Object3D) => {
  const items: (THREE.Mesh | THREE.LineSegments)[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments)
      items.push(child);
  });
  return items;
};
const build = (value: GeometrySpec) =>
  buildGeometryObject(value, "#ffcc88", false);
const geo = (
  type: string,
  value: unknown = undefined,
  params: Params = {},
  time = 0,
) => evaluate(type, value, params, time) as GeometrySpec;

describe("advanced signal nodes", () => {
  it("every registered node has a concrete evaluator", () => {
    expect(advancedDataCatalog).toHaveLength(59);
    for (const entry of advancedDataCatalog) {
      const value =
        entry.type === "join_dat"
          ? '[1,"two"]'
          : entry.type.startsWith("json_")
            ? "{}"
            : entry.inputs[0]?.kind === "DAT"
              ? "a,1\nb,2"
              : entry.inputs[0]?.kind === "SOP"
                ? { shape: "box", detail: 3 }
                : 0.5;
      const result = evaluate(entry.type, value, {}, 1, {
        in2: entry.type === "json_merge" ? "{}" : "c,3",
      });
      expect(result, entry.type).toBeDefined();
      if (typeof result === "object")
        expect(objects(build(result)).length, entry.type).toBeGreaterThan(0);
    }
    expect(cookAdvancedDataNode(node("custom"), 0, () => 0, new Map())).toEqual(
      { handled: false },
    );
  });
  it("evaluates weighted signals, quadrants, interpolation and domain errors", () => {
    expect(evaluate("weighted_sum", 4, {}, 0, { in2: 6, in3: 8 })).toBe(9);
    expect(evaluate("atan2", 1, {}, 0, { in2: -1 })).toBe(135);
    expect(evaluate("mix_chop", 2, {}, 0, { in2: 10, mod: 0.25 })).toBe(4);
    expect(evaluate("mix_chop", 2, {}, 0, { in2: 10, mod: 2 })).toBe(10);
    expect(
      evaluate("function_chop", 3, { function: "power", exponent: 3 }),
    ).toBe(27);
    expect(() => evaluate("function_chop", -1, { function: "sqrt" })).toThrow(
      "有限",
    );
    expect(() => evaluate("smoothstep", 0.5, { edge0: 1, edge1: 1 })).toThrow(
      "不能相同",
    );
  });
  it("maps easing, smoothstep, shortest angle, cyclic sequence and decay", () => {
    expect(
      evaluate("ease_chop", 0.5, { curve: "quadratic", direction: "in" }),
    ).toBe(0.25);
    expect(
      evaluate("ease_chop", 0.5, { curve: "cubic", direction: "in_out" }),
    ).toBe(0.5);
    expect(evaluate("smoothstep", 0.5)).toBe(0.5);
    expect(evaluate("angle_wrap", 540)).toBe(-180);
    expect(evaluate("angle_distance", 350, {}, 0, { in2: 10 })).toBe(20);
    expect(
      evaluate(
        "sequence_chop",
        0,
        { values: "0,10", rate: 1, mode: "linear" },
        0.5,
      ),
    ).toBe(5);
    expect(evaluate("sequence_chop", 0, { values: "0,10", rate: 1 }, -1)).toBe(
      10,
    );
    expect(evaluate("gaussian_chop", 0)).toBe(1);
    expect(evaluate("exponential_chop", 1, { decay: 2 })).toBeCloseTo(
      Math.exp(-2),
    );
  });
  it("spring moves smoothly with damped overshoot and rewind resets", () => {
    const state = new Map<string, unknown>();
    evaluate("spring", 0, {}, 0, {}, state);
    const outputs = Array.from(
      { length: 120 },
      (_, i) => evaluate("spring", 1, {}, (i + 1) / 120, {}, state) as number,
    );
    expect(outputs[0]).toBeGreaterThan(0);
    expect(outputs[0]).toBeLessThan(0.1);
    expect(Math.max(...outputs)).toBeGreaterThan(1);
    expect(outputs.at(-1)).toBeCloseTo(1, 2);
    expect(evaluate("spring", 8, {}, 0, {}, state)).toBe(8);
    expect(evaluate("spring", 3, { damping: 1 }, 1, {}, state)).toBe(3);
  });
  it("spring remains stable at stiff, overdamped and critically damped settings", () => {
    for (const damping of [0, 0.9999999, 1, 4]) {
      const state = new Map<string, unknown>(),
        params = { frequency: 20, damping };
      evaluate("spring", 0, params, 0, {}, state);
      const value = evaluate("spring", 1, params, 30, {}, state) as number;
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(2);
      if (damping > 0) expect(value).toBeCloseTo(1, 8);
    }
  });
  it("delay interpolates history and statistics discard old samples", () => {
    const delay = new Map<string, unknown>();
    expect(
      evaluate("delay_chop", 0, { delay: 0.5, initial: -1 }, 0, {}, delay),
    ).toBe(-1);
    expect(
      evaluate("delay_chop", 10, { delay: 0.5, initial: -1 }, 1, {}, delay),
    ).toBe(5);
    for (const type of ["moving_average", "peak_chop", "rms_chop"]) {
      const state = new Map<string, unknown>();
      evaluate(type, -3, {}, 0, {}, state);
      const val = evaluate(type, 4, {}, 0.5, {}, state);
      expect(val).toBeCloseTo(
        type === "moving_average"
          ? 0.5
          : type === "peak_chop"
            ? 4
            : Math.sqrt(12.5),
      );
      expect(evaluate(type, 2, {}, 2, {}, state)).toBe(2);
    }
  });
  it("history is bounded and repeated timestamps replace a sample", () => {
    const state = new Map<string, unknown>();
    for (let i = 0; i < 5000; i++)
      evaluate("delay_chop", i, { delay: 30 }, i / 1000, {}, state);
    const m = state.get("delay_chop") as { samples: number[][] };
    expect(m.samples).toHaveLength(4096);
    evaluate("delay_chop", 9, { delay: 30 }, 4.999, {}, state);
    expect(m.samples).toHaveLength(4096);
    expect(m.samples.at(-1)?.[1]).toBe(9);
  });
  it("ADSR releases from current envelope level and retriggers continuously", () => {
    const state = new Map<string, unknown>(),
      p = { attack: 1, decay: 1, sustain: 0.5, release: 2 };
    const run = (t: number, x: number) => evaluate("adsr", x, p, t, {}, state);
    expect(run(0, 1)).toBe(0);
    expect(run(0.5, 1)).toBe(0.5);
    expect(run(1.5, 1)).toBe(0.75);
    expect(run(2, 1)).toBe(0.5);
    expect(run(3, 0)).toBe(0.5);
    expect(run(4, 0)).toBe(0.25);
    expect(run(5, 0)).toBe(0);
  });
  it("hysteresis suppresses jitter, random changes at rising edge and timer counts", () => {
    const state = new Map<string, unknown>();
    expect(evaluate("hysteresis", 0.8, {}, 0, {}, state)).toBe(1);
    expect(evaluate("hysteresis", 0.5, {}, 1, {}, state)).toBe(1);
    expect(evaluate("hysteresis", 0.2, {}, 2, {}, state)).toBe(0);
    const random = new Map<string, unknown>(),
      v = evaluate("random_hold", 1, {}, 0, {}, random);
    expect(evaluate("random_hold", 1, {}, 1, {}, random)).toBe(v);
    evaluate("random_hold", 0, {}, 2, {}, random);
    expect(evaluate("random_hold", 1, {}, 3, {}, random)).not.toBe(v);
    const timer = new Map<string, unknown>();
    evaluate("timer_chop", 1, {}, 0, {}, timer);
    expect(evaluate("timer_chop", 0, {}, 1, {}, timer)).toBe(0.5);
    expect(evaluate("timer_chop", 0, {}, 5, {}, timer)).toBe(1);
    const slew = new Map<string, unknown>();
    evaluate("slew_chop", 0, {}, 0, {}, slew);
    expect(evaluate("slew_chop", 8, {}, 0.5, {}, slew)).toBe(0.5);
  });
});

describe("advanced data transformations", () => {
  it("preserves Unicode characters in text operations", () => {
    expect(evaluate("text_length", "星🌈空")).toBe(3);
    expect(evaluate("substring_dat", "星🌈空", { start: 1, length: 1 })).toBe(
      "🌈",
    );
    expect(evaluate("substring_dat", "星🌈空", { start: -1, length: 1 })).toBe(
      "空",
    );
    expect(evaluate("pad_dat", "星", { length: 3, fill: "🌈" })).toBe("🌈🌈星");
    expect(
      evaluate("format_dat", "$&", { template: "{in} / {in2}" }, 0, {
        in2: "OK",
      }),
    ).toBe("$& / OK");
    expect(
      evaluate("chop_to_dat", 1.25, { digits: 1, prefix: "值=", suffix: "m" }),
    ).toBe("值=1.3m");
  });
  it("round trips UTF-8 Base64 and URL encodings and rejects malformed data", () => {
    const value = "星🌈空 &/";
    for (const prefix of ["base64", "url"]) {
      const encoded = evaluate("encode_dat", value, {
        mode: prefix + "_encode",
      });
      expect(
        evaluate("encode_dat", encoded, { mode: prefix + "_decode" }),
      ).toBe(value);
    }
    expect(() =>
      evaluate("encode_dat", "%%%", { mode: "base64_decode" }),
    ).toThrow("有效");
    expect(() => evaluate("encode_dat", "%AA", { mode: "url_decode" })).toThrow(
      "有效",
    );
  });
  it("sorts numeric values, deduplicates stably, filters literals, joins structured arrays", () => {
    expect(evaluate("sort_dat", "10\n2\n1", { numeric: true })).toBe(
      "1\n2\n10",
    );
    expect(evaluate("unique_dat", '[1,2,1,"1"]', { format: "json" })).toBe(
      '[1,2,"1"]',
    );
    expect(evaluate("filter_dat", "a.c\na*c\nb", { query: "a.c" })).toBe("a.c");
    expect(evaluate("join_dat", '[1,{"x":2},"三"]', { separator: " / " })).toBe(
      '1 / {"x":2} / 三',
    );
  });
  it("merges JSON and writes nested arrays without prototype mutations", () => {
    expect(
      evaluate("json_merge", '{"a":1,"b":2}', {}, 0, { in2: '{"b":3}' }),
    ).toBe('{"a":1,"b":3}');
    expect(
      evaluate("json_set", "{}", { path: "items.0.name", value: '"光"' }),
    ).toBe('{"items":[{"name":"光"}]}');
    expect(evaluate("json_keys", '{"a":1,"b":2}', { mode: "entries" })).toBe(
      '[["a",1],["b",2]]',
    );
    expect(() =>
      evaluate("json_set", "{}", { path: "__proto__.polluted" }),
    ).toThrow("保留键");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("transposes quoted CSV, selects columns, sorts headers and converts numeric objects", () => {
    expect(evaluate("table_transpose", 'name,value\n"a,b",2')).toBe(
      'name,"a,b"\nvalue,2',
    );
    expect(
      evaluate("table_select", "a,b,c\nd,e,f", {
        start: 1,
        count: 1,
        columns: "2,0",
      }),
    ).toBe("f,d");
    expect(evaluate("table_sort", "name,value\na,10\nb,2")).toBe(
      "name,value\nb,2\na,10",
    );
    expect(
      evaluate("table_merge", "a,b\n1,2", {}, 0, { in2: "a,b\n3,4" }),
    ).toBe("a,b\n1,2\n3,4");
    expect(evaluate("table_to_json", "name,value\n光,2\n影,3.5")).toBe(
      '[{"name":"光","value":2},{"name":"影","value":3.5}]',
    );
    expect(() => evaluate("table_to_json", "a,a\n1,2")).toThrow("重复");
  });
});

describe("advanced geometry", () => {
  it.each([
    ["platonic_sop", "IcosahedronGeometry"],
    ["capsule", "CapsuleGeometry"],
    ["ring_sop", "RingGeometry"],
    ["tube_sop", "TubeGeometry"],
    ["lathe_sop", "LatheGeometry"],
    ["extrude_sop", "ExtrudeGeometry"],
    ["helix_sop", "TubeGeometry"],
    ["torus_knot", "TorusKnotGeometry"],
  ])("builds real %s mesh", (type, expected) => {
    const built = build(geo(type)),
      mesh = objects(built)[0];
    expect(mesh.geometry.type).toBe(expected);
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(8);
    for (const value of mesh.geometry.getAttribute("position").array)
      expect(Number.isFinite(value)).toBe(true);
  });
  it("arranges copies without mutating original geometry or transforms", () => {
    const source: GeometrySpec = {
      shape: "box",
      detail: 1,
      width: 0.2,
      height: 0.2,
      depth: 0.2,
    };
    const copies = build(geo("radial_copy", source, { count: 4, radius: 2 }));
    copies.updateMatrixWorld(true);
    expect(objects(copies)).toHaveLength(4);
    const positions = objects(copies).map((mesh) =>
      mesh.getWorldPosition(new THREE.Vector3()).toArray(),
    );
    expect(positions[0][2]).toBeCloseTo(2);
    expect(positions[1][0]).toBeCloseTo(2);
    const scatter = geo("scatter_sop", source, { seed: 8, count: 8 });
    expect(scatter).toEqual(geo("scatter_sop", source, { seed: 8, count: 8 }));
    expect(scatter).not.toEqual(
      geo("scatter_sop", source, { seed: 9, count: 8 }),
    );
    expect(source.position).toBeUndefined();
  });
  it("deforms vertices, recomputes normals and creates actual line geometry", () => {
    const source: GeometrySpec = { shape: "box", detail: 4 };
    const plain = objects(build(source))[0].geometry.getAttribute(
      "position",
    ).array;
    for (const type of ["twist_sop", "taper_sop", "wave_sop", "noise_sop"]) {
      const mesh = objects(build(geo(type, source)))[0];
      expect(
        Array.from(mesh.geometry.getAttribute("position").array),
      ).not.toEqual(Array.from(plain));
      expect(mesh.geometry.getAttribute("normal")).toBeDefined();
    }
    const lines = objects(build(geo("wireframe_sop", source)))[0];
    expect(lines).toBeInstanceOf(THREE.LineSegments);
    expect(lines.geometry.type).toBe("EdgesGeometry");
  });
  it("calculates world-space bounds for nested transformed geometry", () => {
    const source: GeometrySpec = {
      shape: "group",
      detail: 0,
      position: [3, 2, 1],
      children: [{ shape: "box", detail: 1, width: 2, height: 4, depth: 6 }],
    };
    const bounds = new THREE.Box3().setFromObject(
      build(geo("bounds_sop", source, { wireframe: false })),
    );
    expect(bounds.min.toArray()).toEqual([2, 0, -2]);
    expect(bounds.max.toArray()).toEqual([4, 4, 4]);
  });
  it("converted cached models own fresh resources and do not mutate cached meshes", () => {
    const geometry = new THREE.BoxGeometry(),
      material = new THREE.MeshBasicMaterial(),
      cached = new THREE.Mesh(geometry, material),
      before = Array.from(geometry.getAttribute("position").array),
      dispose = vi.spyOn(geometry, "dispose");
    const descriptor = geo("twist_sop", {
      shape: "model",
      detail: 0,
      url: "sample.glb",
    });
    const built = buildGeometryObject(descriptor, "#fff", false, () => cached),
      mesh = objects(built)[0];
    expect(mesh.geometry).not.toBe(geometry);
    expect(mesh.material).not.toBe(material);
    expect(mesh.userData.tdBorrowedResources).toBeUndefined();
    expect(Array.from(geometry.getAttribute("position").array)).toEqual(before);
    expect(dispose).not.toHaveBeenCalled();
  });
  it("rejects malformed profile points and excessive copy nesting", () => {
    expect(() =>
      geo("tube_sop", undefined, { points: "[[1,2],[3,4]]" }),
    ).toThrow("维");
    expect(() =>
      build(geo("extrude_sop", undefined, { points: "[[0,0],[1,1]]" })),
    ).toThrow("至少");
    const first = geo("copy_sop", { shape: "box", detail: 1 }, { count: 128 });
    expect(() => geo("copy_sop", first, { count: 128 })).toThrow("4096");
    expect(() =>
      geo("copy_sop", { shape: "box", detail: 1 }, { count: 4, scale: 1e200 }),
    ).toThrow("非有限");
  });
});
