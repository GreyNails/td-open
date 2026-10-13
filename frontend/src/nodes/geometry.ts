import * as THREE from "three";

export type Vec3 = [number, number, number];
export type GeometrySpec = {
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
  const root = new THREE.Group();
  const ownedGeometries: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const build = (item: GeometrySpec, depth: number): THREE.Object3D => {
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
        holder.add(build(child, depth + 1));
      return holder;
    }
    if (item.shape === "model") {
      const instance = item.url ? resolveModel?.(item.url) : undefined;
      if (instance) {
        const borrowed = instance.clone(true);
        borrowed.userData = { ...borrowed.userData, tdBorrowedResources: true };
        holder.add(borrowed);
      }
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
    const material = new THREE.MeshStandardMaterial({
      color,
      wireframe,
      metalness: 0.3,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });
    ownedMaterials.push(material);
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
