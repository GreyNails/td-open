import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GraphNode, Params } from "../types";
import { dataCatalog } from "./dataCatalog";
import { cookDataNode, parseCSV } from "./dataRuntime";
import { buildGeometryObject, type GeometrySpec } from "./geometry";

function node(type: string, params: Params = {}, id = type): GraphNode {
  const definition = dataCatalog.find((entry) => entry.type === type);
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: type,
      params: {
        ...Object.fromEntries(
          definition?.params.map((param) => [param.key, param.default]) ?? [],
        ),
        ...params,
      },
    },
  };
}
function cook(
  type: string,
  value: unknown = undefined,
  params: Params = {},
  time = 0,
  inputs: Record<string, unknown> = {},
) {
  const result = cookDataNode(
    node(type, params),
    time,
    (handle = "in") => (handle === "in" ? value : inputs[handle]),
    new Map(),
  );
  if (!result.handled) throw new Error(`Unhandled ${type}`);
  return result.value;
}
function sequence(type: string, params: Params = {}) {
  const state = new Map<string, unknown>(),
    item = node(type, params);
  return {
    item,
    state,
    run: (time: number, value: number, second = 0) => {
      const result = cookDataNode(
        item,
        time,
        (handle = "in") => (handle === "in2" ? second : value),
        state,
      );
      if (!result.handled) throw new Error(`Unhandled ${type}`);
      return result.value as number;
    },
  };
}
function meshes(object: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) result.push(child);
  });
  return result;
}
afterEach(() => vi.restoreAllMocks());

describe("signal operators", () => {
  it("cooks every catalog operator with defined output, and leaves other operators untouched", () => {
    expect(dataCatalog).toHaveLength(38);
    for (const definition of dataCatalog) {
      const input =
        definition.inputs[0]?.kind === "DAT"
          ? '{"name":"test"}'
          : definition.inputs[0]?.kind === "SOP"
            ? { shape: "box", detail: 1 }
            : 0.5;
      const result = cookDataNode(
        node(definition.type),
        1,
        () => input,
        new Map(),
      );
      expect(result.handled, definition.type).toBe(true);
      if (result.handled) expect(result.value, definition.type).toBeDefined();
    }
    expect(
      cookDataNode(node("external_plugin"), 0, () => undefined, new Map()),
    ).toEqual({ handled: false });
  });
  it("uses frequency, phase, amplitude and offset for periodic waveforms", () => {
    expect(
      cook(
        "saw",
        undefined,
        { frequency: 2, phase: 0.25, amplitude: 2, offset: 3 },
        0.125,
      ),
    ).toBe(3);
    expect(cook("triangle", undefined, {}, 0.5)).toBe(1);
    expect(cook("triangle", undefined, {}, 0)).toBe(-1);
    expect(cook("square", undefined, { width: 0.25 }, 0.25)).toBe(-1);
    expect(cook("saw", undefined, {}, -0.25)).toBe(0.5);
    expect(cook("time", undefined, { speed: 2, offset: -1 }, 3)).toBe(5);
    expect(cook("beat", undefined, { bpm: 120 }, 0.5)).toBe(1);
    expect(cook("beat", undefined, { bpm: 120 }, 0.25)).toBe(0);
  });
  it("noise is seeded, deterministic, continuous and bounded", () => {
    const baseline = cook("noise_chop", undefined, { seed: 7 }, 0.99) as number;
    expect(cook("noise_chop", undefined, { seed: 7 }, 0.99)).toBe(baseline);
    expect(cook("noise_chop", undefined, { seed: 8 }, 0.99)).not.toBe(baseline);
    expect(
      Math.abs(
        (cook("noise_chop", undefined, { seed: 7 }, 1.01) as number) - baseline,
      ),
    ).toBeLessThan(0.01);
    expect(Math.abs(baseline)).toBeLessThanOrEqual(1);
  });
  it("maps inverted ranges, clamps endpoints, and reports a zero input range", () => {
    expect(
      cook("range", 0.25, { in_min: 1, in_max: 0, out_min: 0, out_max: 100 }),
    ).toBe(75);
    expect(cook("range", 2)).toBe(360);
    expect(cook("range", 2, { clamp: false })).toBe(720);
    expect(() => cook("range", 1, { in_min: 1, in_max: 1 })).toThrow(
      "不能相同",
    );
  });
  it("handles negative wrap/mirror and equal or inverted limits", () => {
    expect(cook("limit", -0.25, { mode: "wrap" })).toBe(0.75);
    expect(cook("limit", -0.25, { mode: "mirror" })).toBe(0.25);
    expect(cook("limit", 1.25, { mode: "mirror" })).toBe(0.75);
    expect(cook("limit", 10, { min: 2, max: -2 })).toBe(2);
    expect(cook("limit", 10, { min: 3, max: 3, mode: "wrap" })).toBe(3);
  });
  it("quantizes with explicit rounding and rejects a zero step", () => {
    expect(cook("quantize", -0.3, { step: 0.25 })).toBe(-0.25);
    expect(cook("quantize", -0.3, { step: 0.25, mode: "floor" })).toBe(-0.5);
    expect(cook("quantize", 0.3, { step: -0.25, mode: "ceil" })).toBe(0.5);
    expect(() => cook("quantize", 1, { step: 0 })).toThrow("大于 0");
  });
  it("compares and switches two independent channels", () => {
    expect(cook("logic", 1, { operation: "xor" }, 0, { in2: 1 })).toBe(0);
    expect(cook("logic", 1, { operation: "xor" }, 0, { in2: 0 })).toBe(1);
    expect(cook("logic", 0, { operation: "not" })).toBe(1);
    expect(cook("switch_chop", 3, { index: "0" }, 0, { in2: 9, mod: 1 })).toBe(
      9,
    );
    expect(cook("switch_chop", 3, { index: "1" }, 0, { in2: 9 })).toBe(9);
    expect(cook("sine", 90, { unit: "degrees", amplitude: 2 })).toBeCloseTo(2);
    expect(cook("abs", -7)).toBe(7);
    expect(cook("null_chop", -7)).toBe(-7);
  });
});

