import { resolveSceneModel } from "./modelRegistry";
import * as THREE from "three";
import {
  buildGeometryObject,
  type GeometrySpec,
  type MeshData,
  type Vec3,
} from "./geometry";
import { disposeSceneObject } from "./sceneRuntime";
export const cloneMesh = (mesh: MeshData): MeshData =>
  JSON.parse(JSON.stringify(mesh));
export const v = (p: readonly number[]) =>
  new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
export const xyz = (p: THREE.Vector3): Vec3 => [p.x, p.y, p.z];
export const center = (mesh: MeshData, face: number[]) =>
  xyz(
    face
      .reduce((sum, i) => sum.add(v(mesh.positions[i])), new THREE.Vector3())
      .divideScalar(Math.max(1, face.length)),
  );
export function validateMesh(mesh: MeshData): void {
  if (mesh.positions.length > 250000 || mesh.faces.length > 500000)
    throw new Error("网格超出 25 万点 / 50 万面上限");
  if (
    mesh.positions.some(
      (p) => p.length !== 3 || p.some((x) => !Number.isFinite(x)),
    )
  )
    throw new Error("顶点坐标必须为三个有限数字");
  for (const face of [...mesh.faces, ...(mesh.lines ?? [])])
    if (
      face.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= mesh.positions.length,
      )
    )
      throw new Error("网格索引无效");
}
export function meshSpec(mesh: MeshData): GeometrySpec {
  validateMesh(mesh);
  return { shape: "mesh", detail: 1, mesh };
}
export function geometryMesh(spec: GeometrySpec): MeshData {
  if (spec.shape === "mesh" && spec.mesh) {
    const data = cloneMesh(spec.mesh);
    const matrix = new THREE.Matrix4().compose(
      v(spec.position ?? [0, 0, 0]),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          ...((spec.rotation ?? [0, 0, 0]).map(
            THREE.MathUtils.degToRad,
          ) as Vec3),
        ),
      ),
      v(spec.scale ?? [1, 1, 1]),
    );
    data.positions = data.positions.map((point) =>
      xyz(v(point).applyMatrix4(matrix)),
    );
    if (data.pointAttributes?.N) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      data.pointAttributes.N = data.pointAttributes.N.map((normal) =>
        xyz(v(normal).applyMatrix3(normalMatrix).normalize()),
      );
    }
    return data;
  }
  const result: MeshData = {
    positions: [],
    faces: [],
    lines: [],
    pointAttributes: {},
  };
  const ensureModels = (item: GeometrySpec) => {
    if (item.shape === "model" && (!item.url || !resolveSceneModel(item.url)))
      throw new Error("模型尚未完成加载，请等待预览加载后再进行网格处理");
    for (const child of item.children ?? []) ensureModels(child);
  };
  ensureModels(spec);
  const object = buildGeometryObject(spec, "#ffffff", false, resolveSceneModel);
  try {
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (!(
        child instanceof THREE.Mesh ||
        child instanceof THREE.Line ||
        child instanceof THREE.Points
      ))
        return;
      const geom = child.geometry,
        position = geom.getAttribute("position");
      if (!position) return;
      const offset = result.positions.length;
      for (let i = 0; i < position.count; i++)
        result.positions.push(
          xyz(
            new THREE.Vector3()
              .fromBufferAttribute(position, i)
              .applyMatrix4(child.matrixWorld),
          ),
        );
      const indices = geom.index
        ? (Array.from(geom.index.array) as number[])
        : Array.from({ length: position.count }, (_, i) => i);
      if (child instanceof THREE.Mesh)
        for (let i = 0; i < indices.length; i += 3)
          result.faces.push(indices.slice(i, i + 3).map((n) => n + offset));
      else if (child instanceof THREE.LineSegments)
        for (let i = 0; i < indices.length; i += 2)
          result.lines!.push(indices.slice(i, i + 2).map((n) => n + offset));
      else if (child instanceof THREE.Line)
        result.lines!.push(indices.map((n) => n + offset));
      for (const name of ["uv", "color", "normal"]) {
        const attribute = geom.getAttribute(name);
        if (!attribute) continue;
        const key = name === "color" ? "Cd" : name === "normal" ? "N" : name;
        const arr =
          result.pointAttributes![key] ??
          (result.pointAttributes![key] = Array.from({ length: offset }, () =>
            Array(attribute.itemSize).fill(0),
          ));
        for (let i = 0; i < attribute.count; i++)
          arr.push(
            name === "normal"
              ? xyz(
                  new THREE.Vector3()
                    .fromBufferAttribute(attribute, i)
                    .applyMatrix3(
                      new THREE.Matrix3().getNormalMatrix(child.matrixWorld),
                    )
                    .normalize(),
                )
              : Array.from({ length: attribute.itemSize }, (_, j) =>
                  attribute.getComponent(i, j),
                ),
          );
      }
    });
  } finally {
    disposeSceneObject(object);
  }
  for (const [key, attr] of Object.entries(result.pointAttributes!))
    if (attr.length !== result.positions.length)
      delete result.pointAttributes![key];
  return result;
}
export function weldMesh(source: MeshData, tolerance = 1e-6): MeshData {
  const map = new Map<string, number>(),
    indices: number[] = [],
    mesh: MeshData = {
      positions: [],
      faces: [],
      lines: [],
      pointAttributes: {},
    };
  source.positions.forEach((p, i) => {
    const key = p
      .map((x) => Math.round(x / Math.max(1e-9, tolerance)))
      .join(",");
    let id = map.get(key);
    if (id === undefined) {
      id = mesh.positions.length;
      map.set(key, id);
      mesh.positions.push([...p]);
      for (const [name, values] of Object.entries(source.pointAttributes ?? {}))
        (mesh.pointAttributes![name] ??= []).push([...(values[i] ?? [0])]);
    }
    indices.push(id);
  });
  mesh.faces = source.faces
    .map((face) => face.map((i) => indices[i]))
    .filter((face) => new Set(face).size >= 3);
  mesh.lines = source.lines?.map((line) => line.map((i) => indices[i]));
  return mesh;
}
export function triangulate(mesh: MeshData): MeshData {
  const out = cloneMesh(mesh);
  out.faces = mesh.faces.flatMap((face) =>
    Array.from({ length: Math.max(0, face.length - 2) }, (_, i) => [
      face[0],
      face[i + 1],
      face[i + 2],
    ]),
  );
  delete out.primitiveAttributes;
  delete out.groups;
  return out;
}
export function subdivide(source: MeshData, iterations: number): MeshData {
  let mesh = triangulate(source);
  for (let repeat = 0; repeat < iterations; repeat++) {
    if (mesh.faces.length > 80000)
      throw new Error("细分结果超过实时网格预算，请降低迭代次数");
    const edgeMap = new Map<string, number>(),
      positions = mesh.positions.map((p) => [...p] as Vec3),
      attributes: Record<string, number[][]> = {};
    for (const [k, a] of Object.entries(mesh.pointAttributes ?? {}))
      attributes[k] = a.map((p) => [...p]);
    const midpoint = (a: number, b: number) => {
      const key = [Math.min(a, b), Math.max(a, b)].join(":");
      let id = edgeMap.get(key);
      if (id === undefined) {
        id = positions.length;
        edgeMap.set(key, id);
        positions.push(
          xyz(v(positions[a]).add(v(positions[b])).multiplyScalar(0.5)),
        );
        for (const [k, values] of Object.entries(attributes))
          values.push(values[a].map((n, j) => (n + values[b][j]) / 2));
      }
      return id;
    };
    const faces = mesh.faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      return [
        [a, ab, ca],
        [ab, b, bc],
        [ca, bc, c],
        [ab, bc, ca],
      ];
    });
    mesh = { positions, faces, pointAttributes: attributes };
  }
  return mesh;
}
export function boundaryLoops(mesh: MeshData): number[][] {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const face of mesh.faces)
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length],
        key = [Math.min(a, b), Math.max(a, b)].join(":");
      const old = edges.get(key);
      if (old) old.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  const todo = [...edges.values()].filter((e) => e.count === 1),
    loops: number[][] = [];
  while (todo.length) {
    const e = todo.pop()!,
      loop = [e.a, e.b];
    let guard = 0;
    while (loop.at(-1) !== loop[0] && guard++ < mesh.positions.length) {
      const next = todo.findIndex(
        (e) => e.a === loop.at(-1) || e.b === loop.at(-1),
      );
      if (next < 0) break;
      const edge = todo.splice(next, 1)[0];
      loop.push(edge.a === loop.at(-1) ? edge.b : edge.a);
    }
    if (loop[0] === loop.at(-1)) loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
export function capMesh(source: MeshData): MeshData {
  const mesh = weldMesh(source);
  for (const loop of boundaryLoops(mesh)) {
    const mid = mesh.positions.length;
    mesh.positions.push(center(mesh, loop));
    for (let i = 0; i < loop.length; i++)
      mesh.faces.push([loop[(i + 1) % loop.length], loop[i], mid]);
  }
  delete mesh.pointAttributes;
  return mesh;
}
export function clipMesh(
  mesh: MeshData,
  normal: Vec3,
  offset: number,
): MeshData {
  const positions: Vec3[] = [],
    faces: number[][] = [],
    n = v(normal).normalize();
  if (!n.lengthSq()) throw new Error("裁剪平面法线不能为零");
  for (const face of mesh.faces) {
    const polygon = face.map((i) => v(mesh.positions[i])),
      clipped: THREE.Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        da = a.dot(n) - offset,
        db = b.dot(n) - offset;
      if (da >= -1e-8) clipped.push(a);
      if (da < 0 !== db < 0) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    if (clipped.length >= 3) {
      const start = positions.length;
      positions.push(...clipped.map(xyz));
      faces.push(clipped.map((_, i) => start + i));
    }
  }
  return weldMesh({ positions, faces });
}
export function curvePoints(mesh: MeshData): Vec3[] {
  const ids = mesh.lines?.[0] ?? mesh.faces[0];
  return ids ? ids.map((i) => mesh.positions[i]) : mesh.positions;
}
export function resampleCurve(
  points: Vec3[],
  count: number,
  closed = false,
): MeshData {
  if (points.length < 2) throw new Error("曲线至少需要两个控制点");
  const path = closed ? [...points, points[0]] : points,
    dist = [0];
  for (let i = 1; i < path.length; i++)
    dist.push(dist.at(-1)! + v(path[i]).distanceTo(v(path[i - 1])));
  const total = dist.at(-1)!;
  const positions = Array.from({ length: count }, (_, i) => {
    const d = (total * i) / Math.max(1, closed ? count : count - 1);
    let j = 1;
    while (j < dist.length - 1 && dist[j] < d) j++;
    return xyz(
      v(path[j - 1]).lerp(
        v(path[j]),
        (d - dist[j - 1]) / Math.max(1e-12, dist[j] - dist[j - 1]),
      ),
    );
  });
  return {
    positions,
    faces: [],
    lines: [[...positions.map((_, i) => i), ...(closed ? [0] : [])]],
  };
}
export function mergeMeshes(...inputs: MeshData[]): MeshData {
  const mesh: MeshData = { positions: [], faces: [], lines: [] };
  for (const item of inputs) {
    const offset = mesh.positions.length;
    mesh.positions.push(...item.positions);
    mesh.faces.push(...item.faces.map((face) => face.map((i) => i + offset)));
    mesh.lines!.push(
      ...(item.lines ?? []).map((line) => line.map((i) => i + offset)),
    );
  }
  return mesh;
}
export function smoothMesh(
  source: MeshData,
  iterations: number,
  amount: number,
): MeshData {
  const mesh = weldMesh(source);
  const neighbours = mesh.positions.map(() => new Set<number>());
  for (const face of mesh.faces)
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length];
      neighbours[a].add(b);
      neighbours[b].add(a);
    }
  for (let r = 0; r < iterations; r++) {
    const old = mesh.positions;
    mesh.positions = old.map((point, i) => {
      if (!neighbours[i].size) return point;
      const avg = [...neighbours[i]]
        .reduce((sum, j) => sum.add(v(old[j])), new THREE.Vector3())
        .divideScalar(neighbours[i].size);
      return xyz(v(point).lerp(avg, amount));
    });
  }
  delete mesh.pointAttributes;
  return mesh;
}
