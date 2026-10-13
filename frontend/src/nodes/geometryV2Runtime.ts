import { resolveSceneModel } from "./modelRegistry";
import {
  makeChannels,
  makeTable,
  isChannelBuffer,
  type ChannelBuffer,
  type TableData,
} from "../runtimeValues";
import { cookScenePhysicsNode } from "./scenePhysics";
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import fontData from "three/examples/fonts/helvetiker_regular.typeface.json";
import type { GraphNode } from "../types";
import {
  geometryV2Catalog,
  materialCatalog,
  sceneCatalog,
} from "./geometryV2Catalog";
import {
  isGeometrySpec,
  type GeometrySpec,
  type MeshData,
  type Vec3,
} from "./geometry";
import { isMaterialSpec, type MaterialSpec } from "./materialRuntime";
import {
  isSceneSpec,
  mergeScenes,
  buildScene,
  type CameraSpec,
  type SceneSpec,
} from "./sceneRuntime";
import { booleanMeshes } from "./meshBoolean";
import {
  boundaryLoops,
  capMesh,
  center,
  clipMesh,
  cloneMesh,
  curvePoints,
  geometryMesh,
  mergeMeshes,
  meshSpec,
  resampleCurve,
  smoothMesh,
  subdivide,
  triangulate,
  v,
  weldMesh,
  xyz,
} from "./meshRuntime";
import { parseCSV } from "./dataRuntime";
const supported = new Set(
  [...geometryV2Catalog, ...materialCatalog, ...sceneCatalog].map(
    (n) => n.type,
  ),
);
const font = new FontLoader().parse(fontData);
type Result =
  | { handled: false }
  | {
      handled: true;
      value:
        GeometrySpec | MaterialSpec | SceneSpec | ChannelBuffer | TableData;
    };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const random = (seed: number) => {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
};
const bounds = (mesh: MeshData) =>
  new THREE.Box3().setFromPoints(mesh.positions.map(v));
const bufferMesh = (g: THREE.BufferGeometry): MeshData => {
  const pos = g.getAttribute("position"),
    indices = g.index
      ? Array.from(g.index.array)
      : Array.from({ length: pos.count }, (_, i) => i);
  const mesh: MeshData = {
    positions: Array.from({ length: pos.count }, (_, i) =>
      xyz(new THREE.Vector3().fromBufferAttribute(pos, i)),
    ),
    faces: [],
    pointAttributes: {},
  };
  for (let i = 0; i < indices.length; i += 3)
    mesh.faces.push(indices.slice(i, i + 3));
  for (const key of ["uv", "normal"]) {
    const a = g.getAttribute(key);
    if (a)
      mesh.pointAttributes![key === "normal" ? "N" : key] = Array.from(
        { length: a.count },
        (_, i) =>
          Array.from({ length: a.itemSize }, (_, j) => a.getComponent(i, j)),
      );
  }
  g.dispose();
  return mesh;
};
const faceNormal = (mesh: MeshData, face: number[]) =>
  v(mesh.positions[face[1]])
    .sub(v(mesh.positions[face[0]]))
    .cross(v(mesh.positions[face[2]]).sub(v(mesh.positions[face[0]])))
    .normalize();