describe("temporal operators", () => {
  it("smooths with real elapsed time and independent rise/fall constants", () => {
    const lag = sequence("lag", { rise: 1, fall: 2 });
    expect(lag.run(0, 0)).toBe(0);
    const raised = lag.run(1, 1);
    expect(raised).toBeCloseTo(1 - Math.exp(-1));
    expect(lag.run(2, 0)).toBeCloseTo(raised * Math.exp(-0.5));
    expect(lag.run(2, 1)).toBeCloseTo(raised * Math.exp(-0.5));
  });
  it("resets temporal memory on backward time and parameter changes", () => {
    const lag = sequence("lag", { rise: 1 });
    lag.run(10, 0);
    lag.run(11, 1);
    expect(lag.run(0, 8)).toBe(8);
    lag.item.data.params.rise = 2;
    expect(lag.run(1, 3)).toBe(3);
    expect(lag.state.size).toBe(1);
  });
  it("integrates using trapezoids and resets to the requested initial position", () => {
    const speed = sequence("speed", { initial: 10, scale: 2 });
    expect(speed.run(0, 1)).toBe(10);
    expect(speed.run(2, 3)).toBe(18);
    expect(speed.run(2, 3)).toBe(18);
    expect(speed.run(0, 9)).toBe(10);
  });
  it("counts only upward threshold crossings and wraps at an inclusive maximum", () => {
    const count = sequence("counter", { max: 2, wrap: true });
    expect(count.run(0, 0)).toBe(0);
    expect(count.run(1, 1)).toBe(1);
    expect(count.run(2, 1)).toBe(1);
    count.run(3, 0);
    expect(count.run(4, 1)).toBe(2);
    count.run(5, 0);
    expect(count.run(6, 1)).toBe(0);
  });
  it("retriggerable envelopes follow attack, hold and release durations", () => {
    const trigger = sequence("trigger", {
      attack: 1,
      hold: 1,
      release: 2,
      amplitude: 2,
    });
    expect(trigger.run(0, 0)).toBe(0);
    expect(trigger.run(1, 1)).toBe(0);
    expect(trigger.run(1.5, 1)).toBe(1);
    expect(trigger.run(2.5, 0)).toBe(2);
    expect(trigger.run(4, 0)).toBe(1);
    expect(trigger.run(5, 0)).toBe(0);
    expect(trigger.run(6, 1)).toBe(0);
    expect(trigger.run(6.5, 1)).toBe(1);
  });
  it("derivatives use time deltas and remain stable while paused", () => {
    const derivative = sequence("derivative", { scale: 2 });
    expect(derivative.run(0, 1)).toBe(0);
    expect(derivative.run(0.5, 3)).toBe(8);
    expect(derivative.run(0.5, 3)).toBe(8);
    expect(derivative.run(0, 3)).toBe(0);
  });
  it("samples only on the trigger input rising edge", () => {
    const hold = sequence("hold", { initial: -1 });
    expect(hold.run(0, 4, 0)).toBe(-1);
    expect(hold.run(1, 4, 1)).toBe(4);
    expect(hold.run(2, 9, 1)).toBe(4);
    expect(hold.run(3, 9, 0)).toBe(4);
    expect(hold.run(4, 9, 1)).toBe(9);
  });
});

