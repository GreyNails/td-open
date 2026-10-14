import type { GraphNode } from "../types";
import {
  isChannelBuffer,
  makeChannels,
  type ChannelBuffer,
} from "../runtimeValues";
import { geometryMesh } from "./meshRuntime";
import {
  isGeometrySpec,
  type GeometrySpec,
  type MeshData,
  type Vec3,
} from "./geometry";

export type Dance = {
  time: number;
  vocals: number;
  drums: number;
  hit: number;
  bass: number;
  other: number;
  pulse: number;
  scale: number;
  ripple: number;
  colorMix: number;
};
export type PointCloudSpec = GeometrySpec & {
  pointCloud?: true;
  pointDance?: Dance;
};
const finite = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export function sampleSurface(
  spec: GeometrySpec,
  count: number,
  seed: number,
  height: number,
): PointCloudSpec {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 60000 ||
    !Number.isFinite(height) ||
    height <= 0
  )
    throw new Error("点云需要 1–60000 个点与有限正高度");
  const mesh = geometryMesh(spec);
  const triangles: {
    a: Vec3;
    b: Vec3;
    c: Vec3;
    normal: Vec3;
    total: number;
  }[] = [];
  let area = 0;
  for (const face of mesh.faces)
    for (let k = 1; k < face.length - 1; k++) {
      const a = mesh.positions[face[0]],
        b = mesh.positions[face[k]],
        c = mesh.positions[face[k + 1]];
      const u = b.map((x, i) => x - a[i]),
        v = c.map((x, i) => x - a[i]);
      const normal: Vec3 = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const length = Math.hypot(...normal);
      if (length < 1e-10) continue;
      area += length * 0.5;
      triangles.push({
        a,
        b,
        c,
        normal: normal.map((x) => x / length) as Vec3,
        total: area,
      });
    }
  if (!triangles.length) throw new Error("点云采样需要真实三角面网格");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const point of mesh.positions)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], point[k]);
      max[k] = Math.max(max[k], point[k]);
    }
  const mid = min.map((x, k) => (x + max[k]) * 0.5),
    factor = height / Math.max(...max.map((x, k) => x - min[k]), 1e-6);
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const positions: Vec3[] = [],
    normals: number[][] = [],
    phases: number[][] = [];
  for (let i = 0; i < count; i++) {
    const target = random() * area;
    let lo = 0,
      hi = triangles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (triangles[mid].total < target) lo = mid + 1;
      else hi = mid;
    }
    const t = triangles[lo],
      r = Math.sqrt(random()),
      s = random(),
      weights = [1 - r, r * (1 - s), r * s];
    positions.push(
      t.a.map(
        (_, k) =>
          (t.a[k] * weights[0] +
            t.b[k] * weights[1] +
            t.c[k] * weights[2] -
            mid[k]) *
          factor,
      ) as Vec3,
    );
    normals.push(t.normal);
    phases.push([random()]);
  }
  return {
    shape: "mesh",
    detail: 1,
    pointCloud: true,
    mesh: {
      positions,
      faces: [],
      pointAttributes: { N: normals, phase: phases },
    },
  };
}
export function cookEnvelope(
  node: GraphNode,
  input: unknown,
  time: number,
  state: Map<string, unknown>,
  reference = 0.18,
): ChannelBuffer {
  let rms = 0;
  if (isChannelBuffer(input)) {
    let squares = 0,
      total = 0;
    for (const ch of input.channels)
      for (const x of ch.samples) {
        squares += x * x;
        total++;
      }
    rms = total ? Math.sqrt(squares / total) : 0;
  }
  const params = node.data.params,
    gain = finite(params.gain, 1),
    raw = rms < 1e-7 ? 0 : clamp((rms / Math.max(reference, 0.0001)) * gain);
  const previous = state.get("envelope") as
    { time: number; energy: number; raw: number } | undefined;
  const dt = previous ? time - previous.time : 0,
    valid = previous && dt >= 0 && dt < 0.5;
  const tau = finite(
    raw > (previous?.energy || 0) ? params.attack : params.release,
    raw > (previous?.energy || 0) ? 0.035 : 0.25,
  );
  const energy = valid
    ? previous.energy +
      (raw - previous.energy) * (1 - Math.exp(-dt / Math.max(0.005, tau)))
    : raw;
  const hit = valid ? clamp(Math.max(raw - previous.raw, 0) * 3.5) : 0;
  state.set("envelope", { time, energy, raw });
  return makeChannels(
    { energy: [energy], hit: [hit], rms: [rms] },
    60,
    Math.floor(time * 60),
    true,
  );
}
const channel = (input: unknown, name: string) =>
  isChannelBuffer(input)
    ? clamp(input.channels.find((ch) => ch.name === name)?.samples.at(-1) || 0)
    : 0;
export function danceSpec(
  node: GraphNode,
  source: unknown,
  input: (handle: string) => unknown,
  time: number,
): PointCloudSpec {
  if (!isGeometrySpec(source))
    return {
      shape: "mesh",
      detail: 1,
      pointCloud: true,
      mesh: { positions: [], faces: [] },
    };
  const p = node.data.params;
  return {
    ...source,
    pointCloud: true,
    pointDance: {
      time,
      vocals: channel(input("vocals"), "energy"),
      drums: channel(input("drums"), "energy"),
      hit: channel(input("drums"), "hit"),
      bass: channel(input("bass"), "energy"),
      other: channel(input("other"), "energy"),
      pulse: finite(p.pulse, 0.12),
      scale: finite(p.scale, 0.14),
      ripple: finite(p.ripple, 0.075),
      colorMix: finite(p.color_mix, 0.75),
    },
  };
}
/** CPU equivalent of the GPU displacement, used for independent checks and PLY export. */
export function displacedPoint(
  point: Vec3,
  normal: Vec3,
  phase: number,
  dance: Dance,
): Vec3 {
  const [x, y, z] = point,
    t = dance.time;
  const offset =
    dance.pulse *
    (dance.hit * 0.9 + dance.drums * 0.16) *
    (0.45 + 0.55 * Math.sin(y * 6 - t * 3 + phase * 6.28) ** 2);
  const scale = 1 + dance.bass * dance.scale;
  return [
    (x +
      normal[0] * offset +
      dance.other * dance.ripple * Math.sin(y * 4 + t * 0.7 + phase * 4)) *
      scale,
    (y +
      normal[1] * offset +
      dance.other *
        dance.ripple *
        0.45 *
        Math.sin(x * 5 + t * 0.9 + phase * 6)) *
      scale,
    (z +
      normal[2] * offset +
      dance.other *
        dance.ripple *
        0.65 *
        Math.cos(y * 3 - t * 0.6 + phase * 5)) *
      scale,
  ];
}
export function pointCloudPLY(spec: PointCloudSpec): string {
  const mesh: MeshData | undefined = spec.mesh;
  if (!mesh?.positions.length) throw new Error("请先生成并加载点云");
  const normals = mesh.pointAttributes?.N,
    phases = mesh.pointAttributes?.phase;
  const points = mesh.positions.map((p, i) =>
    spec.pointDance
      ? displacedPoint(
          p,
          (normals?.[i] as Vec3) || [0, 1, 0],
          phases?.[i]?.[0] || 0,
          spec.pointDance,
        )
      : p,
  );
  return (
    "ply\nformat ascii 1.0\ncomment TD Open point cloud coordinates\nelement vertex " +
    points.length +
    "\nproperty float x\nproperty float y\nproperty float z\nend_header\n" +
    points.map((p) => p.map((v) => v.toFixed(6)).join(" ")).join("\n") +
    "\n"
  );
}
