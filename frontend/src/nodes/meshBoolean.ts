import * as THREE from "three";
import type { MeshData, Vec3 } from "./geometry";
import { triangulate, v, weldMesh, xyz } from "./meshRuntime";
const EPS = 1e-5;
class Polygon {
  normal: THREE.Vector3;
  w: number;
  constructor(public points: THREE.Vector3[]) {
    this.normal = points[1]
      .clone()
      .sub(points[0])
      .cross(points[2].clone().sub(points[0]))
      .normalize();
    this.w = this.normal.dot(points[0]);
  }
  clone() {
    return new Polygon(this.points.map((p) => p.clone()));
  }
  flip() {
    this.points.reverse();
    this.normal.negate();
    this.w = -this.w;
  }
}
class BSP {
  normal?: THREE.Vector3;
  w = 0;
  polygons: Polygon[] = [];
  front?: BSP;
  back?: BSP;
  constructor(polygons: Polygon[] = [], depth = 0) {
    if (polygons.length) this.build(polygons, depth);
  }
  split(
    polygon: Polygon,
    coplanarFront: Polygon[],
    coplanarBack: Polygon[],
    front: Polygon[],
    back: Polygon[],
  ) {
    let kind = 0;
    const types = polygon.points.map((p) => {
      const t = this.normal!.dot(p) - this.w,
        type = t < -EPS ? 2 : t > EPS ? 1 : 0;
      kind |= type;
      return type;
    });
    if (kind === 0)
      (this.normal!.dot(polygon.normal) > 0
        ? coplanarFront
        : coplanarBack
      ).push(polygon);
    else if (kind === 1) front.push(polygon);
    else if (kind === 2) back.push(polygon);
    else {
      const f: THREE.Vector3[] = [],
        b: THREE.Vector3[] = [];
      for (let i = 0; i < polygon.points.length; i++) {
        const j = (i + 1) % polygon.points.length,
          ti = types[i],
          tj = types[j],
          vi = polygon.points[i],
          vj = polygon.points[j];
        if (ti !== 2) f.push(vi);
        if (ti !== 1) b.push(vi.clone());
        if ((ti | tj) === 3) {
          const t =
              (this.w - this.normal!.dot(vi)) /
              this.normal!.dot(vj.clone().sub(vi)),
            point = vi.clone().lerp(vj, t);
          f.push(point);
          b.push(point.clone());
        }
      }
      if (f.length >= 3) front.push(new Polygon(f));
      if (b.length >= 3) back.push(new Polygon(b));
    }
  }
  build(polygons: Polygon[], depth = 0) {
    if (!polygons.length) return;
    if (depth > 256) throw new Error("布尔 BSP 深度超过预算，请先降低几何精度");
    if (!this.normal) {
      this.normal = polygons[0].normal.clone();
      this.w = polygons[0].w;
    }
    const front: Polygon[] = [],
      back: Polygon[] = [];
    for (const polygon of polygons)
      this.split(polygon, this.polygons, this.polygons, front, back);
    if (front.length) {
      this.front ??= new BSP();
      this.front.build(front, depth + 1);
    }
    if (back.length) {
      this.back ??= new BSP();
      this.back.build(back, depth + 1);
    }
  }
  invert() {
    this.polygons.forEach((p) => p.flip());
    this.normal?.negate();
    this.w = -this.w;
    this.front?.invert();
    this.back?.invert();
    [this.front, this.back] = [this.back, this.front];
  }
  clip(polygons: Polygon[]): Polygon[] {
    if (!this.normal) return polygons.slice();
    let front: Polygon[] = [],
      back: Polygon[] = [];
    for (const p of polygons) this.split(p, front, back, front, back);
    if (this.front) front = this.front.clip(front);
    if (this.back) back = this.back.clip(back);
    else back = [];
    return front.concat(back);
  }
  clipTo(other: BSP) {
    this.polygons = other.clip(this.polygons);
    this.front?.clipTo(other);
    this.back?.clipTo(other);
  }
  all(): Polygon[] {
    return this.polygons.concat(
      this.front?.all() ?? [],
      this.back?.all() ?? [],
    );
  }
}
/** BSP boolean on closed triangle meshes. Explicit budget prevents a UI-locking quadratic cook. */
export function booleanMeshes(
  first: MeshData,
  second: MeshData,
  operation: string,
): MeshData {
  const polygons = (mesh: MeshData) =>
    triangulate(mesh)
      .faces.map((face) => new Polygon(face.map((i) => v(mesh.positions[i]))))
      .filter((p) => p.normal.lengthSq() > 0.1);
  const ap = polygons(first),
    bp = polygons(second);
  if (ap.length + bp.length > 6000)
    throw new Error(
      "布尔运算限制为 6000 个输入三角形，请使用 Polyreduce 或降低细分",
    );
  const a = new BSP(ap),
    b = new BSP(bp);
  if (operation === "subtract") {
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.all());
    a.invert();
  } else if (operation === "intersect") {
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.all());
    a.invert();
  } else {
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.all());
  }
  const positions: Vec3[] = [],
    faces: number[][] = [];
  for (const p of a.all()) {
    const offset = positions.length;
    positions.push(...p.points.map(xyz));
    faces.push(p.points.map((_, i) => offset + i));
  }
  return weldMesh({ positions, faces });
}