describe("data operators", () => {
  it("parses CSV quoting, embedded newlines, escaped quotes and CRLF", () => {
    expect(
      parseCSV('name,value\r\n"a,b","a""b"\r\n"two\nlines",3\r\n'),
    ).toEqual([
      ["name", "value"],
      ["a,b", 'a"b'],
      ["two\nlines", "3"],
    ]);
    expect(parseCSV("")).toEqual([[""]]);
    expect(parseCSV("a,\n\n")).toEqual([["a", ""], [""]]);
    expect(() => parseCSV('"open')).toThrow("未闭合");
    expect(() => parseCSV('"closed"x')).toThrow("逗号或换行");
  });
  it("selects CSV cells and exports row arrays as JSON", () => {
    expect(
      cook("table_dat", '"a,b",7', { mode: "cell", row: 0, column: 0 }),
    ).toBe("a,b");
    expect(cook("table_dat", '"a,b",7', { mode: "json" })).toBe(
      '[["a,b","7"]]',
    );
    expect(cook("table_dat", "a,b", { mode: "cell", row: 99 })).toBe("");
  });
  it("selects nested JSON values while guarding missing and inherited properties", () => {
    expect(
      cook("json_select", '{"items":[{"name":"星空"}]}', {
        path: "items.0.name",
      }),
    ).toBe("星空");
    expect(cook("json_select", '{"items":[1,2]}', { path: "items" })).toBe(
      "[1,2]",
    );
    expect(
      cook("json_select", "{}", {
        path: "__proto__.polluted",
        fallback: "missing",
      }),
    ).toBe("missing");
    expect(cook("json_select", '{"name":null}')).toBe("null");
    expect(() => cook("json_select", "broken")).toThrow("有效的 JSON");
  });
  it("splits and reverses Unicode characters without breaking emoji", () => {
    expect(cook("split_text", "一🌈二", { separator: "" })).toBe(
      '["一","🌈","二"]',
    );
    expect(cook("split_text", " a , b ")).toBe('["a","b"]');
    expect(cook("case_text", "一🌈二", { mode: "reverse" })).toBe("二🌈一");
  });
  it("performs literal replacement and finite numeric conversion", () => {
    expect(cook("replace_text", "$a $a", { find: "$a", replace: "$&" })).toBe(
      "$& $&",
    );
    expect(cook("dat_to_chop", " 2.5 ")).toBe(2.5);
    expect(cook("dat_to_chop", "", { fallback: 7 })).toBe(7);
    expect(cook("dat_to_chop", "Infinity", { fallback: 7 })).toBe(7);
    expect(
      cook("concatenate", "A", { separator: " / " }, 0, { in2: "B" }),
    ).toBe("A / B");
  });
});