function flatMesh(mesh: MeshData): MeshData {
  const out: MeshData = { positions: [], faces: [], pointAttributes: {} };
  for (const face of mesh.faces) {
    const next: number[] = [];
    for (const index of face) {
      next.push(out.positions.length);
      out.positions.push([...mesh.positions[index]]);
      for (const [key, values] of Object.entries(mesh.pointAttributes ?? {}))
        (out.pointAttributes![key] ??= []).push([...(values[index] ?? [0])]);
    }
    out.faces.push(next);
  }
  return out;
}
function filterMesh(
  mesh: MeshData,
  keep: Set<number>,
  domain: string,
): MeshData {
  const faces =
      domain === "primitive"
        ? mesh.faces.filter((_, i) => keep.has(i))
        : mesh.faces.filter((face) => face.every((i) => keep.has(i))),
    used = new Set(domain === "point" ? [...keep] : faces.flat()),
    ids = [...used].sort((a, b) => a - b),
    mapping = new Map(ids.map((id, i) => [id, i]));
  const out: MeshData = {
    positions: ids.map((i) => mesh.positions[i]),
    faces: faces.map((face) => face.map((i) => mapping.get(i)!)),
    pointAttributes: {},
  };
  for (const [key, values] of Object.entries(mesh.pointAttributes ?? {}))
    out.pointAttributes![key] = ids.map((i) => values[i]);
  out.lines = (mesh.lines ?? [])
    .filter((line) => line.every((i) => used.has(i)))
    .map((line) => line.map((i) => mapping.get(i)!));
  return out;
}
function loft(a: Vec3[], b: Vec3[], layers: number, closed: boolean): MeshData {
  if (a.length !== b.length || a.length < 2)
    throw new Error("放样截面的点数必须相同且不少于 2 点");
  const mesh: MeshData = { positions: [], faces: [] };
  for (let row = 0; row <= layers; row++)
    for (let i = 0; i < a.length; i++)
      mesh.positions.push(xyz(v(a[i]).lerp(v(b[i]), row / layers)));
  for (let row = 0; row < layers; row++)
    for (let i = 0; i < (closed ? a.length : a.length - 1); i++) {
      const j = (i + 1) % a.length,
        base = row * a.length;
      mesh.faces.push([
        base + i,
        base + j,
        base + a.length + j,
        base + a.length + i,
      ]);
    }
  return mesh;
}
function isoSurface(
  field: (x: number, y: number, z: number) => number,
  resolution: number,
  iso: number,
  extent = 2,
): MeshData {
  const mesh: MeshData = { positions: [], faces: [] },
    size = resolution + 1,
    values = new Float64Array(size ** 3),
    point = (x: number, y: number, z: number): Vec3 => [
      ((x / resolution) * 2 - 1) * extent,
      ((y / resolution) * 2 - 1) * extent,
      ((z / resolution) * 2 - 1) * extent,
    ],
    index = (x: number, y: number, z: number) => (z * size + y) * size + x;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        values[index(x, y, z)] = field(...point(x, y, z)) - iso;
  const cube = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    tetra = [
      [0, 5, 1, 6],
      [0, 1, 2, 6],
      [0, 2, 3, 6],
      [0, 3, 7, 6],
      [0, 7, 4, 6],
      [0, 4, 5, 6],
    ],
    edges = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ];
  for (let z = 0; z < resolution; z++)
    for (let y = 0; y < resolution; y++)
      for (let x = 0; x < resolution; x++) {
        const points = cube.map(([a, b, c]) => point(x + a, y + b, z + c)),
          vals = cube.map(([a, b, c]) => values[index(x + a, y + b, z + c)]);
        for (const ids of tetra) {
          const cross: Vec3[] = [];
          for (const [a, b] of edges) {
            const i = ids[a],
              j = ids[b];
            if (vals[i] < 0 !== vals[j] < 0)
              cross.push(
                xyz(
                  v(points[i]).lerp(
                    v(points[j]),
                    vals[i] / (vals[i] - vals[j]),
                  ),
                ),
              );
          }
          if (cross.length >= 3) {
            if (cross.length === 4) {
              const mid = cross
                  .reduce((sum, p) => sum.add(v(p)), new THREE.Vector3())
                  .multiplyScalar(0.25),
                normal = v(cross[1])
                  .sub(v(cross[0]))
                  .cross(v(cross[2]).sub(v(cross[0])))
                  .normalize(),
                axis = v(cross[0]).sub(mid).normalize(),
                other = normal.clone().cross(axis);
              cross.sort(
                (a, b) =>
                  Math.atan2(
                    v(a).sub(mid).dot(other),
                    v(a).sub(mid).dot(axis),
                  ) -
                  Math.atan2(v(b).sub(mid).dot(other), v(b).sub(mid).dot(axis)),
              );
            }
            const base = mesh.positions.length;
            mesh.positions.push(...cross);
            for (let i = 1; i < cross.length - 1; i++)
              mesh.faces.push([base, base + i, base + i + 1]);
          }
        }
      }
  const welded = weldMesh(mesh, 1e-5),
    gradient = (point: Vec3) => {
      const [x, y, z] = point,
        e = 1e-4;
      return new THREE.Vector3(
        field(x + e, y, z) - field(x - e, y, z),
        field(x, y + e, z) - field(x, y - e, z),
        field(x, y, z + e) - field(x, y, z - e),
      ).normalize();
    };
  for (const face of welded.faces)
    if (faceNormal(welded, face).dot(gradient(center(welded, face))) < 0)
      face.reverse();
  welded.pointAttributes = {
    N: welded.positions.map((point) => xyz(gradient(point))),
  };
  return welded;
}
function section(
  mesh: MeshData,
  normal: THREE.Vector3,
  offset: number,
): MeshData {
  const result: MeshData = { positions: [], faces: [], lines: [] };
  for (const face of triangulate(mesh).faces) {
    const points = face.map((i) => v(mesh.positions[i])),
      intersections: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const a = points[i],
        b = points[(i + 1) % 3],
        da = a.dot(normal) - offset,
        db = b.dot(normal) - offset;
      if (da < 0 !== db < 0)
        intersections.push(a.clone().lerp(b, da / (da - db)));
    }
    if (intersections.length === 2) {
      const start = result.positions.length;
      result.positions.push(...intersections.map(xyz));
      result.lines!.push([start, start + 1]);
    }
  }
  return weldMesh(result);
}
function intersectSurfaces(first: MeshData, second: MeshData): MeshData {
  const a = triangulate(first),
    b = triangulate(second),
    out: MeshData = { positions: [], faces: [], lines: [] };
  if (a.faces.length * b.faces.length > 1000000)
    throw new Error("曲面交线超出一百万面对检查预算，请降低网格精度");
  for (const fa of a.faces) {
    const ta = new THREE.Triangle(
        ...(fa.map((i) => v(a.positions[i])) as [
          THREE.Vector3,
          THREE.Vector3,
          THREE.Vector3,
        ]),
      ),
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        ta.getNormal(new THREE.Vector3()),
        ta.a,
      ),
      box = new THREE.Box3().setFromPoints([ta.a, ta.b, ta.c]);
    for (const fb of b.faces) {
      const pts = fb.map((i) => v(b.positions[i]));
      if (!box.intersectsBox(new THREE.Box3().setFromPoints(pts))) continue;
      const hits: THREE.Vector3[] = [];
      for (let i = 0; i < 3; i++) {
        const hit = plane.intersectLine(
          new THREE.Line3(pts[i], pts[(i + 1) % 3]),
          new THREE.Vector3(),
        );
        if (
          hit &&
          ta.containsPoint(hit) &&
          !hits.some((p) => p.distanceToSquared(hit) < 1e-12)
        )
          hits.push(hit);
      }
      const tb = new THREE.Triangle(
          ...(pts as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
        ),
        pb = new THREE.Plane().setFromNormalAndCoplanarPoint(
          tb.getNormal(new THREE.Vector3()),
          tb.a,
        );
      for (let i = 0; i < 3; i++) {
        const hit = pb.intersectLine(
          new THREE.Line3(
            [ta.a, ta.b, ta.c][i],
            [ta.a, ta.b, ta.c][(i + 1) % 3],
          ),
          new THREE.Vector3(),
        );
        if (
          hit &&
          tb.containsPoint(hit) &&
          !hits.some((p) => p.distanceToSquared(hit) < 1e-12)
        )
          hits.push(hit);
      }
      if (hits.length >= 2) {
        const start = out.positions.length;
        out.positions.push(xyz(hits[0]), xyz(hits[1]));
        out.lines!.push([start, start + 1]);
      }
    }
  }
  return weldMesh(out);
}
function blendCamera(a: CameraSpec, b: CameraSpec, t: number): CameraSpec {
  return {
    ...a,
    position: xyz(v(a.position).lerp(v(b.position), t)),
    target: xyz(v(a.target).lerp(v(b.target), t)),
    fov: a.fov * (1 - t) + b.fov * t,
    near: a.near * (1 - t) + b.near * t,
    far: a.far * (1 - t) + b.far * t,
    zoom: a.zoom * (1 - t) + b.zoom * t,
  };
}
export function cookGeometryV2Node(
  node: GraphNode,
  time: number,
  input: (handle?: string) => unknown,
  state: Map<string, unknown>,
): Result {
  const type = node.type;
  if (!supported.has(type)) return { handled: false };
  if (type === "render_pick_dat") {
    const picked = cookGeometryV2Node(
      { ...node, type: "render_pick_chop" },
      time,
      input,
      state,
    );
    if (!picked.handled || !isChannelBuffer(picked.value))
      throw new Error("拾取结果不是有效通道");
    const columns = String(
      node.data.params.columns ?? "hit,object,tx,ty,tz,nx,ny,nz,distance",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const available = new Map(
      picked.value.channels.map((channel) => [
        channel.name,
        channel.samples[0],
      ]),
    );
    for (const column of columns)
      if (!available.has(column)) throw new Error(`拾取字段 ${column} 不存在`);
    return {
      handled: true,
      value: makeTable([
        columns,
        columns.map((column) => available.get(column)!),
      ]),
    };
  }

  if (type === "physics_state_chop" || type === "render_pick_chop") {
    const scene = input("in");
    if (!isSceneSpec(scene)) throw new Error("请连接 COMP 场景");
    const channels: Record<string, number[]> = {};
    if (type === "physics_state_chop") {
      scene.objects.forEach((object, i) => {
        for (const [axis, j] of [
          ["x", 0],
          ["y", 1],
          ["z", 2],
        ] as const) {
          channels[`body${i}_t${axis}`] = [(object.position ?? [0, 0, 0])[j]];
          channels[`body${i}_r${axis}`] = [(object.rotation ?? [0, 0, 0])[j]];
        }
        channels[`body${i}_mass`] = [object.body?.mass ?? 0];
      });
    } else {
      const built = buildScene(scene, 640, 360, resolveSceneModel);
      try {
        built.scene.updateMatrixWorld(true);
        built.camera.updateMatrixWorld(true);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(
          new THREE.Vector2(
            Number(node.data.params.x ?? 0),
            Number(node.data.params.y ?? 0),
          ),
          built.camera,
        );
        const hit = raycaster
          .intersectObjects(built.scene.children, true)
          .find((item) => item.object instanceof THREE.Mesh);
        channels.hit = [hit ? 1 : 0];
        channels.object = [-1];
        channels.distance = [hit?.distance ?? 0];
        for (const [axis, index] of [
          ["x", 0],
          ["y", 1],
          ["z", 2],
        ] as const) {
          channels[`t${axis}`] = [hit?.point.getComponent(index) ?? 0];
          channels[`n${axis}`] = [0];
        }
        if (hit) {
          let object = hit.object;
          while (object.parent && object.parent !== built.scene)
            object = object.parent;
          channels.object = [Number(object.userData.tdObjectIndex ?? -1)];
          const normal = hit.face?.normal
            .clone()
            .transformDirection(hit.object.matrixWorld);
          for (const [axis, index] of [
            ["x", 0],
            ["y", 1],
            ["z", 2],
          ] as const)
            channels[`n${axis}`] = [normal?.getComponent(index) ?? 0];
        }
      } finally {
        built.dispose();
      }
    }
    return { handled: true, value: makeChannels(channels, 60, time, true) };
  }
  const physics = cookScenePhysicsNode(node, time, input, state);
  if (physics) return { handled: true, value: physics };
  const p = node.data.params,
    n = (key: string, fallback = 0) => {
      const value = Number(p[key] ?? fallback);
      if (!Number.isFinite(value))
        throw new Error(`参数 ${key} 必须为有限数字`);
      return value;
    },
    s = (key: string, fallback = "") => String(p[key] ?? fallback),
    vec = (prefix = "", fallback = 0): Vec3 => [
      n(prefix + "x", fallback),
      n(prefix + "y", fallback),
      n(prefix + "z", fallback),
    ],
    result = (
      value:
        GeometrySpec | MaterialSpec | SceneSpec | ChannelBuffer | TableData,
    ): Result => {
      if (isGeometrySpec(value) && !value.material) {
        const upstream = input("in");
        if (isGeometrySpec(upstream) && upstream.material)
          value = { ...value, material: upstream.material };
      }
      return { handled: true, value };
    };
  const source = (handle = "in"): GeometrySpec => {
    const value = input(handle);
    if (!isGeometrySpec(value)) throw new Error("请连接有效 SOP 几何输入");
    return value;
  };
  const mesh = (handle = "in") => geometryMesh(source(handle)),
    json = (key: string) => {
      try {
        return JSON.parse(s(key));
      } catch {
        throw new Error(`参数 ${key} 不是有效 JSON`);
      }
    },
    integer = (key: string, lo: number, hi: number, fallback: number) =>
      Math.floor(clamp(n(key, fallback), lo, hi));
  if (type.endsWith("_mat")) {
    if (
      ["in_mat", "out_mat", "null_mat", "select_mat", "switch_mat"].includes(
        type,
      )
    ) {
      let index =
        type === "switch_mat"
          ? Number(input("index") ?? n("index"))
          : n("index");
      index = clamp(Math.floor(index), 0, 2);
      const value = input(index === 0 ? "in" : `in${index + 1}`);
      if (!isMaterialSpec(value)) throw new Error("请连接 MAT 材质");
      return result(value);
    }
    const models: Record<string, MaterialSpec["model"]> = {
      constant_mat: "constant",
      depth_mat: "depth",
      glsl_mat: "glsl",
      line_mat: "line",
      pbr_mat: "pbr",
      phong_mat: "phong",
      point_sprite_mat: "points",
      wireframe_mat: "wireframe",
    };
    const value: MaterialSpec = {
      kind: "material",
      model: models[type],
      color: s("color", "#ffffff"),
      opacity: n("opacity", 1),
      doubleSide: p.double_side !== false,
      roughness: n("roughness", 0.4),
      metalness: n("metalness", 0.2),
      clearcoat: n("clearcoat"),
      transmission: n("transmission"),
      ior: n("ior", 1.5),
      emissive: s("emissive", "#000000"),
      emissiveIntensity: n("emissive_intensity", 1),
      shininess: n("shininess", 40),
      size: n("size", 0.05),
      vertexShader: s("vertex_shader"),
      fragmentShader: s("fragment_shader"),
      time,
    };
    for (const [handle, key] of [
      ["map", "map"],
      ["normal", "normalMap"],
    ] as const) {
      const image = input(handle);
      if (
        typeof HTMLCanvasElement !== "undefined" &&
        image instanceof HTMLCanvasElement
      )
        value[key] = image;
    }
    if (type !== "glsl_mat" && !value.map && !value.normalMap)
      delete value.time;
    return result(value);
  }
  if (type === "file_in_sop") {
    if (!s("url")) throw new Error("请设置模型文件 URL");
    return result({ shape: "model", detail: 1, url: s("url") });
  }
  if (type === "import_select_sop") {
    const scene = input("in");
    if (!isSceneSpec(scene)) throw new Error("请选择 COMP 场景输入");
    const object = scene.objects[integer("index", 0, 4095, 0)];
    if (!object) throw new Error("场景对象索引不存在");
    return result({
      shape: "group",
      detail: 1,
      children: [object.geometry],
      position: object.position,
      rotation: object.rotation,
      scale: object.scale,
      material: object.material,
    });
  }
  if (type === "geo_text_comp" || type === "fbx_comp") {
    const scene = mergeScenes(input("in"));
    let geometry: GeometrySpec;
    if (type === "fbx_comp") {
      if (!s("url")) throw new Error("请设置模型文件 URL");
      geometry = { shape: "model", detail: 1, url: s("url") };
    } else {
      const text = s("text", "TD OPEN");
      if ([...text].some((c) => !font.data.glyphs[c]))
        throw new Error("内置立体字体目前只包含拉丁字符");
      const buffer = new TextGeometry(text, {
        font,
        size: n("size", 0.5),
        depth: n("depth", 0.12),
        curveSegments: 4,
        bevelEnabled: false,
      });
      buffer.center();
      geometry = meshSpec(bufferMesh(buffer));
    }
    const material = input("material");
    scene.objects.push({
      geometry,
      material: isMaterialSpec(material) ? material : undefined,
      position: vec(),
      scale: [n("scale", 1), n("scale", 1), n("scale", 1)],
    });
    return result(scene);
  }
  if (type === "arm_sop") {
    const lengths = json("lengths") as number[],
      angles = json("angles") as number[];
    if (lengths.length > 1000 || lengths.some((x) => !Number.isFinite(x)))
      throw new Error("关节链长度数组无效");
    let angle = 0;
    const points: Vec3[] = [[0, 0, 0]];
    for (let i = 0; i < lengths.length; i++) {
      angle += THREE.MathUtils.degToRad(angles[i] ?? 0);
      const previous = points.at(-1)!;
      points.push([
        previous[0] + Math.cos(angle) * lengths[i],
        previous[1] + Math.sin(angle) * lengths[i],
        0,
      ]);
    }
    return result(
      meshSpec({
        positions: points,
        faces: [],
        lines: [points.map((_, i) => i)],
      }),
    );
  }
  if (type.endsWith("_comp")) {
    const scene = mergeScenes(input(type === "geometry_comp" ? "scene" : "in"));
    if (type === "camera_comp")
      scene.camera = {
        projection: s("projection", "perspective") as CameraSpec["projection"],
        position: vec(),
        target: vec("target"),
        fov: n("fov", 45),
        near: n("near", 0.01),
        far: n("far", 1000),
        zoom: n("zoom", 1),
      };
    else if (type === "camera_blend_comp" || type === "blend_comp") {
      const other = input("in2");
      if (!isSceneSpec(other)) throw new Error("请连接第二路场景 / 相机");
      const merged = mergeScenes(scene, other);
      if (scene.camera && other.camera)
        merged.camera = blendCamera(
          scene.camera,
          other.camera,
          n("weight", 0.5),
        );
      else if (type === "camera_blend_comp")
        throw new Error("相机混合需要两路含相机的场景");
      return result(merged);
    } else if (type === "geometry_comp") {
      const material = input("material");
      scene.objects.push({
        geometry: source(),
        material: isMaterialSpec(material) ? material : undefined,
        position: vec(),
        rotation: vec("r"),
        scale: vec("s", 1),
        visible: p.visible !== false,
      });
    } else if (type === "null_comp") {
      const transform = new THREE.Matrix4().compose(
        v(vec()),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...(vec("r").map(THREE.MathUtils.degToRad) as Vec3)),
        ),
        new THREE.Vector3().setScalar(n("scale", 1)),
      );
      for (const object of scene.objects) {
        const local = new THREE.Matrix4().compose(
          v(object.position ?? [0, 0, 0]),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              ...((object.rotation ?? [0, 0, 0]).map(
                THREE.MathUtils.degToRad,
              ) as Vec3),
            ),
          ),
          v(object.scale ?? [1, 1, 1]),
        );
        local.premultiply(transform);
        const position = new THREE.Vector3(),
          rotation = new THREE.Quaternion(),
          scale = new THREE.Vector3();
        local.decompose(position, rotation, scale);
        object.position = xyz(position);
        const euler = new THREE.Euler().setFromQuaternion(rotation);
        object.rotation = [euler.x, euler.y, euler.z].map(
          THREE.MathUtils.radToDeg,
        ) as Vec3;
        object.scale = xyz(scale);
      }
    } else
      scene.lights.push({
        type:
          type === "ambient_light_comp"
            ? "ambient"
            : type === "environment_light_comp"
              ? "hemisphere"
              : (s("type", "directional") as "directional" | "point" | "spot"),
        color: s("color", "#ffffff"),
        groundColor: s("ground_color", "#403545"),
        intensity: n("intensity", 1),
        position: vec(),
        target: vec("target"),
        distance: n("distance"),
        decay: n("decay", 2),
        angle: THREE.MathUtils.degToRad(n("angle", 45)),
      });
    return result(scene);
  }
  if (type === "add_sop") {
    const positions = json("points"),
      faces = json("faces");
    if (!Array.isArray(positions) || !Array.isArray(faces))
      throw new Error("点和面需要 JSON 数组");
    return result(
      meshSpec({
        positions,
        faces,
        lines: p.connect ? [positions.map((_: unknown, i: number) => i)] : [],
      }),
    );
  }
  if (type === "dat_to_sop" || type === "chop_to_sop") {
    let data: unknown = input("in");
    if (type === "dat_to_sop" && typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = parseCSV(String(data))
          .filter((row) =>
            row.slice(0, 3).every((x) => Number.isFinite(Number(x))),
          )
          .map((row) => row.slice(0, 3).map(Number));
      }
    }
    if (data && typeof data === "object" && "positions" in data)
      return result(meshSpec(data as MeshData));
    let positions: Vec3[] = [];
    if (Array.isArray(data))
      positions = data.map((value, i) =>
        Array.isArray(value)
          ? [
              Number(value[0] ?? 0),
              Number(value[1] ?? 0),
              Number(value[2] ?? 0),
            ]
          : [i * 0.1, Number(value), 0],
      );
    else if (data && typeof data === "object" && "channels" in data) {
      const raw = (data as { channels: unknown }).channels;
      const channels = Array.isArray(raw)
        ? Object.fromEntries(
            raw.map(
              (c: { name: string; samples?: number[]; values?: number[] }) => [
                c.name,
                c.samples ?? c.values ?? [],
              ],
            ),
          )
        : (raw as Record<string, number[]>);
      const first = Object.values(channels)[0] ?? [];
      positions = Array.from({ length: first.length }, (_, i) => [
        channels.x?.[i] ?? channels.tx?.[i] ?? first[i] ?? i * 0.1,
        channels.y?.[i] ??
          channels.ty?.[i] ??
          Object.values(channels)[1]?.[i] ??
          0,
        channels.z?.[i] ??
          channels.tz?.[i] ??
          Object.values(channels)[2]?.[i] ??
          0,
      ]);
    } else if (typeof data === "number") positions = [[0, data, 0]];
    else throw new Error("输入必须为坐标数组、网格 JSON 或多通道样本");
    if (type === "chop_to_sop")
      positions = positions.map(
        (point) => point.map((x) => x * n("scale", 1)) as Vec3,
      );
    return result(
      meshSpec({
        positions,
        faces: [],
        lines: p.connect ? [positions.map((_, i) => i)] : [],
      }),
    );
  }
  if (type === "rectangle_sop") {
    const w = n("width", 2) / 2,
      h = n("height", 1.5) / 2;
    return result(
      meshSpec({
        positions: [
          [-w, -h, 0],
          [w, -h, 0],
          [w, h, 0],
          [-w, h, 0],
        ],
        faces: p.fill ? [[0, 1, 2, 3]] : [],
        lines: p.fill ? [] : [[0, 1, 2, 3, 0]],
      }),
    );
  }
  if (type === "text_sop") {
    const content = s("text", "TD OPEN");
    if (content.length > 300) throw new Error("立体文字最多 300 字符");
    if ([...content].some((c) => !font.data.glyphs[c]))
      throw new Error(
        "当前内置字体不包含部分字符，请使用拉丁文字或导入字体轮廓几何",
      );
    const geometry = new TextGeometry(content, {
      font,
      size: n("size", 0.5),
      depth: n("depth", 0.12),
      curveSegments: 4,
      bevelEnabled: n("bevel") > 0,
      bevelThickness: n("bevel"),
      bevelSize: n("bevel"),
      bevelSegments: 2,
    });
    geometry.center();
    return result(meshSpec(bufferMesh(geometry)));
  }
  if (type === "superquad_sop") {
    const segments = integer("segments", 6, 100, 32),
      positions: Vec3[] = [],
      faces: number[][] = [],
      power = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
    for (let j = 0; j <= segments; j++) {
      const u = -Math.PI / 2 + (j / segments) * Math.PI;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * 2 * Math.PI;
        positions.push([
          power(Math.cos(u), n("exponent1", 0.5)) *
            power(Math.cos(a), n("exponent2", 0.5)),
          power(Math.sin(u), n("exponent1", 0.5)),
          power(Math.cos(u), n("exponent1", 0.5)) *
            power(Math.sin(a), n("exponent2", 0.5)),
        ]);
      }
    }
    for (let j = 0; j < segments; j++)
      for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i;
        faces.push([a, a + 1, a + segments + 2, a + segments + 1]);
      }
    return result(meshSpec(weldMesh({ positions, faces })));
  }
  if (type === "iso_surface_sop" || type === "metaball_sop") {
    let field: (x: number, y: number, z: number) => number;
    if (type === "metaball_sop") {
      const centers = json("centers") as Vec3[],
        r = n("radius", 0.6);
      field = (x, y, z) =>
        centers.reduce(
          (sum, c) =>
            sum +
            (r * r) /
              Math.max(
                0.0001,
                (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2,
              ),
          0,
        );
    } else {
      const scale = n("scale", 2);
      field = (x, y, z) => {
        if (s("field") === "sphere") return x * x + y * y + z * z - 1;
        if (s("field") === "torus")
          return (Math.sqrt(x * x + z * z) - 1) ** 2 + y * y - 0.2;
        return (
          Math.sin(x * scale) * Math.cos(y * scale) +
          Math.sin(y * scale) * Math.cos(z * scale) +
          Math.sin(z * scale) * Math.cos(x * scale)
        );
      };
    }
    return result(
      meshSpec(
        isoSurface(
          field,
          integer("resolution", 6, 40, 18),
          n("iso", type === "metaball_sop" ? 1 : 0),
        ),
      ),
    );
  }
  if (type === "lsystem_sop") {
    let sequence = s("axiom", "F");
    const rules = json("rules") as Record<string, string>;
    for (let j = 0; j < integer("iterations", 0, 5, 3); j++) {
      sequence = [...sequence].map((c) => rules[c] ?? c).join("");
      if (sequence.length > 100000)
        throw new Error("L 系统超过 10 万字符，请减少迭代");
    }
    const positions: Vec3[] = [[0, 0, 0]],
      lines: number[][] = [];
    let current = new THREE.Vector3(),
      direction = new THREE.Vector3(0, 1, 0),
      last = 0;
    const stack: {
      point: THREE.Vector3;
      direction: THREE.Vector3;
      last: number;
    }[] = [];
    for (const command of sequence) {
      if (command === "F" || command === "G") {
        current = current.clone().addScaledVector(direction, n("step", 0.15));
        const next = positions.length;
        positions.push(xyz(current));
        lines.push([last, next]);
        last = next;
      } else if ("+-&^\\/".includes(command)) {
        const axis =
          command === "+" || command === "-"
            ? new THREE.Vector3(0, 0, 1)
            : command === "&" || command === "^"
              ? new THREE.Vector3(1, 0, 0)
              : new THREE.Vector3(0, 1, 0);
        direction.applyAxisAngle(
          axis,
          THREE.MathUtils.degToRad(n("angle", 25)) *
            (["-", "^", "/"].includes(command) ? -1 : 1),
        );
      } else if (command === "[")
        stack.push({
          point: current.clone(),
          direction: direction.clone(),
          last,
        });
      else if (command === "]") {
        const value = stack.pop();
        if (value) {
          current = value.point;
          direction = value.direction;
          last = value.last;
        }
      }
    }
    return result(meshSpec({ positions, faces: [], lines }));
  }
  if (type === "raster_sop" || type === "trace_sop") {
    const image = input("in");
    if (
      typeof HTMLCanvasElement === "undefined" ||
      !(image instanceof HTMLCanvasElement)
    )
      throw new Error("请连接 TOP 图像");
    const size = integer("resolution", 2, 128, 32),
      canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data,
      brightness = (x: number, y: number) => {
        const i = (y * size + x) * 4;
        return (
          (pixels[i] * 0.2126 +
            pixels[i + 1] * 0.7152 +
            pixels[i + 2] * 0.0722) /
          255
        );
      },
      out: MeshData = { positions: [], faces: [], lines: [] };
    if (type === "raster_sop") {
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          out.positions.push([
            (x / (size - 1) - 0.5) * n("width", 3),
            brightness(x, y) * n("height", 1),
            (y / (size - 1) - 0.5) * n("width", 3),
          ]);
      for (let y = 0; y < size - 1; y++)
        for (let x = 0; x < size - 1; x++) {
          const a = y * size + x;
          out.faces.push([a, a + size, a + size + 1, a + 1]);
        }
    } else {
      const edge = (x: number, y: number, dx: number, dy: number) => {
        const start = out.positions.length;
        out.positions.push(
          [(x / size - 0.5) * 3, (0.5 - y / size) * 3, 0],
          [((x + dx) / size - 0.5) * 3, (0.5 - (y + dy) / size) * 3, 0],
        );
        out.lines!.push([start, start + 1]);
      };
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (brightness(x, y) >= n("threshold", 0.5)) {
            if (x === 0 || brightness(x - 1, y) < n("threshold", 0.5))
              edge(x, y, 0, 1);
            if (y === 0 || brightness(x, y - 1) < n("threshold", 0.5))
              edge(x, y, 1, 0);
            if (x === size - 1 || brightness(x + 1, y) < n("threshold", 0.5))
              edge(x + 1, y, 0, 1);
            if (y === size - 1 || brightness(x, y + 1) < n("threshold", 0.5))
              edge(x, y + 1, 1, 0);
          }
    }
    return result(meshSpec(out));
  }
  if (type === "null_sop") return result(source());
  if (type === "switch_sop") {
    const index = integer("index", 0, 2, 0);
    return result(source(index === 0 ? "in" : `in${index + 1}`));
  }
  if (type === "material_sop") {
    const value = input("material");
    if (!isMaterialSpec(value)) throw new Error("请连接 MAT 材质");
    return result({ ...source(), material: value });
  }
  let data = mesh();
  if (["capture_sop", "capture_region_sop", "deform_sop"].includes(type)) {
    const scene = input("bones");
    if (!isSceneSpec(scene) || !scene.bones?.length)
      throw new Error("请连接含 Bone 的场景");
    const bones = scene.bones;
    if (type === "capture_sop") {
      const indices: number[][] = [],
        weights: number[][] = [];
      for (const point of data.positions) {
        const closest = bones
            .map((bone, index) => {
              const segment = new THREE.Line3(v(bone.start), v(bone.end)),
                nearest = segment.closestPointToPoint(
                  v(point),
                  true,
                  new THREE.Vector3(),
                );
              return {
                index,
                weight:
                  1 /
                  Math.pow(
                    Math.max(0.001, nearest.distanceTo(v(point))),
                    n("falloff", 2),
                  ),
              };
            })
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 4),
          sum = closest.reduce((sum, bone) => sum + bone.weight, 0);
        indices.push(
          Array.from({ length: 4 }, (_, i) => closest[i]?.index ?? 0),
        );
        weights.push(
          Array.from({ length: 4 }, (_, i) => (closest[i]?.weight ?? 0) / sum),
        );
      }
      data.pointAttributes = {
        ...data.pointAttributes,
        captureIndex: indices,
        captureWeight: weights,
      };
    } else if (type === "capture_region_sop") {
      const index = integer("index", 0, 255, 0),
        bone = bones[index];
      if (!bone) throw new Error("骨骼索引不存在");
      const segment = new THREE.Line3(v(bone.start), v(bone.end)),
        weights = data.positions.map((point) =>
          Math.max(
            0,
            1 -
              segment
                .closestPointToPoint(v(point), true, new THREE.Vector3())
                .distanceTo(v(point)) /
                n("radius", 1),
          ),
        );
      data.pointAttributes = {
        ...data.pointAttributes,
        captureIndex: weights.map(() => [index, 0, 0, 0]),
        captureWeight: weights.map((weight) => [weight, 1 - weight, 0, 0]),
        Cd: weights.map((weight) => [weight, 0.15, 1 - weight]),
      };
    } else {
      const indices = data.pointAttributes?.captureIndex,
        weights = data.pointAttributes?.captureWeight;
      if (!indices || !weights)
        throw new Error("请先连接 Capture SOP 生成权重");
      const transforms = new Map<string, THREE.Matrix4>();
      const transform = (index: number): THREE.Matrix4 => {
        const bone = bones[index];
        if (!bone) throw new Error("捕获引用的骨骼不存在");
        const cached = transforms.get(bone.id);
        if (cached) return cached;
        const pivot = v(bone.start),
          matrix = new THREE.Matrix4()
            .makeTranslation(...bone.start)
            .multiply(
              new THREE.Matrix4().makeRotationFromEuler(
                new THREE.Euler(
                  ...(bone.rotation.map(THREE.MathUtils.degToRad) as Vec3),
                ),
              ),
            )
            .multiply(
              new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z),
            );
        if (bone.parent) {
          const parent = bones.findIndex((item) => item.id === bone.parent);
          if (parent < 0 || parent >= index)
            throw new Error("骨骼父级顺序无效");
          matrix.premultiply(transform(parent));
        }
        transforms.set(bone.id, matrix);
        return matrix;
      };
      data.positions = data.positions.map((point, i) => {
        const position = new THREE.Vector3();
        for (let j = 0; j < 4; j++)
          if (weights[i][j])
            position.addScaledVector(
              v(point).applyMatrix4(transform(indices[i][j])),
              weights[i][j],
            );
        return xyz(position);
      });
    }
    return result(meshSpec(data));
  }
  if (type === "bone_group_sop") {
    const indices = data.pointAttributes?.captureIndex,
      weights = data.pointAttributes?.captureWeight;
    if (!indices || !weights) throw new Error("骨骼分组需要 Capture 属性");
    const selected = indices
      .map((_, i) => i)
      .filter((i) =>
        indices[i].some(
          (index, j) =>
            index === n("index") && weights[i][j] >= n("threshold", 0.1),
        ),
      );
    data.groups ??= {};
    (data.groups.points ??= {})[s("name", "bone_selection")] = selected;
    return result(meshSpec(data));
  }
  if (type === "joint_sop") {
    const points = curvePoints(data),
      index = integer("index", 0, 1000, 1);
    if (!points[index]) throw new Error("关节点索引不存在");
    const axis = new THREE.Vector3();
    axis.setComponent(["x", "y", "z"].indexOf(s("axis", "z")), 1);
    const pivot = v(points[index]);
    const output = points.map((point, i) =>
      i <= index
        ? point
        : xyz(
            v(point)
              .sub(pivot)
              .applyAxisAngle(axis, THREE.MathUtils.degToRad(n("angle", 30)))
              .add(pivot),
          ),
    );
    return result(
      meshSpec({
        positions: output,
        faces: [],
        lines: [output.map((_, i) => i)],
      }),
    );
  }
  if (type === "curvesect_sop") {
    const first = curvePoints(data),
      second = curvePoints(mesh("in2")),
      points: Vec3[] = [];
    for (let i = 1; i < first.length; i++)
      for (let j = 1; j < second.length; j++) {
        const a = first[i - 1],
          b = first[i],
          c = second[j - 1],
          d = second[j],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          ex = d[0] - c[0],
          ey = d[1] - c[1],
          den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-10) continue;
        const tx = c[0] - a[0],
          ty = c[1] - a[1],
          t = (tx * ey - ty * ex) / den,
          u = (tx * dy - ty * dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
          points.push([a[0] + dx * t, a[1] + dy * t, 0]);
      }
    return result(meshSpec({ positions: points, faces: [] }));
  }
  if (type === "object_merge_sop") {
    for (const handle of ["in2", "in3"])
      if (isGeometrySpec(input(handle))) data = mergeMeshes(data, mesh(handle));
    return result(meshSpec(data));
  }
  if (type === "boolean_sop")
    return result(
      meshSpec(booleanMeshes(data, mesh("in2"), s("operation", "union"))),
    );
  if (type === "divide_sop") return result(meshSpec(triangulate(data)));
  if (type === "subdivide_sop") {
    data = subdivide(weldMesh(data), integer("iterations", 0, 3, 1));
    if (n("smooth", 0.2) > 0) data = smoothMesh(data, 1, n("smooth", 0.2));
    return result(meshSpec(data));
  }
  if (type === "cap_sop") return result(meshSpec(capMesh(data)));
  if (type === "polypatch_sop")
    return result(
      meshSpec(
        smoothMesh(
          subdivide(capMesh(data), integer("iterations", 0, 3, 1)),
          1,
          0.2,
        ),
      ),
    );
  if (type === "clip_sop") {
    data = clipMesh(data, [n("nx", 1), n("ny"), n("nz")], n("offset"));
    return result(meshSpec(p.cap ? capMesh(data) : data));
  }
  if (type === "trim_sop") {
    if (n("min") >= n("max")) throw new Error("最小坐标必须小于最大坐标");
    for (let axis = 0; axis < 3; axis++) {
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = 1;
      data = clipMesh(data, normal, n("min"));
      normal[axis] = -1;
      data = clipMesh(data, normal, -n("max"));
    }
    return result(meshSpec(data));
  }
  if (type === "model_sop") {
    if (data.positions.length < 4)
      throw new Error("三维凸包至少需要 4 个非共面点");
    return result(
      meshSpec(bufferMesh(new ConvexGeometry(data.positions.map(v)))),
    );
  }
  if (type === "align_sop") {
    const target = bounds(mesh("in2")),
      own = bounds(data),
      anchor = s("anchor", "center"),
      first =
        anchor === "min"
          ? own.min
          : anchor === "max"
            ? own.max
            : own.getCenter(new THREE.Vector3()),
      second =
        anchor === "min"
          ? target.min
          : anchor === "max"
            ? target.max
            : target.getCenter(new THREE.Vector3()),
      delta = second.clone().sub(first);
    data.positions = data.positions.map(
      (point) =>
        point.map((value, i) =>
          s("axis", "all") === "all" || s("axis") === ["x", "y", "z"][i]
            ? value + delta.getComponent(i)
            : value,
        ) as Vec3,
    );
  } else if (type === "attribute_create_sop") {
    const value = json("value");
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 4 ||
      value.some((x) => !Number.isFinite(x))
    )
      throw new Error("属性需要 1–4 个有限数值分量");
    const target =
      s("domain") === "primitive"
        ? (data.primitiveAttributes ??= {})
        : (data.pointAttributes ??= {});
    target[s("name", "Cd")] = Array.from(
      {
        length:
          s("domain") === "primitive"
            ? data.faces.length
            : data.positions.length,
      },
      () => [...value],
    );
  } else if (type === "attribute_sop") {
    const name = s("name", "Cd"),
      attributes = data.pointAttributes ?? {},
      values = attributes[name];
    if (!values) throw new Error(`点属性 ${name} 不存在`);
    if (s("operation") === "delete") delete attributes[name];
    else if (s("operation") === "normalize")
      attributes[name] = values.map((row) => {
        const length = Math.hypot(...row);
        return row.map((x) => (length ? x / length : 0));
      });
    else {
      attributes[s("rename", "color")] = values;
      delete attributes[name];
    }
  } else if (type === "blend_sop" || type === "sequence_blend_sop") {
    const other = mesh("in2");
    if (data.positions.length !== other.positions.length)
      throw new Error("混合需要点数相同的网格");
    const weight =
      type === "blend_sop"
        ? n("weight", 0.5)
        : 0.5 -
          0.5 * Math.cos((time * n("speed", 0.3) + n("phase")) * Math.PI * 2);
    data.positions = data.positions.map((point, i) =>
      xyz(v(point).lerp(v(other.positions[i]), weight)),
    );
  } else if (
    [
      "basis_sop",
      "polyspline_sop",
      "resample_sop",
      "carve_sop",
      "refine_sop",
      "fillet_sop",
      "inverse_curve_sop",
      "curveclay_sop",
    ].includes(type)
  ) {
    let points = curvePoints(data);
    if (points.length < 2) throw new Error("曲线至少需要两个点");
    if (type === "inverse_curve_sop") {
      data.faces.forEach((face) => face.reverse());
      data.lines?.forEach((line) => line.reverse());
      if (!data.faces.length && !data.lines?.length) data.positions.reverse();
    } else if (type === "curveclay_sop") {
      data.positions = data.positions.map((point, i) =>
        xyz(
          v(point).addScaledVector(
            v(vec("d", 0.2)),
            Math.exp(
              -(
                ((i / Math.max(1, data.positions.length - 1) -
                  n("index", 0.5)) /
                  n("radius", 0.25)) **
                2
              ),
            ),
          ),
        ),
      );
    } else if (type === "fillet_sop") {
      const output: Vec3[] = [points[0]],
        segments = integer("segments", 1, 32, 6);
      for (let i = 1; i < points.length - 1; i++) {
        const a = v(points[i]).lerp(v(points[i - 1]), n("radius", 0.2)),
          b = v(points[i]).lerp(v(points[i + 1]), n("radius", 0.2)),
          curve = new THREE.QuadraticBezierCurve3(a, v(points[i]), b);
        output.push(...curve.getPoints(segments).map(xyz));
      }
      output.push(points.at(-1)!);
      data = { positions: output, faces: [], lines: [output.map((_, i) => i)] };
    } else if (type === "refine_sop") {
      const output: Vec3[] = [];
      for (let i = 0; i < points.length - 1; i++)
        for (let j = 0; j < integer("segments", 1, 32, 3); j++)
          output.push(
            xyz(
              v(points[i]).lerp(
                v(points[i + 1]),
                j / integer("segments", 1, 32, 3),
              ),
            ),
          );
      output.push(points.at(-1)!);
      data = { positions: output, faces: [], lines: [output.map((_, i) => i)] };
    } else if (type === "carve_sop") {
      const dense = resampleCurve(points, 1001),
        start = clamp(n("start", 0.1), 0, 1),
        end = clamp(n("end", 0.9), 0, 1);
      if (start >= end) throw new Error("截取起点必须小于终点");
      data = resampleCurve(
        dense.positions.slice(
          Math.floor(start * 1000),
          Math.ceil(end * 1000) + 1,
        ),
        integer("count", 2, 256, 32),
      );
    } else if (type === "resample_sop" || s("basis") === "linear")
      data = resampleCurve(
        points,
        integer("count", 2, 256, 32),
        Boolean(p.closed),
      );
    else {
      const count = integer("count", 2, 256, 32);
      if (s("basis") === "bezier") {
        if (points.length < 4) throw new Error("三次贝塞尔需要至少四个控制点");
        points = new THREE.CubicBezierCurve3(
          ...(points.slice(0, 4).map(v) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
          ]),
        )
          .getPoints(count - 1)
          .map(xyz);
      } else
        points = new THREE.CatmullRomCurve3(
          points.map(v),
          Boolean(p.closed),
          "catmullrom",
          n("tension", 0.5),
        )
          .getPoints(count - 1)
          .map(xyz);
      data = { positions: points, faces: [], lines: [points.map((_, i) => i)] };
    }
  } else if (type === "bridge_sop") {
    const other = mesh("in2"),
      a =
        boundaryLoops(weldMesh(data))[0] ?? curvePoints(data).map((_, i) => i),
      b =
        boundaryLoops(weldMesh(other))[0] ??
        curvePoints(other).map((_, i) => i);
    data = weldMesh(data);
    const second = weldMesh(other);
    const firstPoints = a.map((i) => data.positions[i]),
      secondPoints = b.map((i) => second.positions[i]);
    const count = Math.max(firstPoints.length, secondPoints.length),
      aa = resampleCurve(firstPoints, count, true).positions,
      bb = resampleCurve(secondPoints, count, true).positions,
      offset = n("offset");
    return result(
      meshSpec(
        loft(
          aa,
          bb.map((_, i) => bb[(((i + offset) % count) + count) % count]),
          1,
          true,
        ),
      ),
    );
  } else if (type === "cache_sop") {
    const saved = (state.get(node.id) as
      { time: number; frames: MeshData[] } | undefined) ?? { time, frames: [] };
    if (time < saved.time) saved.frames = [];
    if (!p.freeze && (saved.time !== time || !saved.frames.length)) {
      saved.frames.push(cloneMesh(data));
      saved.frames = saved.frames.slice(-121);
      while (
        saved.frames.length > 1 &&
        saved.frames.reduce((sum, frame) => sum + frame.positions.length, 0) >
          500000
      )
        saved.frames.shift();
    }
    saved.time = time;
    state.set(node.id, saved);
    data =
      saved.frames[
        Math.max(0, saved.frames.length - 1 - integer("frames", 0, 120, 10))
      ] ?? data;
  } else if (type === "group_sop") {
    const domain = s("domain", "point"),
      values =
        domain === "point"
          ? data.positions
          : data.faces.map((face) => center(data, face)),
      indices = values
        .map((_, i) => i)
        .filter((i) =>
          s("mode") === "sphere"
            ? v(values[i]).distanceTo(v(vec())) <= n("radius", 1)
            : i >= n("start") && i <= n("end", 10),
        );
    data.groups ??= {};
    if (domain === "point")
      (data.groups.points ??= {})[s("name", "selection")] = indices;
    else (data.groups.primitives ??= {})[s("name", "selection")] = indices;
  } else if (type === "delete_sop" || type === "select_sop") {
    const domain = s("domain", "primitive"),
      length = domain === "point" ? data.positions.length : data.faces.length,
      group = s("group"),
      named =
        domain === "point"
          ? data.groups?.points?.[group]
          : data.groups?.primitives?.[group];
    if (group && !named) throw new Error(`组 ${group} 不存在`);
    const selected = new Set(
        named ??
          Array.from({ length }, (_, i) => i).filter(
            (i) => i >= n("start") && i <= n("end"),
          ),
      ),
      keep = new Set(
        Array.from({ length }, (_, i) => i).filter((i) =>
          type === "select_sop"
            ? selected.has(i)
            : p.invert
              ? selected.has(i)
              : !selected.has(i),
        ),
      );
    data = filterMesh(data, keep, domain);
  } else if (type === "clay_sop" || type === "magnet_sop") {
    const target = v(vec()),
      radius = n("radius", 1);
    data.positions = data.positions.map((point) => {
      const position = v(point),
        distance = position.distanceTo(target),
        weight = Math.max(0, 1 - distance / radius) ** 2;
      if (type === "magnet_sop")
        position.lerp(target, weight * n("amount", 0.5));
      else
        position.setComponent(
          ["x", "y", "z"].indexOf(s("axis", "z")),
          position.getComponent(["x", "y", "z"].indexOf(s("axis", "z"))) +
            weight * n("amount", 0.4),
        );
      return xyz(position);
    });
  } else if (type === "convert_sop") {
    if (s("mode") === "points") {
      data.faces = [];
      data.lines = [];
    } else if (s("mode") === "lines") {
      data.lines = data.faces.map((face) => [...face, face[0]]);
      data.faces = [];
    } else data = triangulate(data);
  } else if (type === "facet_sop") {
    if (s("mode") === "flat") data = flatMesh(data);
    else data = weldMesh(data, n("tolerance", 0.0001));
    if (s("mode") !== "weld") {
      const normals = data.positions.map(() => new THREE.Vector3());
      for (const face of data.faces) {
        const normal = faceNormal(data, face);
        face.forEach((i) => normals[i].add(normal));
      }
      (data.pointAttributes ??= {}).N = normals.map((normal) =>
        xyz(normal.normalize()),
      );
    }
  } else if (type === "fit_sop") {
    const box = bounds(data),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3()),
      target = [n("width", 2), n("height", 2), n("depth", 2)],
      scale = target.map((x, i) =>
        size.getComponent(i) > 1e-9 ? x / size.getComponent(i) : 1,
      ),
      factor = p.uniform ? Math.min(...scale) : 0;
    data.positions = data.positions.map(
      (point) =>
        point.map(
          (x, i) =>
            (x - center.getComponent(i)) * (p.uniform ? factor : scale[i]),
        ) as Vec3,
    );
  } else if (type === "force_sop") {
    (data.pointAttributes ??= {}).force = data.positions.map((point) => {
      const force =
        s("mode") === "radial"
          ? v(point).normalize()
          : s("mode") === "vortex"
            ? new THREE.Vector3(-point[2], 0, point[0]).normalize()
            : v(vec("d", 1)).normalize();
      return xyz(force.multiplyScalar(n("amount", 0.5)));
    });
  } else if (type === "fractal_sop") {
    const noise = (x: number, y: number, z: number) => {
      let sum = 0,
        amplitude = 0.5,
        frequency = n("frequency", 2);
      for (let i = 0; i < integer("octaves", 1, 8, 4); i++) {
        sum +=
          Math.sin(x * frequency + n("seed", 1) * 1.7) *
          Math.cos(y * frequency * 0.8 + n("seed", 1)) *
          Math.sin(z * frequency * 0.7 + n("seed", 1) * 0.3) *
          amplitude;
        frequency *= 2.03;
        amplitude *= 0.5;
      }
      return sum;
    };
    data.positions = data.positions.map((point) => {
      const normal = v(point).normalize();
      if (!normal.lengthSq()) normal.set(0, 1, 0);
      return xyz(
        v(point).addScaledVector(normal, noise(...point) * n("amount", 0.5)),
      );
    });
  } else if (type === "hole_sop")
    data = filterMesh(
      data,
      new Set(
        data.faces
          .map((face, i) => ({
            i,
            d: v(center(data, face)).distanceTo(v(vec())),
          }))
          .filter(({ d }) => d >= n("radius", 0.5))
          .map(({ i }) => i),
      ),
      "primitive",
    );
  else if (type === "join_sop") {
    const a = curvePoints(data),
      b = curvePoints(mesh("in2"));
    if (
      p.nearest &&
      v(a.at(-1)!).distanceTo(v(b.at(-1)!)) < v(a.at(-1)!).distanceTo(v(b[0]))
    )
      b.reverse();
    const points = [...a, ...b];
    data = { positions: points, faces: [], lines: [points.map((_, i) => i)] };
  } else if (type === "lattice_sop") {
    const offsets = json("offsets") as Vec3[];
    if (offsets.length !== 8) throw new Error("晶格需要八个角点位移");
    const box = bounds(data),
      size = box.getSize(new THREE.Vector3());
    data.positions = data.positions.map((point) => {
      const t = point.map(
          (x, i) =>
            (x - box.min.getComponent(i)) /
            Math.max(1e-9, size.getComponent(i)),
        ),
        delta = new THREE.Vector3();
      for (let corner = 0; corner < 8; corner++) {
        const weight = t.reduce(
          (w, x, axis) => w * ((corner >> axis) & 1 ? x : 1 - x),
          1,
        );
        delta.addScaledVector(v(offsets[corner]), weight);
      }
      return xyz(v(point).add(delta));
    });
  } else if (type === "limit_sop") {
    const low = n("min", -1),
      high = n("max", 1);
    if (low >= high) throw new Error("限制范围必须满足 min < max");
    data.positions = data.positions.map(
      (point) =>
        point.map((x) =>
          s("mode") === "wrap"
            ? low + ((((x - low) % (high - low)) + (high - low)) % (high - low))
            : clamp(x, low, high),
        ) as Vec3,
    );
  } else if (type === "line_thick_sop") {
    const points = curvePoints(data);
    if (points.length < 2) throw new Error("加粗路径至少需要两点");
    data = bufferMesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points.map(v)),
        Math.min(512, points.length * 3),
        n("radius", 0.06),
        integer("segments", 3, 32, 8),
        false,
      ),
    );
  } else if (type === "lod_sop" || type === "polyreduce_sop") {
    const size = bounds(data).getSize(new THREE.Vector3()).length(),
      ratio = clamp(n("ratio", 0.5), 0.01, 1),
      tolerance =
        size / Math.max(2, Math.cbrt(data.positions.length) * ratio * 3);
    data = weldMesh(data, tolerance);
  } else if (type === "point_sop") {
    const group = s("group"),
      selected = new Set(
        group
          ? (data.groups?.points?.[group] ?? [])
          : data.positions.map((_, i) => i),
      );
    if (group && !data.groups?.points?.[group])
      throw new Error(`点组 ${group} 不存在`);
    data.positions = data.positions.map((point, i) =>
      selected.has(i)
        ? xyz(v(point).multiplyScalar(n("scale", 1)).add(v(vec())))
        : point,
    );
    if (p.set_color) {
      const color = new THREE.Color(s("color", "#f59e75"));
      (data.pointAttributes ??= {}).Cd = data.positions.map((_, i) =>
        selected.has(i)
          ? [color.r, color.g, color.b]
          : (data.pointAttributes?.Cd?.[i] ?? [1, 1, 1]),
      );
    }
  } else if (type === "primitive_sop") {
    const group = s("group"),
      selected = group
        ? new Set(data.groups?.primitives?.[group] ?? [])
        : undefined;
    if (group && !data.groups?.primitives?.[group])
      throw new Error(`面组 ${group} 不存在`);
    data = flatMesh(data);
    for (const [index, face] of data.faces.entries())
      if (!selected || selected.has(index)) {
        const mid = v(center(data, face)),
          normal = faceNormal(data, face);
        for (const i of face)
          data.positions[i] = xyz(
            v(data.positions[i])
              .sub(mid)
              .multiplyScalar(n("scale", 0.85))
              .add(mid)
              .addScaledVector(normal, n("extrude", 0.1)),
          );
      }
  } else if (type === "profile_sop") {
    const normal = new THREE.Vector3();
    normal.setComponent(["x", "y", "z"].indexOf(s("axis", "y")), 1);
    data = section(data, normal, n("offset"));
  } else if (type === "project_sop") {
    const axis = s("plane", "xy") === "xy" ? 2 : s("plane") === "xz" ? 1 : 0;
    data.positions = data.positions.map((point) => {
      const result = [...point] as Vec3;
      result[axis] = n("offset");
      return result;
    });
  } else if (
    type === "polyloft_sop" ||
    type === "rails_sop" ||
    type === "skin_sop"
  ) {
    let a = curvePoints(data),
      b = curvePoints(mesh("in2"));
    if (type !== "skin_sop") {
      const count = integer("count", 2, 256, 32);
      a = resampleCurve(a, count, type === "polyloft_sop").positions;
      b = resampleCurve(b, count, type === "polyloft_sop").positions;
    }
    data = loft(
      a,
      b,
      type === "polyloft_sop" ? integer("layers", 1, 128, 12) : 1,
      type !== "rails_sop",
    );
    if (type === "skin_sop" && p.cap) data = capMesh(data);
  } else if (type === "polystitch_sop" || type === "stitch_sop") {
    const other = mesh("in2"),
      tolerance = n("tolerance", 0.05);
    if (type === "stitch_sop") {
      if (data.positions.length * other.positions.length > 1000000)
        throw new Error("缝合点对超过一百万，请降低精度");
      for (let i = 0; i < data.positions.length; i++)
        for (let j = 0; j < other.positions.length; j++)
          if (
            v(data.positions[i]).distanceTo(v(other.positions[j])) < tolerance
          ) {
            const mid = xyz(
              v(data.positions[i]).lerp(v(other.positions[j]), 0.5),
            );
            data.positions[i] = mid;
            other.positions[j] = mid;
          }
    }
    data = weldMesh(mergeMeshes(data, other), tolerance);
  } else if (type === "ray_sop" || type === "creep_sop") {
    const target = triangulate(mesh("in2"));
    if (data.positions.length * target.faces.length > 3000000)
      throw new Error("贴附超过三百万点面对检查预算，请降低精度");
    const direction = v(vec("d")).normalize(),
      ray = new THREE.Ray(),
      best = new THREE.Vector3(),
      hit = new THREE.Vector3();
    if (type === "ray_sop" && !direction.lengthSq())
      throw new Error("射线方向不能为零");
    data.positions = data.positions.map((point) => {
      let distance = Infinity;
      const origin = v(point);
      for (const face of target.faces) {
        const triangle = new THREE.Triangle(
          ...(face.map((i) => v(target.positions[i])) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
          ]),
        );
        let found: THREE.Vector3 | null;
        if (type === "ray_sop") {
          ray.set(origin, direction);
          found = ray.intersectTriangle(
            triangle.a,
            triangle.b,
            triangle.c,
            false,
            hit,
          );
        } else found = triangle.closestPointToPoint(origin, hit);
        if (found && found.distanceToSquared(origin) < distance) {
          distance = found.distanceToSquared(origin);
          best
            .copy(found)
            .addScaledVector(
              triangle.getNormal(new THREE.Vector3()),
              n("offset"),
            );
        }
      }
      return distance < Infinity ? xyz(best) : point;
    });
  } else if (type === "revolve_sop") {
    const points = curvePoints(data),
      segments = integer("segments", 3, 256, 32),
      positions: Vec3[] = [],
      faces: number[][] = [];
    for (let row = 0; row <= segments; row++) {
      const angle =
        (row / segments) * THREE.MathUtils.degToRad(n("angle", 360));
      for (const point of points)
        positions.push([
          point[0] * Math.cos(angle),
          point[1],
          point[0] * Math.sin(angle),
        ]);
    }
    for (let row = 0; row < segments; row++)
      for (let i = 0; i < points.length - 1; i++) {
        const a = row * points.length + i;
        faces.push([a, a + 1, a + points.length + 1, a + points.length]);
      }
    data = weldMesh({ positions, faces });
  } else if (type === "script_sop") {
    const operations = json("operations") as {
      op: string;
      value: number[] | number;
    }[];
    if (!Array.isArray(operations) || operations.length > 32)
      throw new Error("脚本应为最多 32 项的操作列表");
    for (const operation of operations) {
      if (operation.op === "subdivide")
        data = subdivide(data, clamp(Number(operation.value), 0, 3));
      else {
        if (!Array.isArray(operation.value) || operation.value.length !== 3)
          throw new Error("变换需要三分量 value");
        const value = v(operation.value);
        if (operation.op === "translate")
          data.positions = data.positions.map((point) =>
            xyz(v(point).add(value)),
          );
        else if (operation.op === "scale")
          data.positions = data.positions.map((point) =>
            xyz(v(point).multiply(value)),
          );
        else if (operation.op === "rotate") {
          const euler = new THREE.Euler(
            ...(operation.value.map(THREE.MathUtils.degToRad) as Vec3),
          );
          data.positions = data.positions.map((point) =>
            xyz(v(point).applyEuler(euler)),
          );
        } else throw new Error(`不支持的声明式操作 ${operation.op}`);
      }
    }
  } else if (type === "sort_sop") {
    const ids = data.positions.map((_, i) => i),
      axis = s("axis", "x");
    ids.sort((a, b) => {
      const key = (i: number) =>
        axis === "reverse"
          ? -i
          : axis === "distance"
            ? v(data.positions[i]).length()
            : data.positions[i][["x", "y", "z"].indexOf(axis)];
      return (key(a) - key(b)) * (p.descending ? -1 : 1);
    });
    const mapping = new Map(ids.map((id, index) => [id, index]));
    data.positions = ids.map((i) => data.positions[i]);
    data.faces = data.faces.map((face) => face.map((i) => mapping.get(i)!));
    data.lines = data.lines?.map((line) => line.map((i) => mapping.get(i)!));
    for (const key of Object.keys(data.pointAttributes ?? {}))
      data.pointAttributes![key] = ids.map(
        (i) => data.pointAttributes![key][i],
      );
    for (const [key, items] of Object.entries(data.groups?.points ?? {}))
      data.groups!.points![key] = items.map((i) => mapping.get(i)!);
  } else if (type === "sprinkle_sop") {
    const triangles = triangulate(data),
      areas = triangles.faces.map((face) => {
        const [a, b, c] = face.map((i) => v(triangles.positions[i]));
        return new THREE.Triangle(a, b, c).getArea();
      }),
      total = areas.reduce((a, b) => a + b, 0);
    if (!total) throw new Error("撒点需要非零面积网格");
    let sum = 0;
    const cumulative = areas.map((area) => (sum += area)),
      rng = random(n("seed", 1)),
      positions: Vec3[] = [];
    for (let i = 0; i < integer("count", 1, 20000, 500); i++) {
      const value = rng() * total;
      let lo = 0,
        hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < value) lo = mid + 1;
        else hi = mid;
      }
      const [a, b, c] = triangles.faces[lo].map((j) =>
          v(triangles.positions[j]),
        ),
        u = Math.sqrt(rng()),
        w = rng();
      positions.push(
        xyz(
          a
            .multiplyScalar(1 - u)
            .addScaledVector(b, u * (1 - w))
            .addScaledVector(c, u * w),
        ),
      );
    }
    data = { positions, faces: [] };
  } else if (type === "sprite_sop") {
    const out: MeshData = {
        positions: [],
        faces: [],
        pointAttributes: { uv: [] },
      },
      size = n("size", 0.06) / 2;
    if (data.positions.length > 60000) throw new Error("精灵展开超过顶点预算");
    for (const point of data.positions) {
      const base = out.positions.length;
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        out.positions.push([
          point[0] + x * size,
          point[1] + y * size,
          point[2],
        ]);
        out.pointAttributes!.uv.push([(x + 1) / 2, (y + 1) / 2]);
      }
      out.faces.push([base, base + 1, base + 2, base + 3]);
    }
    data = out;
  } else if (type === "surfsect_sop")
    data = intersectSurfaces(data, mesh("in2"));
  else if (type === "sweep_sop") {
    const path = curvePoints(data),
      profile = curvePoints(mesh("in2"));
    if (path.length < 2 || profile.length < 2)
      throw new Error("扫描需要路径与截面各至少两点");
    const curve = new THREE.CatmullRomCurve3(path.map(v), Boolean(p.closed)),
      frames = curve.computeFrenetFrames(path.length - 1, Boolean(p.closed)),
      out: MeshData = { positions: [], faces: [] };
    for (let row = 0; row < path.length; row++)
      for (const point of profile)
        out.positions.push(
          xyz(
            v(path[row])
              .addScaledVector(frames.normals[row], point[0] * n("scale", 0.2))
              .addScaledVector(
                frames.binormals[row],
                point[1] * n("scale", 0.2),
              ),
          ),
        );
    for (let row = 0; row < path.length - 1; row++)
      for (let i = 0; i < profile.length; i++) {
        const j = (i + 1) % profile.length,
          a = row * profile.length;
        out.faces.push([
          a + i,
          a + j,
          a + profile.length + j,
          a + profile.length + i,
        ]);
      }
    data = out;
  } else if (type === "texture_sop") {
    const box = bounds(data),
      size = box.getSize(new THREE.Vector3()),
      mid = box.getCenter(new THREE.Vector3());
    (data.pointAttributes ??= {}).uv = data.positions.map((point) => {
      const relative = v(point).sub(mid),
        u =
          s("projection") === "planar"
            ? (point[0] - box.min.x) / Math.max(1e-9, size.x)
            : Math.atan2(relative.z, relative.x) / (Math.PI * 2) + 0.5,
        vv =
          s("projection") === "spherical"
            ? Math.acos(
                clamp(relative.y / Math.max(1e-9, relative.length()), -1, 1),
              ) / Math.PI
            : (point[1] - box.min.y) / Math.max(1e-9, size.y);
      return [u * n("repeat_u", 1), vv * n("repeat_v", 1)];
    });
  } else if (type === "vertex_sop") {
    data = flatMesh(data);
    const index = integer("index", 0, 250000, 0);
    if (index >= data.positions.length) throw new Error("面角索引超出范围");
    data.positions[index] = xyz(v(data.positions[index]).add(v(vec("d", 0.1))));
  } else if (type === "tristrip_sop") {
    data = triangulate(data);
    const remaining = new Set(data.faces.map((_, i) => i)),
      strips: number[][] = [],
      stripFaces: number[][] = [];
    while (remaining.size) {
      let current = remaining.values().next().value!;
      remaining.delete(current);
      const strip = [...data.faces[current]],
        faceIds = [current];
      let more = true;
      while (more) {
        more = false;
        const a = strip.at(-2)!,
          b = strip.at(-1)!;
        for (const index of remaining) {
          const face = data.faces[index];
          if (face.includes(a) && face.includes(b)) {
            strip.push(face.find((i) => i !== a && i !== b)!);
            remaining.delete(index);
            current = index;
            faceIds.push(index);
            more = true;
            break;
          }
        }
      }
      strips.push(strip);
      stripFaces.push(faceIds);
    }
    data.triangleStrips = strips;
    const stripIds = data.faces.map(() => [-1]);
    stripFaces.forEach((faces, id) =>
      faces.forEach((index) => (stripIds[index] = [id])),
    );
    data.primitiveAttributes = {
      ...(data.primitiveAttributes ?? {}),
      triangle_strip: stripIds,
    };
    data.lines = undefined;
    data.groups = {
      ...(data.groups ?? {}),
      primitives: {
        ...(data.groups?.primitives ?? {}),
        ...Object.fromEntries(
          stripFaces.map((faces, i) => [`strip_${i}`, faces]),
        ),
      },
    };
  } else if (type === "trail_sop") {
    const saved = (state.get(node.id) as
      { time: number; frames: Vec3[][] } | undefined) ?? { time, frames: [] };
    if (time < saved.time) saved.frames = [];
    if (time !== saved.time || !saved.frames.length) {
      saved.frames.push(data.positions.map((point) => [...point] as Vec3));
      saved.frames = saved.frames.slice(-integer("frames", 2, 120, 24));
      while (
        saved.frames.length > 1 &&
        saved.frames.reduce((sum, frame) => sum + frame.length, 0) > 250000
      )
        saved.frames.shift();
    }
    saved.time = time;
    state.set(node.id, saved);
    const out: MeshData = { positions: [], faces: [], lines: [] };
    for (let i = 0; i < data.positions.length; i++) {
      const line: number[] = [];
      for (const frame of saved.frames)
        if (frame[i]) {
          line.push(out.positions.length);
          out.positions.push(frame[i]);
        }
      if (line.length > 1) out.lines!.push(line);
    }
    data = out;
  } else if (type === "particle_sop" || type === "spring_sop") {
    type Memory = {
      time: number;
      start: number;
      positions: Vec3[];
      velocities: Vec3[];
    };
    let saved = state.get(node.id) as Memory | undefined;
    const reset =
      !saved ||
      time < saved.time ||
      saved.positions.length !== data.positions.length ||
      (type === "particle_sop" && time - saved.start > n("lifetime", 5));
    if (reset)
      saved = {
        time,
        start: time,
        positions: data.positions.map((point) => [...point] as Vec3),
        velocities: data.positions.map((point, i) =>
          type === "particle_sop"
            ? ((data.pointAttributes?.v?.[i] as Vec3 | undefined) ??
              xyz(v(point).normalize().multiplyScalar(n("speed", 0.3))))
            : [0, 0, 0],
        ),
      };
    const dt = Math.min(0.1, Math.max(0, time - saved!.time)),
      steps = Math.max(1, Math.ceil(dt / (1 / 120))),
      step = dt / steps;
    for (let j = 0; j < steps; j++)
      for (let i = 0; i < data.positions.length; i++) {
        const position = v(saved!.positions[i]),
          velocity = v(saved!.velocities[i]);
        if (type === "spring_sop")
          velocity
            .addScaledVector(
              v(data.positions[i]).sub(position),
              n("stiffness", 20) * step,
            )
            .multiplyScalar(Math.exp(-n("damping", 6) * step));
        else {
          velocity.y += n("gravity", -0.5) * step;
          const force = data.pointAttributes?.force?.[i];
          if (force) velocity.addScaledVector(v(force), step);
          velocity.multiplyScalar(Math.exp(-n("drag", 0.2) * step));
        }
        position.addScaledVector(velocity, step);
        saved!.positions[i] = xyz(position);
        saved!.velocities[i] = xyz(velocity);
      }
    saved!.time = time;
    state.set(node.id, saved!);
    data.positions = saved!.positions.map((point) => [...point] as Vec3);
    if (type === "particle_sop") {
      data.faces = [];
      data.lines = [];
    }
    (data.pointAttributes ??= {}).v = saved!.velocities;
  } else throw new Error(`几何节点 ${type} 没有执行器`);
  if (
    ![
      "attribute_create_sop",
      "attribute_sop",
      "facet_sop",
      "texture_sop",
      "group_sop",
      "sort_sop",
      "tristrip_sop",
    ].includes(type) &&
    data.pointAttributes?.N
  )
    delete data.pointAttributes.N;
  return result(meshSpec(data));
}
