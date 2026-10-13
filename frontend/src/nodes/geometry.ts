import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import { buildMaterial, type MaterialSpec } from "./materialRuntime";

export type Vec3 = [number, number, number];
export type MeshData = {
  positions: Vec3[];
  faces: number[][];
  lines?: number[][];
  triangleStrips?: number[][];
  pointAttributes?: Record<string, number[][]>;
  primitiveAttributes?: Record<string, number[][]>;
  groups?: {
    points?: Record<string, number[]>;
    primitives?: Record<string, number[]>;
  };
};
export type GeometrySpec = {
  mesh?: MeshData;
  material?: MaterialSpec;
  shape: string;
  detail: number;
  url?: string;
  children?: GeometrySpec[];
  position?: Vec3;
  /** Euler angles in degrees, applied in XYZ order. */
  rotation?: Vec3;
  scale?: Vec3;
  radius?: number;
  radius_top?: number;
  tube?: number;
  width?: number;
  height?: number;
  depth?: number;
  start?: Vec3;
  end?: Vec3;
  inner?: number;
  points?: number[][];
  segments?: number;
  closed?: boolean;
  angle?: number;
  bevel?: number;
  turns?: number;
  p?: number;
  q?: number;
  mode?: string;
  threshold?: number;
  wireframe?: boolean;
  modifier?: {
    kind: string;
    amount: number;
    amplitude: number;
    frequency: number;
    phase: number;
    seed: number;
  };
};

export function isGeometrySpec(value: unknown): value is GeometrySpec {
  return Boolean(
    value &&
    typeof value === "object" &&
    "shape" in value &&
    typeof value.shape === "string" &&
    "detail" in value &&
    typeof value.detail === "number",
  );
}

/** Count expanded instances before any recursive serialization or GPU allocation.
 * Memoization makes repeated descriptors cheap while still counting every visible copy.
 */
export function validateGeometrySpec(spec: GeometrySpec): void {
  const cache = new Map<GeometrySpec, { count: number; height: number }>(),
    visiting = new Set<GeometrySpec>();
  const finiteNumbers = (value: unknown): void => {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("几何描述包含非有限数值");
    if (Array.isArray(value)) value.forEach(finiteNumbers);
    else if (value && typeof value === "object")
      Object.values(value).forEach(finiteNumbers);
  };
  const visit = (item: GeometrySpec): { count: number; height: number } => {
    const old = cache.get(item);
    if (old) return old;
    if (visiting.has(item)) throw new Error("几何描述不能循环引用");
    visiting.add(item);
    for (const [key, value] of Object.entries(item))
      if (key !== "children") finiteNumbers(value);
    let count = 1,
      height = 1;
    for (const child of item.children ?? []) {
      const cost = visit(child);
      count += cost.count;
      height = Math.max(height, 1 + cost.height);
      if (count > 4096) throw new Error("几何副本超过 4096 个，请减少阵列嵌套");
      if (height > 64)
        throw new Error("几何层级超过 64 层，请简化变换与合并网络");
    }
    visiting.delete(item);
    const cost = { count, height };
    cache.set(item, cost);
    return cost;
  };
  visit(spec);
}
function validateVertices(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  if (position)
    for (const value of position.array)
      if (!Number.isFinite(value))
        throw new Error("几何顶点超出有限数值范围，请减小变形或缩放参数");
}

const bounded = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) => Math.min(max, Math.max(min, Number.isFinite(value) ? value! : fallback));

/**
 * Owns all primitive mesh resources. A model returned by resolveModel is borrowed:
 * its wrapper carries tdBorrowedResources so callers can avoid disposing cached assets.
 * The outer group reserves its transform for the Render TOP's animation.
 */