describe("composable geometry", () => {
  it.each([
    ["box", "BoxGeometry"],
    ["sphere", "SphereGeometry"],
    ["torus", "TorusGeometry"],
    ["cone", "ConeGeometry"],
    ["cylinder", "CylinderGeometry"],
    ["plane", "PlaneGeometry"],
    ["circle_sop", "CircleGeometry"],
    ["line_sop", "CylinderGeometry"],
  ])("%s produces its actual mesh type", (type, geometryType) => {
    const descriptor = cook(type) as GeometrySpec;
    const built = buildGeometryObject(descriptor, "#ffffff", false);
    expect(meshes(built)[0].geometry.type).toBe(geometryType);
    expect((meshes(built)[0].material as THREE.MeshStandardMaterial).side).toBe(
      THREE.DoubleSide,
    );
  });
  it("retains nested transform descriptors without mutating their input", () => {
    const box = cook("box") as GeometrySpec;
    const moved = cook("transform_sop", box, { x: 2, ry: 45, sx: 0.5 }, 0, {
      mod: 15,
    }) as GeometrySpec;
    const merged = cook("merge_sop", moved, {}, 0, {
      in2: box,
    }) as GeometrySpec;
    expect(moved.rotation).toEqual([0, 60, 0]);
    expect(box.position).toBeUndefined();
    expect(merged.children).toEqual([moved, box]);
    const built = buildGeometryObject(merged, "#ffffff", true);
    built.updateMatrixWorld(true);
    expect(meshes(built)).toHaveLength(2);
    expect(meshes(built)[0].getWorldPosition(new THREE.Vector3()).x).toBe(2);
    expect(meshes(built)[1].getWorldPosition(new THREE.Vector3()).x).toBe(0);
    built.rotation.y = Math.PI / 2;
    built.updateMatrixWorld(true);
    expect(
      meshes(built)[0].getWorldPosition(new THREE.Vector3()).z,
    ).toBeCloseTo(-2);
  });
  it("builds a spatial line between the requested coordinates", () => {
    const line = cook("line_sop", undefined, {
      x1: 0,
      y1: 0,
      z1: 0,
      x2: 0,
      y2: 2,
      z2: 0,
      width: 0.1,
    }) as GeometrySpec;
    const bounds = new THREE.Box3().setFromObject(
      buildGeometryObject(line, "#fff", false),
    );
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(2);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(0.1);
  });
  it("owns independent mesh resources and releases partial builds after failure", () => {
    const first = meshes(
      buildGeometryObject({ shape: "box", detail: 1 }, "#fff", false),
    )[0];
    const second = meshes(
      buildGeometryObject({ shape: "box", detail: 1 }, "#fff", false),
    )[0];
    expect(first.geometry).not.toBe(second.geometry);
    expect(first.material).not.toBe(second.material);
    const geometryDisposed = vi.spyOn(
      THREE.BufferGeometry.prototype,
      "dispose",
    );
    const materialDisposed = vi.spyOn(THREE.Material.prototype, "dispose");
    expect(() =>
      buildGeometryObject(
        {
          shape: "group",
          detail: 0,
          children: [
            { shape: "box", detail: 1 },
            { shape: "unknown", detail: 1 },
          ],
        },
        "#fff",
        false,
      ),
    ).toThrow("不支持");
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
  });
  it("clones cached models while marking their shared resources as borrowed", () => {
    const cached = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const object = buildGeometryObject(
      {
        shape: "group",
        detail: 0,
        children: [{ shape: "model", detail: 0, url: "sample.glb" }],
      },
      "#fff",
      false,
      () => cached,
    );
    const clone = meshes(object)[0];
    expect(clone).not.toBe(cached);
    expect(clone.geometry).toBe(cached.geometry);
    expect(clone.userData.tdBorrowedResources).toBe(true);
  });
});
