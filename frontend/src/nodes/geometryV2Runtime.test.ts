import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  geometryV2Catalog,
  materialCatalog,
  sceneCatalog,
} from "./geometryV2Catalog";
import { cookGeometryV2Node } from "./geometryV2Runtime";
import {
  buildGeometryObject,
  type GeometrySpec,
  type MeshData,
} from "./geometry";
import { buildMaterial, type MaterialSpec } from "./materialRuntime";
import { buildScene, disposeSceneObject, type SceneSpec } from "./sceneRuntime";
import { geometryMesh, meshSpec } from "./meshRuntime";
import type { GraphNode, Params } from "../types";
const catalog = [...geometryV2Catalog, ...materialCatalog, ...sceneCatalog];
const node = (type: string, params: Params = {}): GraphNode => ({
  id: type,
  type,
  position: { x: 0, y: 0 },
  data: {
    label: type,
    params: {
      ...Object.fromEntries(
        catalog
          .find((n) => n.type === type)!
          .params.map((p) => [p.key, p.default]),
      ),
      ...params,
    },
  },
});
const box: GeometrySpec = { shape: "box", detail: 1 },
  material: MaterialSpec = {
    kind: "material",
    model: "pbr",
    color: "#efccaa",
    opacity: 1,
  };
function cook(
  type: string,
  input: unknown = box,
  params: Params = {},
  extra: Record<string, unknown> = {},
  time = 0,
  state = new Map<string, unknown>(),
) {
  const result = cookGeometryV2Node(
    node(type, params),
    time,
    (key = "in") => (key === "in" ? input : extra[key]),
    state,
  );
  if (!result.handled) throw new Error(type);
  return result.value;
}
const geo = (...args: Parameters<typeof cook>) => cook(...args) as GeometrySpec;
const mesh = (...args: Parameters<typeof cook>) => geo(...args).mesh!;
const curve = meshSpec({
  positions: [
    [-1, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, -1, 0],
  ],
  faces: [],
  lines: [[0, 1, 2, 3]],
});
const translated = {
  ...box,
  position: [0.5, 0.5, 0.5] as [number, number, number],
};
const scene: SceneSpec = {
  kind: "scene",
  objects: [{ geometry: box }],
  lights: [],
  camera: {
    projection: "perspective",
    position: [0, 0, 4],
    target: [0, 0, 0],
    near: 0.01,
    far: 100,
    fov: 45,
    zoom: 1,
  },
};
describe("editable mesh kernel", () => {
  it("real topology survives point attributes and geometry building", () => {
    const made = geo("add_sop");
    expect(made.mesh!.positions).toHaveLength(4);
    expect(made.mesh!.faces).toHaveLength(1);
    const attr = geo("attribute_create_sop", made);
    expect(attr.mesh!.pointAttributes!.Cd).toHaveLength(4);
    const object = buildGeometryObject(attr, "#fff", false);
    let count = 0;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        count++;
        expect(child.geometry.getAttribute("color").count).toBe(4);
        expect(child.geometry.index!.count).toBe(6);
      }
    });
    expect(count).toBe(1);
    disposeSceneObject(object);
  });
  it("subdivision increases topology, clipping creates actual cut vertices and caps", () => {
    expect(mesh("subdivide_sop", box, { smooth: 0 }).faces.length).toBe(48);
    const clipped = mesh("clip_sop", box, { nx: 1, cap: false });
    expect(clipped.positions.every((p) => p[0] >= -1e-8)).toBe(true);
    expect(clipped.positions.some((p) => Math.abs(p[0]) < 1e-8)).toBe(true);
    const cap = mesh("cap_sop", meshSpec(clipped));
    expect(cap.faces.length).toBeGreaterThan(clipped.faces.length);
  });
  it("boolean union/intersection/subtraction computes different real surfaces", () => {
    const union = mesh(
        "boolean_sop",
        box,
        { operation: "union" },
        { in2: translated },
      ),
      intersection = mesh(
        "boolean_sop",
        box,
        { operation: "intersect" },
        { in2: translated },
      ),
      subtract = mesh(
        "boolean_sop",
        box,
        { operation: "subtract" },
        { in2: translated },
      );
    expect(union.faces.length).toBeGreaterThan(12);
    expect(intersection.positions.length).toBeGreaterThan(0);
    expect(Math.min(...intersection.positions.map((p) => p[0]))).toBeCloseTo(
      -0.3,
    );
    expect(Math.max(...union.positions.map((p) => p[0]))).toBeCloseTo(1.3);
    expect(JSON.stringify(subtract)).not.toBe(JSON.stringify(union));
  });
  it("named groups drive selective transforms and deletion", () => {
    const grouped = geo("group_sop", box, { name: "two", start: 0, end: 1 });
    const moved = mesh("point_sop", grouped, { group: "two", x: 3 });
    expect(moved.positions[0][0]).toBeCloseTo(
      geometryMesh(box).positions[0][0] + 3,
    );
    expect(moved.positions[2]).toEqual(geometryMesh(box).positions[2]);
    const deleted = mesh("delete_sop", grouped, {
      domain: "point",
      group: "two",
    });
    expect(deleted.positions.length).toBe(22);
    expect(
      deleted.faces.every((face) =>
        face.every((i) => i < deleted.positions.length),
      ),
    ).toBe(true);
  });
  it("resamples by arc length and lofts actual quad strips", () => {
    const sampled = mesh("resample_sop", curve, { count: 17 });
    expect(sampled.positions).toHaveLength(17);
    const loft = mesh(
      "polyloft_sop",
      curve,
      { count: 12, layers: 5 },
      { in2: { ...curve, position: [0, 0, 2] } },
    );
    expect(loft.positions).toHaveLength(72);
    expect(loft.faces).toHaveLength(60);
  });
  it("mesh sorting remaps topology and texture creates finite UV", () => {
    const sorted = mesh("sort_sop", box, { axis: "x" });
    expect(sorted.positions[0][0]).toBeLessThanOrEqual(
      sorted.positions.at(-1)![0],
    );
    const uv = mesh("texture_sop", box, { projection: "spherical" })
      .pointAttributes!.uv;
    expect(uv.flat().every(Number.isFinite)).toBe(true);
    expect(uv.length).toBe(24);
  });
  it("particle and spring states advance and rewind resets", () => {
    const state = new Map<string, unknown>();
    const first = mesh(
        "particle_sop",
        curve,
        { gravity: -2, speed: 0 },
        {},
        0,
        state,
      ),
      later = mesh(
        "particle_sop",
        curve,
        { gravity: -2, speed: 0 },
        {},
        0.1,
        state,
      );
    expect(later.positions[0][1]).toBeLessThan(first.positions[0][1]);
    expect(
      mesh("particle_sop", curve, { gravity: -2, speed: 0 }, {}, 0, state)
        .positions,
    ).toEqual(first.positions);
  });
  it("material assignment propagates into nested geometry", () => {
    const assigned = geo(
      "material_sop",
      { shape: "group", detail: 1, children: [box] },
      {},
      { material },
    );
    const object = buildGeometryObject(assigned, "#000", false);
    let found = false;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        found = true;
        expect(child.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      }
    });
    expect(found).toBe(true);
    disposeSceneObject(object);
  });
  it("all registered CPU geometry paths cook actual outputs with representative inputs", () => {
    const curveTypes = new Set([
      "basis_sop",
      "carve_sop",
      "curveclay_sop",
      "fillet_sop",
      "inverse_curve_sop",
      "join_sop",
      "line_thick_sop",
      "polyloft_sop",
      "polyspline_sop",
      "rails_sop",
      "refine_sop",
      "resample_sop",
      "revolve_sop",
      "skin_sop",
      "sweep_sop",
    ]);
    for (const entry of geometryV2Catalog) {
      if (
        ["raster_sop", "trace_sop", "file_in_sop"].includes(entry.type) ||
        entry.family !== "SOP"
      )
        continue;
      let source: unknown = curveTypes.has(entry.type) ? curve : box;
      const extra: Record<string, unknown> = {
        in2: curveTypes.has(entry.type)
          ? { ...curve, position: [0, 0, 2] }
          : translated,
        in3: translated,
        material,
        bones: cook("bone_comp", null),
      };
      if (entry.type === "import_select_sop") source = scene;
      if (["bone_group_sop", "deform_sop"].includes(entry.type))
        source = geo("capture_sop", box, {}, { bones: extra.bones });
      if (entry.type === "attribute_sop")
        source = geo("attribute_create_sop", box);
      if (entry.type === "select_sop")
        source = geo("group_sop", box, {
          domain: "primitive",
          name: "selection",
        });
      if (entry.type === "dat_to_sop") source = "[[0,0,0],[1,1,0],[2,0,0]]";
      if (entry.type === "chop_to_sop")
        source = {
          kind: "channels",
          channels: [
            { name: "tx", samples: [0, 1, 2] },
            { name: "ty", samples: [0, 1, 0] },
          ],
        };
      const result = geo(entry.type, source, {}, extra);
      expect(result.shape, entry.type).toBeDefined();
      const object = buildGeometryObject(result, "#ffaa77", false);
      disposeSceneObject(object);
    }
  });
});
describe("materials and explicit scene graph", () => {
  it("all 13 materials produce usable owned material resources", () => {
    expect(materialCatalog).toHaveLength(13);
    for (const entry of materialCatalog) {
      const spec = cook(
        entry.type,
        material,
        {},
        { in2: material, in3: material },
      ) as MaterialSpec;
      expect(spec.kind).toBe("material");
      const built = buildMaterial(spec),
        dispose = vi.fn();
      built.addEventListener("dispose", dispose);
      built.dispose();
      expect(dispose).toHaveBeenCalledOnce();
    }
  });
  it("scene camera and lights are independently editable", () => {
    const camera = cook("camera_comp", scene, { x: 7, fov: 65 }) as SceneSpec,
      light = cook("light_comp", camera, {
        type: "spot",
        intensity: 4,
      }) as SceneSpec,
      object = cook(
        "geometry_comp",
        box,
        { x: 2 },
        { scene: light, material },
      ) as SceneSpec;
    const built = buildScene(object, 640, 360);
    expect((built.camera as THREE.PerspectiveCamera).fov).toBe(65);
    expect(built.camera.position.x).toBe(7);
    expect(built.scene.children.some((o) => o instanceof THREE.SpotLight)).toBe(
      true,
    );
    expect(
      built.scene.children.filter((o) => o instanceof THREE.Group).at(-1)!
        .position.x,
    ).toBe(2);
    built.dispose();
  });
  it("scene null transform never mutates upstream objects", () => {
    const input: SceneSpec = {
      ...scene,
      objects: [{ geometry: box, position: [0, 0, 0] }],
    };
    const output = cook("null_comp", input, { x: 2 }) as SceneSpec;
    expect(output.objects[0].position![0]).toBe(2);
    expect(input.objects[0].position![0]).toBe(0);
  });
  it("scene cleanup releases owned meshes and does not release cached model geometry", () => {
    const borrowed = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshBasicMaterial(),
      ),
      dispose = vi.spyOn(borrowed.geometry, "dispose");
    const built = buildScene(
      {
        kind: "scene",
        objects: [{ geometry: { shape: "model", detail: 1, url: "test" } }],
        lights: [],
      },
      100,
      100,
      () => borrowed,
    );
    built.dispose();
    expect(dispose).not.toHaveBeenCalled();
    borrowed.geometry.dispose();
    (borrowed.material as THREE.Material).dispose();
  });
});
describe("rigid body and skeletal scene workflows", () => {
  it("Actor and solver integrate gravity and collide with a ground plane", () => {
    const actor = cook("actor_comp", {
        kind: "scene",
        objects: [{ geometry: box, position: [0, 1, 0] }],
        lights: [],
      }) as SceneSpec,
      state = new Map<string, unknown>();
    let output = actor;
    for (let frame = 0; frame < 240; frame++)
      output = cook(
        "bullet_solver_comp",
        actor,
        { ground_y: -2 },
        {},
        frame / 120,
        state,
      ) as SceneSpec;
    expect(output.objects[0].position![1]).toBeLessThan(1);
    expect(output.objects[0].position![1]).toBeGreaterThan(-1.24);
    const rewind = cook(
      "bullet_solver_comp",
      actor,
      { ground_y: -2 },
      {},
      0,
      state,
    ) as SceneSpec;
    expect(rewind.objects[0].position![1]).toBe(1);
  });
  it("two dynamic bodies obey a distance constraint", () => {
    const input: SceneSpec = {
        kind: "scene",
        objects: [
          { geometry: box, position: [-1, 2, 0] },
          { geometry: box, position: [1, 2, 0] },
        ],
        lights: [],
      },
      actors = cook("actor_comp", input) as SceneSpec,
      constrained = cook("constraint_comp", actors, {
        distance: 2,
      }) as SceneSpec,
      state = new Map<string, unknown>();
    let output = constrained;
    for (let frame = 0; frame < 90; frame++)
      output = cook(
        "bullet_solver_comp",
        constrained,
        { ground: false },
        {},
        frame / 120,
        state,
      ) as SceneSpec;
    const distance = new THREE.Vector3(
      ...output.objects[0].position!,
    ).distanceTo(new THREE.Vector3(...output.objects[1].position!));
    expect(distance).toBeCloseTo(2, 2);
  });
  it("bone capture creates normalized weights and deform rotates actual points", () => {
    const rest = cook("bone_comp", null, {
        endx: 1,
        endy: 0,
        display: false,
      }) as SceneSpec,
      captured = geo("capture_sop", curve, {}, { bones: rest });
    expect(
      captured.mesh!.pointAttributes!.captureWeight.every(
        (row) => Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-8,
      ),
    ).toBe(true);
    const posed = cook("bone_comp", null, {
        endx: 1,
        endy: 0,
        rz: 90,
        display: false,
      }) as SceneSpec,
      deformed = mesh("deform_sop", captured, {}, { bones: posed });
    expect(deformed.positions[2][0]).toBeCloseTo(0);
    expect(deformed.positions[2][1]).toBeCloseTo(1);
  });
  it("ray picker hits actual surface and reports empty space without synthetic hits", () => {
    const center = cook("render_pick_chop", scene) as unknown as {
        channels: { name: string; samples: number[] }[];
      },
      miss = cook("render_pick_chop", scene, { x: 1, y: 1 }) as unknown as {
        channels: { name: string; samples: number[] }[];
      };
    const get = (buffer: typeof center, name: string) =>
      buffer.channels.find((c) => c.name === name)!.samples[0];
    expect(get(center, "hit")).toBe(1);
    expect(get(center, "object")).toBe(0);
    expect(get(center, "tz")).toBeCloseTo(0.8);
    expect(get(miss, "hit")).toBe(0);
  });
});

it("Render Pick DAT reports actual intersection columns as a native table", () => {
  const value = cook("render_pick_dat", scene) as unknown as {
    kind: string;
    rows: string[][];
  };
  expect(value.kind).toBe("table");
  expect(value.rows[0].slice(0, 2)).toEqual(["hit", "object"]);
  expect(value.rows[1].slice(0, 2)).toEqual(["1", "0"]);
});