export function buildGeometryObject(
  spec: GeometrySpec,
  color: string,
  wireframe: boolean,
  resolveModel?: (url: string) => THREE.Object3D | undefined,
): THREE.Object3D {
  validateGeometrySpec(spec);
  const root = new THREE.Group();
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  let objectCount = 0;
  const materialFor = (spec?: MaterialSpec) => {
    const material = spec
      ? buildMaterial(spec)
      : new THREE.MeshStandardMaterial({
          color,
          wireframe,
          metalness: 0.3,
          roughness: 0.3,
          side: THREE.DoubleSide,
        });
    ownedMaterials.push(material);
    return material;
  };
  const build = (
    item: GeometrySpec,
    depth: number,
    inheritedMaterial?: MaterialSpec,
  ): THREE.Object3D => {
    const effectiveMaterial = item.material ?? inheritedMaterial;
    if (++objectCount > 4096)
      throw new Error("几何副本超过 4096 个，请减少阵列嵌套");
    if (depth > 64) throw new Error("几何层级超过 64 层，请简化变换与合并网络");
    const holder = new THREE.Group();
    if (item.position) holder.position.fromArray(item.position);
    if (item.rotation)
      holder.rotation.set(
        ...(item.rotation.map(THREE.MathUtils.degToRad) as Vec3),
      );
    if (item.scale) holder.scale.fromArray(item.scale);
    if (item.shape === "group") {
      for (const child of item.children ?? [])
        holder.add(build(child, depth + 1, effectiveMaterial));
      return holder;
    }
    if (item.shape === "model") {
      const instance = item.url ? resolveModel?.(item.url) : undefined;
      if (instance) {
        const borrowed = cloneSkeleton(instance);
        if (effectiveMaterial) {
          borrowed.traverse((child) => {
            delete child.userData.tdBorrowedResources;
            if (
              child instanceof THREE.Mesh ||
              child instanceof THREE.Line ||
              child instanceof THREE.Points
            ) {
              child.geometry = child.geometry.clone();
              ownedGeometries.push(child.geometry);
              child.material = materialFor(effectiveMaterial);
            }
          });
        } else
          borrowed.userData = {
            ...borrowed.userData,
            tdBorrowedResources: true,
          };
        holder.add(borrowed);
      }
      return holder;
    }
    if (["deform", "wireframe", "bounds"].includes(item.shape)) {
      // Flatten in local space, then own all converted resources independently.
      // Cached model textures/materials are never copied into an owned subtree.
      const geometryStart = ownedGeometries.length,
        materialStart = ownedMaterials.length;
      const source = new THREE.Group();
      for (const child of item.children ?? [])
        source.add(build(child, depth + 1, effectiveMaterial));
      source.updateMatrixWorld(true);
      const converted: { geometry: THREE.BufferGeometry; lines: boolean }[] =
        [];
      if (item.shape === "bounds") {
        const bounds = new THREE.Box3().setFromObject(source);
        if (!bounds.isEmpty()) {
          const size = bounds.getSize(new THREE.Vector3()),
            center = bounds.getCenter(new THREE.Vector3());
          const box = new THREE.BoxGeometry(size.x, size.y, size.z);
          box.translate(center.x, center.y, center.z);
          if (item.wireframe) {
            converted.push({
              geometry: new THREE.EdgesGeometry(box),
              lines: true,
            });
            box.dispose();
          } else converted.push({ geometry: box, lines: false });
        }
      } else
        source.traverse((object) => {
          if (!(
            object instanceof THREE.Mesh || object instanceof THREE.LineSegments
          ))
            return;
          const geometry = object.geometry
            .clone()
            .applyMatrix4(object.matrixWorld);
          if (item.shape === "wireframe" && object instanceof THREE.Mesh) {
            converted.push({
              geometry:
                item.mode === "triangles"
                  ? new THREE.WireframeGeometry(geometry)
                  : new THREE.EdgesGeometry(
                      geometry,
                      bounded(item.threshold, 20, 0, 180),
                    ),
              lines: true,
            });
            geometry.dispose();
          } else {
            const modifier = item.modifier,
              position = geometry.getAttribute("position");
            if (modifier)
              for (let i = 0; i < position.count; i++) {
                const x = position.getX(i),
                  y = position.getY(i),
                  z = position.getZ(i);
                if (modifier.kind === "twist_sop") {
                  const angle = (y * modifier.amount * Math.PI) / 180,
                    c = Math.cos(angle),
                    s = Math.sin(angle);
                  position.setXYZ(i, x * c - z * s, y, x * s + z * c);
                } else if (modifier.kind === "taper_sop")
                  position.setXYZ(
                    i,
                    x * (1 + y * modifier.amount),
                    y,
                    z * (1 + y * modifier.amount),
                  );
                else if (modifier.kind === "wave_sop")
                  position.setY(
                    i,
                    y +
                      Math.sin(
                        x * modifier.frequency + modifier.phase * Math.PI * 2,
                      ) *
                        modifier.amplitude,
                  );
                else if (modifier.kind === "noise_sop") {
                  const f = modifier.frequency,
                    seed = modifier.seed;
                  position.setXYZ(
                    i,
                    x +
                      Math.sin(y * f + seed) *
                        Math.cos(z * f + seed * 0.3) *
                        modifier.amplitude,
                    y +
                      Math.sin(z * f + seed * 1.3) *
                        Math.cos(x * f) *
                        modifier.amplitude,
                    z +
                      Math.sin(x * f + seed * 0.7) *
                        Math.cos(y * f) *
                        modifier.amplitude,
                  );
                }
              }
            if (modifier) {
              position.needsUpdate = true;
              geometry.computeVertexNormals();
              geometry.computeBoundingBox();
              geometry.computeBoundingSphere();
            }
            converted.push({
              geometry,
              lines: object instanceof THREE.LineSegments,
            });
          }
        });
      // Only resources created while assembling this temporary source are owned.
      ownedGeometries
        .splice(geometryStart)
        .forEach((geometry) => geometry.dispose());
      ownedMaterials
        .splice(materialStart)
        .forEach((material) => material.dispose());
      ownedGeometries.push(...converted.map((entry) => entry.geometry));
      for (const entry of converted) {
        validateVertices(entry.geometry);
        if (entry.lines) {
          const material = new THREE.LineBasicMaterial({ color });
          ownedMaterials.push(material);
          holder.add(new THREE.LineSegments(entry.geometry, material));
        } else
          holder.add(
            new THREE.Mesh(entry.geometry, materialFor(effectiveMaterial)),
          );
      }
      return holder;
    }
    if (item.shape === "mesh") {
      if (!item.mesh) throw new Error("Mesh 缺少顶点数据");
      const data = item.mesh;
      if (data.positions.length > 250000 || data.faces.length > 500000)
        throw new Error("网格超出安全顶点或面数上限");
      const checkIndex = (index: number) => {
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= data.positions.length
        )
          throw new Error("网格索引超出顶点范围");
        return index;
      };
      const geometry = new THREE.BufferGeometry();
      ownedGeometries.push(geometry);
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(data.positions.flat(), 3),
      );
      for (const [name, values] of Object.entries(data.pointAttributes ?? {})) {
        if (values.length !== data.positions.length)
          throw new Error(`属性 ${name} 的点数不匹配`);
        const size = values[0]?.length ?? 1;
        if (
          size < 1 ||
          size > 4 ||
          values.some((value) => value.length !== size)
        )
          throw new Error(`属性 ${name} 分量数不一致`);
        geometry.setAttribute(
          name === "Cd" ? "color" : name === "N" ? "normal" : name,
          new THREE.Float32BufferAttribute(values.flat(), size),
        );
      }
      const triangles: number[] = [];
      for (const face of data.faces) {
        face.forEach(checkIndex);
        for (let i = 1; i < face.length - 1; i++)
          triangles.push(face[0], face[i], face[i + 1]);
      }
      if (triangles.length) {
        geometry.setIndex(triangles);
        if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
        const material = materialFor(effectiveMaterial);
        if (geometry.hasAttribute("color") && "vertexColors" in material)
          material.vertexColors = true;
        holder.add(new THREE.Mesh(geometry, material));
      } else if (!data.lines?.length) {
        const material = item.material
          ? buildMaterial(item.material)
          : new THREE.PointsMaterial({
              color,
              size: 0.04,
              sizeAttenuation: true,
            });
        ownedMaterials.push(material);
        holder.add(new THREE.Points(geometry, material));
      }
      if (data.lines?.length) {
        const points: number[] = [];
        for (const line of data.lines)
          for (let i = 1; i < line.length; i++)
            points.push(
              ...data.positions[checkIndex(line[i - 1])],
              ...data.positions[checkIndex(line[i])],
            );
        const lineGeometry = new THREE.BufferGeometry();
        ownedGeometries.push(lineGeometry);
        lineGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(points, 3),
        );
        const material = item.material
          ? buildMaterial(item.material)
          : new THREE.LineBasicMaterial({ color });
        ownedMaterials.push(material);
        holder.add(new THREE.LineSegments(lineGeometry, material));
      }
      validateVertices(geometry);
      return holder;
    }
    const detail = Math.round(bounded(item.detail, 32, 3, 128));
    const radius = bounded(item.radius, 1.2, 0.001, 100);
    const height = bounded(item.height, 2, 0.001, 100);
    let geometry: THREE.BufferGeometry;
    switch (item.shape) {
      case "box": {
        const segments = Math.round(bounded(item.detail, 1, 1, 32));
        geometry = new THREE.BoxGeometry(
          bounded(item.width, 1.6, 0.001, 100),
          bounded(item.height, 1.6, 0.001, 100),
          bounded(item.depth, 1.6, 0.001, 100),
          segments,
          segments,
          segments,
        );
        break;
      }
      case "sphere":
        geometry = new THREE.SphereGeometry(radius, detail, detail);
        break;
      case "torus":
        geometry = new THREE.TorusGeometry(
          bounded(item.radius, 1, 0.001, 100),
          bounded(item.tube, 0.36, 0.001, 100),
          Math.max(3, Math.floor(detail / 2)),
          detail * 3,
        );
        break;
      case "knot":
        geometry = new THREE.TorusKnotGeometry(0.85, 0.26, detail * 4, 16);
        break;
      case "tetrahedron":
      case "octahedron":
      case "icosahedron":
      case "dodecahedron": {
        const subdivision = Math.floor(bounded(item.detail, 0, 0, 4));
        const constructors = {
          tetrahedron: THREE.TetrahedronGeometry,
          octahedron: THREE.OctahedronGeometry,
          icosahedron: THREE.IcosahedronGeometry,
          dodecahedron: THREE.DodecahedronGeometry,
        };
        geometry = new constructors[item.shape](radius, subdivision);
        break;
      }
      case "capsule":
        geometry = new THREE.CapsuleGeometry(
          radius,
          height,
          Math.max(2, Math.floor(detail / 4)),
          detail,
        );
        break;
      case "ring": {
        const inner = bounded(item.inner, 0.5, 0.001, 100);
        geometry = new THREE.RingGeometry(
          Math.min(inner, radius),
          Math.max(inner, radius),
          detail,
        );
        break;
      }
      case "tube": {
        const points = (
          item.points ?? [
            [-1, -1, 0],
            [0, 1, 0],
            [1, -1, 0],
          ]
        ).map((point) => new THREE.Vector3(...(point as Vec3)));
        geometry = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points, Boolean(item.closed)),
          detail,
          bounded(item.tube, 0.12, 0.001, 10),
          Math.round(bounded(item.segments, 12, 3, 32)),
          Boolean(item.closed),
        );
        break;
      }
      case "helix": {
        const turns = bounded(item.turns, 3, 0.1, 20),
          points: THREE.Vector3[] = [];
        for (let i = 0; i <= detail * 4; i++) {
          const t = i / (detail * 4),
            angle = t * turns * Math.PI * 2;
          points.push(
            new THREE.Vector3(
              Math.cos(angle) * radius,
              (t - 0.5) * height,
              Math.sin(angle) * radius,
            ),
          );
        }
        geometry = new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          detail * 4,
          bounded(item.tube, 0.08, 0.001, 10),
          Math.round(bounded(item.segments, 12, 3, 32)),
          false,
        );
        break;
      }
      case "lathe":
        geometry = new THREE.LatheGeometry(
          (
            item.points ?? [
              [0, -1],
              [0.8, 0],
              [0, 1],
            ]
          ).map((point) => new THREE.Vector2(point[0], point[1])),
          detail,
          0,
          (bounded(item.angle, 360, 1, 360) * Math.PI) / 180,
        );
        break;
      case "extrude": {
        const points = item.points ?? [
          [-1, -0.7],
          [1, -0.7],
          [0, 1],
        ];
        if (points.length < 3) throw new Error("挤出轮廓至少需要 3 个点");
        const shape = new THREE.Shape(
          points.map((point) => new THREE.Vector2(point[0], point[1])),
        );
        shape.closePath();
        const thickness = bounded(item.depth, 0.4, 0.001, 100),
          bevel = bounded(item.bevel, 0.05, 0, 1);
        geometry = new THREE.ExtrudeGeometry(shape, {
          depth: thickness,
          steps: 1,
          bevelEnabled: bevel > 0,
          bevelSize: bevel,
          bevelThickness: bevel,
          bevelSegments: 3,
        });
        geometry.translate(0, 0, -thickness / 2);
        break;
      }
      case "torus_knot":
        geometry = new THREE.TorusKnotGeometry(
          radius,
          bounded(item.tube, 0.18, 0.001, 10),
          detail * 4,
          Math.round(bounded(item.segments, 12, 3, 32)),
          Math.round(bounded(item.p, 2, 1, 12)),
          Math.round(bounded(item.q, 3, 1, 12)),
        );
        break;
      case "cone":
        geometry = new THREE.ConeGeometry(radius, height, detail);
        break;
      case "cylinder":
        geometry = new THREE.CylinderGeometry(
          bounded(item.radius_top, 0.8, 0, 100),
          bounded(item.radius, 0.8, 0.001, 100),
          height,
          detail,
        );
        break;
      case "plane":
        geometry = new THREE.PlaneGeometry(
          bounded(item.width, 2, 0.001, 100),
          height,
          detail,
          detail,
        );
        break;
      case "circle":
        geometry = new THREE.CircleGeometry(radius, detail);
        break;
      case "line": {
        const start = new THREE.Vector3(...(item.start ?? [-1, 0, 0]));
        const end = new THREE.Vector3(...(item.end ?? [1, 0, 0]));
        const delta = end.clone().sub(start);
        const lineRadius = bounded(item.width, 0.025, 0.001, 10) / 2;
        geometry = new THREE.CylinderGeometry(
          lineRadius,
          lineRadius,
          delta.length(),
          8,
        );
        geometry.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            delta.lengthSq() ? delta.normalize() : new THREE.Vector3(0, 1, 0),
          ),
        );
        geometry.translate(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          (start.z + end.z) / 2,
        );
        break;
      }
      default:
        throw new Error(`不支持的几何形状：${item.shape}`);
    }
    ownedGeometries.push(geometry);
    validateVertices(geometry);
    const material = materialFor(effectiveMaterial);
    holder.add(new THREE.Mesh(geometry, material));
    return holder;
  };
  try {
    root.add(build(spec, 0));
    return root;
  } catch (error) {
    // Track allocations separately because a failed child may not be attached yet.
    ownedGeometries.forEach((geometry) => geometry.dispose());
    ownedMaterials.forEach((material) => material.dispose());
    throw error;
  }
}
