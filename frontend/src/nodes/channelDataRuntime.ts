import * as THREE from "three";
import type { GraphNode, Project } from "../types";
import { operatorPath } from "../networks";
import {
  asChannels,
  asTable,
  isChannelBuffer,
  isTableData,
  makeChannels,
  makeTable,
  parseTableText,
  scalarValue,
  tableCSV,
  textValue,
  type ChannelBuffer,
  type TableData,
  type Channel,
} from "../runtimeValues";
import { channelDataCatalog } from "./channelDataCatalog";
import { buildGeometryObject, isGeometrySpec } from "./geometry";
import { compileExpression } from "./safeExpression";
export type ChannelDataContext = {
  project?: Project;
  geometryPoints?: (value: unknown) => number[][];
};
type Result =
  | { handled: false }
  | { handled: true; value: ChannelBuffer | TableData | number | string };
const supported = new Set(channelDataCatalog.map((item) => item.type));
export const channelDataTypes = supported;
export const channelDataReferenceKeys = channelDataCatalog.map(
  (item) => `${item.family}:${item.english}`,
);
export const channelDataReferenceCoverage = channelDataCatalog.map((item) => ({
  family: item.family,
  reference: item.english,
  type: item.type,
  status: "implemented",
  limitations: item.description,
}));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mod = (v: number, n: number) => (n ? ((v % n) + n) % n : 0);
const finite = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" &&
        value.trim() &&
        Number.isFinite(Number(value))
      ? Number(value)
      : fallback;
const parse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("参数不是有效的 JSON");
  }
};
const numbers = (value: string): number[] => {
  const data = parse(value);
  if (
    !Array.isArray(data) ||
    !data.length ||
    !data.every((x) => typeof x === "number" && Number.isFinite(x))
  )
    throw new Error("需要非空有限数字数组");
  return data;
};
const sampleCount = (v: ChannelBuffer) => v.channels[0]?.samples.length ?? 0;
const sample = (values: number[], index: number, mode = "hold") => {
  const length = values.length;
  if (!length) return 0;
  if (mode === "zero" && (index < 0 || index >= length)) return 0;
  if (mode === "wrap") index = mod(index, length);
  else if (mode === "mirror") {
    const phase = mod(index, Math.max(1, 2 * (length - 1)));
    index = phase > length - 1 ? 2 * (length - 1) - phase : phase;
  } else index = clamp(index, 0, length - 1);
  return values[clamp(Math.floor(index), 0, length - 1)] ?? 0;
};
const lerpSample = (values: number[], index: number, mode = "hold") => {
  const i = Math.floor(index),
    fraction = index - i;
  return (
    sample(values, i, mode) * (1 - fraction) +
    sample(values, i + 1, mode) * fraction
  );
};
const renameUnique = (channels: Channel[]) => {
  const used = new Set<string>();
  return channels.map((ch) => {
    let name = ch.name,
      count = 2;
    while (used.has(name)) name = `${ch.name}_${count++}`;
    used.add(name);
    return { ...ch, name };
  });
};
const rebuild = (
  source: ChannelBuffer,
  channels: Channel[],
  rate = source.sampleRate,
  start = source.start,
  slice = source.timeSlice,
) => makeChannels(channels, rate, start, slice);
function match(name: string, patterns: string): boolean {
  return patterns
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((pattern) => {
      // Linear-time wildcard matching, without exposing regular-expression execution.
      let i = 0,
        j = 0,
        star = -1,
        back = 0;
      while (i < name.length) {
        if (pattern[j] === "?" || pattern[j] === name[i]) {
          i++;
          j++;
        } else if (pattern[j] === "*") {
          star = j++;
          back = i;
        } else if (star >= 0) {
          j = star + 1;
          i = ++back;
        } else return false;
      }
      while (pattern[j] === "*") j++;
      return j === pattern.length;
    });
}
const align = (source: ChannelBuffer, channel: Channel, index: number) =>
  source.channels.find((c) => c.name === channel.name)?.samples ??
  source.channels[index]?.samples ??
  source.channels[0]?.samples ??
  [];
const waveform = (phase: number, wave: string) => {
  const p = mod(phase, 1);
  return wave === "triangle"
    ? 1 - 4 * Math.abs(p - 0.5)
    : wave === "square"
      ? p < 0.5
        ? 1
        : -1
      : wave === "saw"
        ? 2 * p - 1
        : wave === "ramp"
          ? p
          : wave === "pulse"
            ? +(p < 0.1)
            : Math.sin(p * Math.PI * 2);
};
const hash = (x: number, seed: number) =>
  mod(Math.sin(x * 127.1 + seed * 311.7) * 43758.5453123, 1);
function resize(values: number[], length: number, method = "linear"): number[] {
  if (length < 0 || length > 16384)
    throw new Error("单通道操作最多 16384 个样本");
  return Array.from({ length }, (_, i) => {
    const position = length <= 1 ? 0 : (i * (values.length - 1)) / (length - 1);
    if (method === "nearest") return sample(values, Math.round(position));
    if (method === "average" && length < values.length) {
      const start = Math.floor((i * values.length) / length),
        end = Math.max(
          start + 1,
          Math.floor(((i + 1) * values.length) / length),
        );
      let sum = 0;
      for (let j = start; j < end; j++) sum += values[j];
      return sum / (end - start);
    }
    if (method === "cubic") {
      const j = Math.floor(position),
        u = position - j,
        a = sample(values, j - 1),
        b = sample(values, j),
        c = sample(values, j + 1),
        d = sample(values, j + 2);
      return (
        0.5 *
        (2 * b +
          (-a + c) * u +
          (2 * a - 5 * b + 4 * c - d) * u * u +
          (-a + 3 * b - 3 * c + d) * u * u * u)
      );
    }
    return lerpSample(values, position);
  });
}
function resampleChannel(
  values: number[],
  sourceRate: number,
  targetRate: number,
  length: number,
  method: string,
): number[] {
  if (length > 16384) throw new Error("重采样后超过 16384 个样本");
  const ratio = sourceRate / targetRate;
  return Array.from({ length }, (_, i) => {
    if (ratio > 1 && method !== "nearest") {
      const start = i * ratio,
        end = Math.min(values.length, (i + 1) * ratio);
      let sum = 0,
        weight = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        const overlap = Math.max(0, Math.min(j + 1, end) - Math.max(j, start));
        sum += sample(values, j) * overlap;
        weight += overlap;
      }
      return weight ? sum / weight : sample(values, start);
    }
    return method === "nearest"
      ? sample(values, Math.round(i * ratio))
      : lerpSample(values, i * ratio);
  });
}
export function geometryChannelPoints(
  value: unknown,
  maximum = 4096,
): number[][] {
  if (!isGeometrySpec(value)) throw new Error("需要连接 SOP 几何");
  const object = buildGeometryObject(value, "#ffffff", false),
    points: number[][] = [],
    vector = new THREE.Vector3();
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh,
      geometry = mesh.geometry;
    if (!geometry) return;
    const positions = geometry.getAttribute("position");
    if (positions)
      for (let i = 0; i < positions.count && points.length < maximum; i++) {
        vector
          .fromBufferAttribute(positions, i)
          .applyMatrix4(child.matrixWorld);
        points.push(vector.toArray());
      }
    geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((material) => material?.dispose());
  });
  return points;
}
type Memory = {
  signature: string;
  time: number;
  count: number;
  channels: Record<string, number[]>;
  previous?: unknown;
  rows: string[][];
  saved?: ChannelBuffer;
  priorTime?: number;
  output?: ChannelBuffer;
  inputSignature?: string;
};
export function cookChannelDataNode(
  node: GraphNode,
  time: number,
  input: (handle?: string) => unknown,
  state: Map<string, unknown>,
  context: ChannelDataContext = {},
): Result {
  const type = node.type;
  if (!supported.has(type)) return { handled: false };
  const p = node.data.params,
    n = (key: string, fallback = 0) => finite(p[key], fallback),
    s = (key: string, fallback = "") => String(p[key] ?? fallback),
    flag = (key: string, fallback = false) =>
      p[key] === undefined ? fallback : Boolean(p[key]);
  const result = (
    value: ChannelBuffer | TableData | number | string,
  ): Result => ({ handled: true, value });
  const stableParams =
    type === "channel_record"
      ? Object.fromEntries(
          Object.entries(p).filter(
            ([key]) => !["recording", "reset"].includes(key),
          ),
        )
      : p;
  const signature = JSON.stringify([type, stableParams]);
  let memory = state.get(node.id) as Memory | undefined;
  if (!memory || memory.signature !== signature || time < memory.time) {
    memory = {
      signature,
      time,
      count: 0,
      channels: Object.create(null),
      rows: [],
    };
    state.set(node.id, memory);
  }
  const m = memory,
    lastTime = m.time,
    newFrame = !m.count || time !== m.time;
  if (newFrame) {
    m.priorTime = m.count ? m.time : undefined;
    m.count++;
    m.time = time;
  }
  const getA = () => asChannels(input()),
    getB = () => asChannels(input("in2"));
  const map = (
    source: ChannelBuffer,
    fn: (
      value: number,
      i: number,
      channel: number,
      samples: number[],
    ) => number,
  ) =>
    rebuild(
      source,
      source.channels.map((ch, c) => ({
        name: ch.name,
        samples: ch.samples.map((value, i, samples) =>
          fn(value, i, c, samples),
        ),
      })),
    );
  if (
    [
      "channel_constant",
      "pattern_chop",
      "wave_chop",
      "audio_oscillator",
      "noise_channels",
      "channel_keyframe",
      "channel_sequencer",
    ].includes(type)
  ) {
    const rate = n("sample_rate", type === "audio_oscillator" ? 48000 : 60),
      length = Math.floor(n("samples", 256));
    if (length < 1 || length > 16384)
      throw new Error("生成长度必须为 1–16384 个样本");
    if (type === "channel_constant") {
      const values = parse(s("values", '{"chan1":0}'));
      if (!values || typeof values !== "object" || Array.isArray(values))
        throw new Error("常量必须是通道名到数值或数组的 JSON 对象");
      const entries = Object.entries(values),
        max = Math.max(
          1,
          ...entries.map(([, v]) => (Array.isArray(v) ? v.length : 1)),
        );
      const channels = entries.map(([name, v]) => ({
        name,
        samples: Array.isArray(v) ? v : Array(max).fill(v),
      }));
      return result(makeChannels(channels, rate));
    }
    if (type === "channel_keyframe") {
      const keys = parse(s("keys", '{"value":[[0,0],[1,1]]}'));
      if (!keys || typeof keys !== "object" || Array.isArray(keys))
        throw new Error("关键帧需要通道名称映射");
      const channels = Object.entries(keys).map(([name, pairs]) => {
        if (
          !Array.isArray(pairs) ||
          !pairs.length ||
          pairs.length > 4096 ||
          !pairs.every(
            (v) =>
              Array.isArray(v) &&
              v.length === 2 &&
              v.every((x) => typeof x === "number" && Number.isFinite(x)),
          )
        )
          throw new Error("关键帧格式为 [[秒,数值],…]");
        const ordered = [...(pairs as [number, number][])].sort(
          (a, b) => a[0] - b[0],
        );
        if (ordered.some((v, i) => i && v[0] === ordered[i - 1][0]))
          throw new Error("关键帧时间不能重复");
        const first = ordered[0][0],
          duration = ordered.at(-1)![0] - first;
        return {
          name,
          samples: Array.from({ length }, (_, i) => {
            let t = time + i / rate;
            if (flag("loop", true) && duration > 0)
              t = first + mod(t - first, duration);
            if (t <= first) return ordered[0][1];
            const j = ordered.findIndex((pair) => pair[0] > t);
            if (j < 0) return ordered.at(-1)![1];
            const [t0, v0] = ordered[j - 1],
              [t1, v1] = ordered[j];
            let u = (t - t0) / (t1 - t0);
            if (s("mode") === "hold") u = 0;
            if (s("mode") === "smooth") u = u * u * (3 - 2 * u);
            return v0 + (v1 - v0) * u;
          }),
        };
      });
      return result(
        makeChannels(channels, rate, Math.floor(time * rate), true),
      );
    }
    if (type === "channel_sequencer") {
      const steps = numbers(s("steps", "[0,1,0,0.5]")),
        speed = (n("bpm", 120) / 60) * n("subdivision", 4);
      const indexes = Array.from({ length }, (_, i) =>
        Math.floor((time + i / rate) * speed),
      );
      return result(
        makeChannels(
          {
            value: indexes.map((i) => steps[mod(i, steps.length)]),
            step: indexes.map((i) => mod(i, steps.length)),
            trigger: indexes.map(
              (v, i) =>
                +(i === 0
                  ? Math.floor((time - 1 / rate) * speed) !== v
                  : v !== indexes[i - 1]),
            ),
          },
          rate,
          Math.floor(time * rate),
          true,
        ),
      );
    }
    if (type === "noise_channels") {
      let walk = 0;
      return result(
        makeChannels(
          {
            noise: Array.from({ length }, (_, i) => {
              const x = (i / rate) * n("frequency", 4),
                index = Math.floor(x),
                u = x - index;
              let value = hash(i, n("seed", 7)) * 2 - 1;
              if (s("mode", "smooth") === "smooth")
                value =
                  (hash(index, n("seed", 7)) * (1 - u * u * (3 - 2 * u)) +
                    hash(index + 1, n("seed", 7)) * u * u * (3 - 2 * u)) *
                    2 -
                  1;
              if (s("mode") === "walk") {
                walk = clamp(walk + value * 0.1, -1, 1);
                value = walk;
              }
              return value * n("amplitude", 1);
            }),
          },
          rate,
        ),
      );
    }
    const staticPattern = type === "pattern_chop";
    return result(
      makeChannels(
        {
          [s("name", type === "audio_oscillator" ? "audio" : "wave")]:
            Array.from(
              { length },
              (_, i) =>
                waveform(
                  (staticPattern
                    ? (i / length) * n("cycles", 2)
                    : (time + i / rate) * n("frequency", 1)) + n("phase"),
                  s("wave", "sine"),
                ) *
                  n("amplitude", 1) +
                n("offset"),
            ),
        },
        rate,
        staticPattern ? 0 : Math.floor(time * rate),
        !staticPattern,
      ),
    );
  }
  if (
    [
      "channel_clock",
      "channel_timeline",
      "channel_timecode",
      "channel_perform",
      "channel_timer",
      "channel_parameter",
    ].includes(type)
  ) {
    if (type === "channel_clock") {
      const date = s("iso") ? new Date(s("iso")) : new Date();
      if (!Number.isFinite(date.getTime())) throw new Error("无效 ISO 时间");
      return result(
        makeChannels({
          year: [date.getUTCFullYear()],
          month: [date.getUTCMonth() + 1],
          day: [date.getUTCDate()],
          weekday: [date.getUTCDay()],
          hour: [date.getUTCHours()],
          minute: [date.getUTCMinutes()],
          second: [date.getUTCSeconds()],
          unix: [date.getTime() / 1000],
        }),
      );
    }
    if (type === "channel_timeline") {
      const duration = Math.max(0.001, n("duration", 10));
      return result(
        makeChannels({
          seconds: [time],
          frame: [Math.floor(time * n("fps", 60))],
          fraction: [mod(time, duration) / duration],
          cycle: [Math.floor(time / duration)],
        }),
      );
    }
    if (type === "channel_timecode") {
      const fps = n("fps", 30),
        seconds = Math.max(0, time + n("offset")),
        frame = Math.floor(seconds * fps);
      return result(
        makeChannels({
          hours: [Math.floor(seconds / 3600)],
          minutes: [Math.floor(seconds / 60) % 60],
          seconds: [Math.floor(seconds) % 60],
          frames: [frame % fps],
          total_frames: [frame],
        }),
      );
    }
    if (type === "channel_perform")
      return result(
        makeChannels({
          delta: [Math.max(0, time - lastTime)],
          executions: [m.count],
          nodes: [context.project?.nodes.length ?? 0],
        }),
      );
    if (type === "channel_parameter") {
      const target = context.project?.nodes.find(
        (item) => item.id === s("node_id"),
      );
      if (!target) throw new Error("没有找到指定节点 ID");
      return result(
        makeChannels(
          s("parameters", "value")
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((name) => {
              if (target.data.params[name] === undefined)
                throw new Error(`没有参数 ${name}`);
              return { name, samples: [scalarValue(target.data.params[name])] };
            }),
        ),
      );
    }
    const durations = numbers(s("durations", "[1,2,1]"));
    if (durations.some((x) => x <= 0)) throw new Error("计时段时长必须为正数");
    const total = durations.reduce((a, b) => a + b, 0),
      elapsed = Math.max(0, time + n("offset")),
      current = flag("loop", true)
        ? mod(elapsed, total)
        : Math.min(elapsed, total);
    let segment = 0,
      remaining = current;
    while (segment < durations.length - 1 && remaining >= durations[segment])
      remaining -= durations[segment++];
    return result(
      makeChannels({
        fraction: [current / total],
        segment: [segment],
        segment_fraction: [clamp(remaining / durations[segment], 0, 1)],
        done: [+(!flag("loop", true) && elapsed >= total)],
        cycle: [Math.floor(elapsed / total)],
      }),
    );
  }
  if (type === "channel_beat" || type === "channel_lfo") {
    const rate = n("sample_rate", 60),
      length = Math.floor(n("samples", 256));
    if (type === "channel_lfo")
      return result(
        makeChannels(
          Array.from({ length: Math.floor(n("channels", 3)) }, (_, c) => ({
            name: `lfo${c + 1}`,
            samples: Array.from(
              { length },
              (_, i) =>
                waveform(
                  (time + i / rate) * n("frequency", 1) +
                    n("phase") +
                    c / n("channels", 3),
                  s("wave", "sine"),
                ) *
                  n("amplitude", 1) +
                n("offset"),
            ),
          })),
          rate,
          Math.floor(time * rate),
          true,
        ),
      );
    const speed = n("bpm", 120) / 60,
      beats = Math.floor(n("beats_per_bar", 4)),
      progress = Array.from({ length }, (_, i) => (time + i / rate) * speed),
      indexes = progress.map(Math.floor);
    return result(
      makeChannels(
        {
          beat: indexes,
          phase: progress.map((v) => mod(v, 1)),
          bar: indexes.map((v) => Math.floor(v / beats)),
          accent: indexes.map((v) => +(mod(v, beats) === 0)),
          pulse: indexes.map(
            (v, i) =>
              +(
                v !==
                (i ? indexes[i - 1] : Math.floor((time - 1 / rate) * speed))
              ),
          ),
        },
        rate,
        Math.floor(time * rate),
        true,
      ),
    );
  }
  if (type === "channel_bind") {
    const bindings = parse(s("bindings", '{"value":"target.value"}'));
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings))
      throw new Error("参数绑定必须是 JSON 对象");
    const supplied = getA(),
      override = flag("input_override");
    return result(
      makeChannels(
        Object.entries(bindings).map(([name, path]) => {
          const source = String(path),
            dot = source.lastIndexOf("."),
            id = source.slice(0, dot),
            key = source.slice(dot + 1),
            target = context.project?.nodes.find((item) => item.id === id);
          const channel = override
            ? supplied.channels.find((ch) => ch.name === name)
            : undefined;
          if (channel) return channel;
          if (dot < 0 || !target || target.data.params[key] === undefined)
            throw new Error(`未找到绑定参数：${source}`);
          return {
            name,
            samples: Array.from(
              { length: override ? Math.max(1, sampleCount(supplied)) : 1 },
              () => scalarValue(target.data.params[key]),
            ),
          };
        }),
        supplied.sampleRate,
      ),
    );
  }
  if (type === "channel_handle") {
    const supplied = getA(),
      length = Math.max(1, sampleCount(supplied));
    return result(
      makeChannels(
        ["tx", "ty", "tz", "rx", "ry", "rz", "sx", "sy", "sz"].map((name) => ({
          name,
          samples: Array.from({ length }, (_, i) => {
            const ch = supplied.channels.find((ch) => ch.name === name),
              value = ch ? sample(ch.samples, i) : name.startsWith("s") ? 1 : 0;
            return name.startsWith("s") ? value * n(name, 1) : value + n(name);
          }),
        })),
        supplied.sampleRate,
        supplied.start,
        supplied.timeSlice,
      ),
    );
  }
  if (type === "channel_import_select") {
    const imported = parse(
      textValue(input()) || '{"walk":{"tx":[0,1,2],"ty":[0,0.5,0]}}',
    );
    if (!imported || typeof imported !== "object" || Array.isArray(imported))
      throw new Error("导入动作需要 JSON 对象");
    const clip = (imported as Record<string, unknown>)[s("clip", "walk")];
    if (!clip) throw new Error("导入数据中没有该片段");
    const channels = asChannels(JSON.stringify(clip), n("sample_rate", 60));
    return result(
      rebuild(
        channels,
        channels.channels.filter((ch) => match(ch.name, s("channels", "*"))),
      ),
    );
  }
  if (type === "channel_inverse_kin") {
    const source = getA(),
      length = sampleCount(source),
      l1 = n("length1", 1),
      l2 = n("length2", 1),
      out: Record<string, number[]> = {
        shoulder: [],
        elbow: [],
        joint_x: [],
        joint_y: [],
        end_x: [],
        end_y: [],
        reachable: [],
      };
    if (l1 <= 0 || l2 <= 0) throw new Error("骨骼长度必须为正数");
    for (let i = 0; i < length; i++) {
      const x = sample(source.channels[0]?.samples ?? [], i),
        y = sample(source.channels[1]?.samples ?? [], i),
        distance = Math.hypot(x, y),
        elbow =
          Math.acos(
            clamp(
              (distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2),
              -1,
              1,
            ),
          ) * (flag("elbow_flip") ? -1 : 1),
        shoulder =
          Math.atan2(y, x) -
          Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow)),
        jx = l1 * Math.cos(shoulder),
        jy = l1 * Math.sin(shoulder);
      out.shoulder.push((shoulder * 180) / Math.PI);
      out.elbow.push((elbow * 180) / Math.PI);
      out.joint_x.push(jx);
      out.joint_y.push(jy);
      out.end_x.push(jx + l2 * Math.cos(shoulder + elbow));
      out.end_y.push(jy + l2 * Math.sin(shoulder + elbow));
      out.reachable.push(
        +(distance <= l1 + l2 && distance >= Math.abs(l1 - l2)),
      );
    }
    return result(
      makeChannels(out, source.sampleRate, source.start, source.timeSlice),
    );
  }
  if (type === "channel_object") {
    const scene = input() as {
      kind?: string;
      objects?: {
        position?: number[];
        rotation?: number[];
        scale?: number[];
        geometry?: {
          position?: number[];
          rotation?: number[];
          scale?: number[];
        };
      }[];
      camera?: { position: number[]; target: number[]; fov: number };
      lights?: { position: number[]; intensity: number }[];
    };
    if (!scene || scene.kind !== "scene") throw new Error("需要连接场景 COMP");
    const mode = s("mode", "object"),
      index = Math.floor(n("index")),
      target =
        mode === "camera"
          ? scene.camera
          : mode === "light"
            ? scene.lights?.[index]
            : scene.objects?.[index];
    if (!target) throw new Error("场景没有指定对象");
    const position = target.position ?? [0, 0, 0],
      rotation =
        "rotation" in target ? (target.rotation ?? [0, 0, 0]) : [0, 0, 0],
      scale = "scale" in target ? (target.scale ?? [1, 1, 1]) : [1, 1, 1];
    const out: Record<string, number[]> = {
      tx: [position[0]],
      ty: [position[1]],
      tz: [position[2]],
      rx: [rotation[0]],
      ry: [rotation[1]],
      rz: [rotation[2]],
      sx: [scale[0]],
      sy: [scale[1]],
      sz: [scale[2]],
    };
    if ("fov" in target) out.fov = [target.fov];
    if ("intensity" in target) out.intensity = [target.intensity];
    return result(makeChannels(out));
  }
  if (type === "channel_blob_track") {
    const source = input() as HTMLCanvasElement;
    if (!source || typeof source.getContext !== "function")
      throw new Error("需要连接 TOP 图像");
    const width = Math.floor(n("resolution", 128)),
      height = Math.max(
        1,
        Math.round((width * source.height) / Math.max(1, source.width)),
      ),
      canvas = document.createElement("canvas");
    if (width * height > 65536) throw new Error("追踪分析尺寸超过 65536 像素");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data,
      visited = new Uint8Array(width * height),
      queue = new Int32Array(width * height),
      blobs: {
        id: number;
        x: number;
        y: number;
        area: number;
        width: number;
        height: number;
      }[] = [];
    const on = (index: number) =>
      pixels[index * 4] * 0.2126 +
        pixels[index * 4 + 1] * 0.7152 +
        pixels[index * 4 + 2] * 0.0722 >=
        n("threshold", 0.5) * 255 && pixels[index * 4 + 3] > 0;
    for (let start = 0; start < visited.length; start++) {
      if (visited[start] || !on(start)) continue;
      let head = 0,
        tail = 1,
        count = 0,
        sx = 0,
        sy = 0,
        minx = width,
        miny = height,
        maxx = 0,
        maxy = 0;
      queue[0] = start;
      visited[start] = 1;
      while (head < tail) {
        const index = queue[head++],
          x = index % width,
          y = Math.floor(index / width);
        count++;
        sx += x;
        sy += y;
        minx = Math.min(minx, x);
        miny = Math.min(miny, y);
        maxx = Math.max(maxx, x);
        maxy = Math.max(maxy, y);
        for (const neighbor of [
          x ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y ? index - width : -1,
          y < height - 1 ? index + width : -1,
        ])
          if (neighbor >= 0 && !visited[neighbor] && on(neighbor)) {
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
      }
      if (count >= n("minimum_area", 8))
        blobs.push({
          id: 0,
          x: (sx / count + 0.5) / width,
          y: 1 - (sy / count + 0.5) / height,
          area: count / (width * height),
          width: (maxx - minx + 1) / width,
          height: (maxy - miny + 1) / height,
        });
    }
    blobs.sort((a, b) => b.area - a.area);
    const kept = blobs.slice(0, n("maximum", 16)),
      previous = (m.previous ?? []) as typeof blobs,
      used = new Set<number>();
    let next = Math.max(0, ...previous.map((item) => item.id)) + 1;
    for (const blob of kept) {
      const nearest = previous
        .filter((item) => !used.has(item.id))
        .sort(
          (a, b) =>
            Math.hypot(a.x - blob.x, a.y - blob.y) -
            Math.hypot(b.x - blob.x, b.y - blob.y),
        )[0];
      blob.id =
        nearest && Math.hypot(nearest.x - blob.x, nearest.y - blob.y) < 0.25
          ? nearest.id
          : next++;
      used.add(blob.id);
    }
    m.previous = kept;
    return result(
      makeChannels(
        Object.fromEntries(
          ["id", "x", "y", "area", "width", "height"].map((name) => [
            name,
            kept.map((item) => item[name as keyof typeof item]),
          ]),
        ),
      ),
    );
  }
  if (type === "channel_composite") {
    const first = getA(),
      second = getB(),
      secondStart = (second.start * first.sampleRate) / second.sampleRate,
      start = Math.min(first.start, secondStart),
      end = Math.max(
        first.start + sampleCount(first),
        secondStart +
          Math.ceil(
            (sampleCount(second) * first.sampleRate) / second.sampleRate,
          ),
      ),
      length = Math.max(0, Math.ceil(end - start));
    if (length > 16384) throw new Error("复合后的时域超过 16384 个样本");
    const names = [
      ...new Set([
        ...first.channels.map((ch) => ch.name),
        ...second.channels.map((ch) => ch.name),
      ]),
    ];
    return result(
      makeChannels(
        names.map((name) => {
          const av =
              first.channels.find((ch) => ch.name === name)?.samples ?? [],
            bv = second.channels.find((ch) => ch.name === name)?.samples ?? [];
          return {
            name,
            samples: Array.from({ length }, (_, i) => {
              const ai = start + i - first.start,
                bi =
                  ((start + i - secondStart) * second.sampleRate) /
                  first.sampleRate,
                x = lerpSample(av, ai, "zero"),
                y = lerpSample(bv, bi, "zero"),
                inside = bi >= 0 && bi < bv.length;
              return s("mode", "add") === "multiply"
                ? x * y
                : s("mode") === "maximum"
                  ? Math.max(x, y)
                  : s("mode") === "over"
                    ? inside
                      ? x * (1 - n("opacity", 1)) + y * n("opacity", 1)
                      : x
                    : x + y;
            }),
          };
        }),
        first.sampleRate,
        start,
      ),
    );
  }
  if (type === "channel_switch") {
    const first = getA(),
      second = getB(),
      modulation = input("mod");
    if (modulation === undefined)
      return result(n("index") >= 0.5 ? second : first);
    const control = asChannels(modulation),
      length = Math.max(
        sampleCount(first),
        sampleCount(second),
        sampleCount(control),
      );
    return result(
      rebuild(
        first,
        first.channels.map((ch, c) => ({
          name: ch.name,
          samples: Array.from({ length }, (_, i) =>
            sample(control.channels[0]?.samples ?? [], i) >= 0.5
              ? sample(align(second, ch, c), i)
              : sample(ch.samples, i),
          ),
        })),
      ),
    );
  }
  if (type === "dat_to_channels") {
    const rows = asTable(input()).rows;
    if (!rows.length) return result(makeChannels({}, n("sample_rate", 60)));
    const header = flag("header", true),
      data = header ? rows.slice(1) : rows,
      width = Math.max(...rows.map((row) => row.length));
    return result(
      makeChannels(
        Array.from({ length: width }, (_, c) => ({
          name: header ? rows[0][c] || `chan${c + 1}` : `chan${c + 1}`,
          samples: data.map((row, r) => {
            if (
              row[c] !== "" &&
              row[c] !== undefined &&
              !Number.isFinite(Number(row[c]))
            )
              throw new Error(`第 ${r + 1} 行第 ${c + 1} 列不是数字`);
            return Number(row[c] ?? 0);
          }),
        })),
        n("sample_rate", 60),
      ),
    );
  }
  if (type === "top_to_channels") {
    const image = input() as HTMLCanvasElement;
    if (!image || typeof image.getContext !== "function")
      throw new Error("需要连接 TOP 图像");
    const width = Math.floor(n("width", 32)),
      height = Math.floor(n("height", 18)),
      canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data,
      channels: Record<string, number[]> = {
        r: [],
        g: [],
        b: [],
        a: [],
        luma: [],
      };
    for (let i = 0; i < pixels.length; i += 4) {
      channels.r.push(pixels[i] / 255);
      channels.g.push(pixels[i + 1] / 255);
      channels.b.push(pixels[i + 2] / 255);
      channels.a.push(pixels[i + 3] / 255);
      channels.luma.push(
        (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) /
          255,
      );
    }
    return result(makeChannels(channels));
  }
  if (type === "sop_to_channels" || type === "sop_to_dat") {
    const points = (
      context.geometryPoints
        ? context.geometryPoints(input())
        : geometryChannelPoints(input(), n("maximum", 4096))
    ).slice(0, n("maximum", 4096));
    return result(
      type === "sop_to_dat"
        ? makeTable([
            ["index", "tx", "ty", "tz"],
            ...points.map((v, i) => [i, ...v]),
          ])
        : makeChannels({
            tx: points.map((p) => p[0]),
            ty: points.map((p) => p[1]),
            tz: points.map((p) => p[2]),
          }),
    );
  }
  if (channelDataCatalog.find((item) => item.type === type)?.family === "DAT")
    return result(
      cookTable(type, p, time, input, m, context, newFrame, node.id),
    );
  const a = getA(),
    length = sampleCount(a),
    rate = a.sampleRate;
  if (type === "channel_merge") {
    const second = getB(),
      total = Math.max(length, sampleCount(second));
    return result(
      rebuild(
        a,
        renameUnique(
          [...a.channels, ...second.channels].map((ch) => ({
            name: ch.name,
            samples: Array.from({ length: total }, (_, i) =>
              sample(ch.samples, i),
            ),
          })),
        ),
      ),
    );
  }
  if (type === "channel_select" || type === "channel_delete")
    return result(
      rebuild(
        a,
        a.channels.filter(
          (ch) =>
            match(ch.name, s("channels", "*")) === (type === "channel_select"),
        ),
      ),
    );
  if (type === "channel_null")
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({ ...ch, name: s("prefix") + ch.name })),
      ),
    );
  if (type === "channel_rename") {
    const names = parse(s("mapping", "{}"));
    if (!names || typeof names !== "object" || Array.isArray(names))
      throw new Error("名称映射需要 JSON 对象");
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          ...ch,
          name:
            s("prefix") +
            String(
              Object.hasOwn(names, ch.name)
                ? (names as Record<string, unknown>)[ch.name]
                : ch.name,
            ) +
            s("suffix"),
        })),
      ),
    );
  }
  if (type === "channel_reorder") {
    const channels = [...a.channels];
    if (s("mode", "indices") === "alphabetical")
      channels.sort((a, b) => a.name.localeCompare(b.name));
    else if (s("mode") === "reverse") channels.reverse();
    else {
      const indices = s("indices", "0,1")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (
        indices.some(
          (i) => !Number.isInteger(i) || i < 0 || i >= channels.length,
        )
      )
        throw new Error("通道索引超出范围");
      return result(rebuild(a, renameUnique(indices.map((i) => channels[i]))));
    }
    return result(rebuild(a, channels));
  }
  if (type === "native_channel_shuffle") {
    const mode = s("mode", "transpose");
    if (mode === "flatten")
      return result(
        rebuild(a, [
          { name: "all", samples: a.channels.flatMap((ch) => ch.samples) },
        ]),
      );
    if (mode === "split") {
      const size = Math.max(1, Math.floor(n("size", 16))),
        values = a.channels.flatMap((ch) => ch.samples),
        chunks = Math.ceil(values.length / size);
      if (chunks > 256) throw new Error("分块后超过 256 个通道");
      return result(
        rebuild(
          a,
          Array.from({ length: chunks }, (_, i) => ({
            name: `chunk${i + 1}`,
            samples: Array.from(
              { length: size },
              (_, j) => values[i * size + j] ?? 0,
            ),
          })),
        ),
      );
    }
    if (length > 256) throw new Error("转置后超过 256 个通道，请先裁剪样本");
    return result(
      rebuild(
        a,
        Array.from({ length }, (_, i) => ({
          name: `sample${i}`,
          samples: a.channels.map((ch) => ch.samples[i]),
        })),
      ),
    );
  }
  if (["channel_join", "channel_splice"].includes(type)) {
    const second = getB();
    return result(
      rebuild(
        a,
        a.channels.map((ch, c) => {
          const b = align(second, ch, c),
            values = [...ch.samples];
          if (type === "channel_splice") {
            values.splice(
              clamp(Math.floor(n("index")), 0, values.length),
              Math.max(0, Math.floor(n("remove"))),
              ...b,
            );
            return { name: ch.name, samples: values };
          }
          const overlap = Math.min(
            Math.floor(n("crossfade")),
            values.length,
            b.length,
          );
          const joined = values.slice(0, values.length - overlap);
          for (let i = 0; i < overlap; i++) {
            const mix = (i + 1) / (overlap + 1);
            joined.push(
              values[values.length - overlap + i] * (1 - mix) + b[i] * mix,
            );
          }
          joined.push(...b.slice(overlap));
          return { name: ch.name, samples: joined };
        }),
      ),
    );
  }
  if (type === "channel_trim") {
    const start = Math.floor(n("start")),
      size = Math.floor(n("length", 64));
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          ...ch,
          samples: ch.samples.slice(start, start + size),
        })),
        rate,
        a.start + start,
      ),
    );
  }
  if (type === "channel_shift")
    return result(
      map(a, (_, i, c) =>
        sample(
          a.channels[c].samples,
          i - Math.floor(n("shift", 16)),
          s("mode", "wrap"),
        ),
      ),
    );
  if (
    ["channel_stretch", "channel_resample", "channel_interpolate"].includes(
      type,
    )
  ) {
    const newRate = type === "channel_resample" ? n("sample_rate", 120) : rate;
    const count =
      type === "channel_interpolate"
        ? Math.floor(n("samples", 256))
        : Math.max(
            1,
            Math.round(
              length *
                (type === "channel_resample" ? newRate / rate : n("factor", 2)),
            ),
          );
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          ...ch,
          samples:
            type === "channel_resample"
              ? resampleChannel(
                  ch.samples,
                  rate,
                  newRate,
                  count,
                  s("mode", "linear"),
                )
              : resize(
                  ch.samples,
                  count,
                  type === "channel_interpolate"
                    ? "cubic"
                    : s("mode", "linear"),
                ),
        })),
        newRate,
        (a.start * newRate) / rate,
      ),
    );
  }
  if (type === "channel_extend") {
    const before = Math.floor(n("before", 16)),
      after = Math.floor(n("after", 16));
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          ...ch,
          samples: Array.from({ length: length + before + after }, (_, i) =>
            sample(ch.samples, i - before, s("mode", "hold")),
          ),
        })),
        rate,
        a.start - before,
      ),
    );
  }
  if (type === "channel_cycle") {
    const cycles = Math.floor(n("cycles", 3));
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          ...ch,
          samples: Array.from(
            { length: length * cycles },
            (_, i) =>
              ch.samples[
                flag("pingpong") && Math.floor(i / length) % 2
                  ? length - 1 - (i % length)
                  : i % length
              ],
          ),
        })),
      ),
    );
  }
  if (type === "channel_copy")
    return result(
      rebuild(
        a,
        a.channels.flatMap((ch) =>
          Array.from({ length: Math.floor(n("copies", 3)) }, (_, j) => ({
            name: `${ch.name}_${j + 1}`,
            samples: ch.samples.map(
              (_, i) =>
                sample(ch.samples, i - j * n("shift_step", 8), "wrap") *
                (1 + j * n("gain_step", 0.2)),
            ),
          })),
        ),
      ),
    );
  if (type === "channel_sort") {
    const channels = a.channels.map((ch) => ({
      name: ch.name,
      samples: [...ch.samples],
    }));
    if (s("mode") === "channel_mean")
      channels.sort(
        (a, b) =>
          a.samples.reduce((x, y) => x + y, 0) -
          b.samples.reduce((x, y) => x + y, 0),
      );
    else
      channels.forEach((ch) =>
        ch.samples.sort((a, b) =>
          s("mode") === "samples_descending" ? b - a : a - b,
        ),
      );
    return result(rebuild(a, channels));
  }
  if (type === "channel_replace" || type === "channel_override") {
    if (type === "channel_override" && !flag("enabled", true)) return result(a);
    const second = getB(),
      eligible = (ch: Channel) =>
        type === "channel_replace" || match(ch.name, s("channels", "*"));
    let channels = a.channels.map(
      (ch) =>
        second.channels.find(
          (item) => item.name === ch.name && eligible(item),
        ) ?? ch,
    );
    if (type === "channel_replace" && flag("append", true))
      channels = [
        ...channels,
        ...second.channels.filter(
          (ch) => !a.channels.some((item) => item.name === ch.name),
        ),
      ];
    return result(
      rebuild(
        a,
        channels.map((ch) => ({
          ...ch,
          samples: Array.from({ length }, (_, i) => sample(ch.samples, i)),
        })),
      ),
    );
  }
  if (type === "channel_lookup" || type === "channel_warp") {
    const second = getB(),
      positions = type === "channel_lookup" ? a : second,
      curves = type === "channel_lookup" ? second : a;
    return result(
      rebuild(
        positions,
        positions.channels.map((ch, c) => {
          const curve = align(curves, ch, c);
          return {
            name: ch.name,
            samples: ch.samples.map((x) =>
              lerpSample(
                curve,
                x * Math.max(0, curve.length - 1),
                s("mode", "hold"),
              ),
            ),
          };
        }),
      ),
    );
  }
  if (type === "channel_analyze")
    return result(
      rebuild(
        a,
        a.channels.map((ch) => {
          const values = ch.samples,
            mean = values.reduce((a, b) => a + b, 0) / Math.max(1, length),
            mode = s("mode", "rms");
          let value = 0;
          if (length)
            value =
              mode === "mean"
                ? mean
                : mode === "sum"
                  ? mean * length
                  : mode === "min"
                    ? Math.min(...values)
                    : mode === "max"
                      ? Math.max(...values)
                      : mode === "variance"
                        ? values.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
                          length
                        : mode === "peak_index"
                          ? values.indexOf(Math.max(...values))
                          : Math.sqrt(
                              values.reduce((sum, x) => sum + x * x, 0) /
                                length,
                            );
          return { name: ch.name, samples: [value] };
        }),
      ),
    );
  if (
    [
      "channel_math",
      "channel_blend",
      "channel_expression",
      "channel_logic",
    ].includes(type)
  ) {
    const second = getB(),
      mode = s("mode", "add"),
      expr =
        type === "channel_expression"
          ? compileExpression(s("expression", "x"))
          : undefined,
      modulation = input("mod");
    const modBuffer =
      modulation !== undefined ? asChannels(modulation) : undefined;
    return result(
      map(a, (x, i, c, samples) => {
        const y = sample(align(second, a.channels[c], c), i);
        if (expr)
          return expr({ x, y, i, c, t: (a.start + i) / rate, n: length });
        if (type === "channel_blend") {
          const mix = clamp(
            modBuffer
              ? sample(modBuffer.channels[0]?.samples ?? [], i)
              : n("mix", 0.5),
            0,
            1,
          );
          return x * (1 - mix) + y * mix;
        }
        if (type === "channel_logic") {
          const on = x > n("threshold", 0.5),
            previous = i ? samples[i - 1] > n("threshold", 0.5) : false;
          return mode === "below"
            ? +!on
            : mode === "and"
              ? +(on && y > n("threshold", 0.5))
              : mode === "or"
                ? +(on || y > n("threshold", 0.5))
                : mode === "xor"
                  ? +(on !== y > n("threshold", 0.5))
                  : mode === "rising"
                    ? +(on && !previous)
                    : mode === "falling"
                      ? +(!on && previous)
                      : +on;
        }
        if (mode === "divide" && y === 0) throw new Error("通道数学除数为零");
        const value =
          mode === "subtract"
            ? x - y
            : mode === "multiply"
              ? x * y
              : mode === "divide"
                ? x / y
                : mode === "min"
                  ? Math.min(x, y)
                  : mode === "max"
                    ? Math.max(x, y)
                    : x + y;
        return value * n("gain", 1) + n("offset");
      }),
    );
  }
  if (type === "channel_limit") {
    const min = n("minimum", -1),
      max = n("maximum", 1),
      width = max - min;
    if (width <= 0) throw new Error("最大值必须大于最小值");
    return result(
      map(a, (x) =>
        s("mode") === "wrap"
          ? min + mod(x - min, width)
          : s("mode") === "mirror"
            ? min + width - Math.abs(mod(x - min, 2 * width) - width)
            : clamp(x, min, max),
      ),
    );
  }
  if (type === "channel_function") {
    const fn = s("mode", "sin"),
      functions: Record<string, (x: number) => number> = {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        abs: Math.abs,
        sqrt: Math.sqrt,
        square: (x) => x * x,
        exp: Math.exp,
        log: Math.log,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        sign: Math.sign,
      };
    return result(map(a, functions[fn] ?? Math.sin));
  }
  if (type === "channel_scurve")
    return result(
      map(a, (x) => {
        const u = clamp(x, 0, 1);
        return s("mode") === "smoother"
          ? u ** 3 * (u * (u * 6 - 15) + 10)
          : u * u * (3 - 2 * u);
      }),
    );
  if (
    [
      "channel_cross",
      "channel_angle",
      "channel_transform",
      "channel_transform_xyz",
    ].includes(type)
  ) {
    const second = getB(),
      av = new THREE.Vector3(),
      bv = new THREE.Vector3(),
      outputs: Record<string, number[]> =
        type === "channel_angle" ? { value: [] } : { x: [], y: [], z: [] };
    const matrix = new THREE.Matrix4();
    if (type === "channel_transform_xyz") {
      const values = parse(
        s("matrix", "[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]"),
      );
      if (
        !Array.isArray(values) ||
        values.length !== 4 ||
        !values.every(
          (row) =>
            Array.isArray(row) &&
            row.length === 4 &&
            row.every((x) => typeof x === "number" && Number.isFinite(x)),
        )
      )
        throw new Error("需要 4×4 数字矩阵");
      matrix.set(...(values.flat() as Parameters<THREE.Matrix4["set"]>));
    }
    if (type === "channel_transform")
      matrix.compose(
        new THREE.Vector3(n("tx"), n("ty"), n("tz")),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (n("rx") * Math.PI) / 180,
            (n("ry") * Math.PI) / 180,
            (n("rz", 45) * Math.PI) / 180,
          ),
        ),
        new THREE.Vector3().setScalar(n("scale", 1)),
      );
    for (let i = 0; i < length; i++) {
      av.set(
        sample(a.channels[0]?.samples ?? [], i),
        sample(a.channels[1]?.samples ?? [], i),
        sample(a.channels[2]?.samples ?? [], i),
      );
      bv.set(
        sample(second.channels[0]?.samples ?? [], i),
        sample(second.channels[1]?.samples ?? [], i),
        sample(second.channels[2]?.samples ?? [], i),
      );
      if (type === "channel_angle")
        outputs.value.push(
          s("mode") === "dot"
            ? av.dot(bv)
            : s("mode") === "signed2d"
              ? (Math.atan2(
                  av.x * bv.y - av.y * bv.x,
                  av.x * bv.x + av.y * bv.y,
                ) *
                  180) /
                Math.PI
              : av.lengthSq() && bv.lengthSq()
                ? (av.angleTo(bv) * 180) / Math.PI
                : 0,
        );
      else {
        if (type === "channel_cross") av.cross(bv);
        else av.applyMatrix4(matrix);
        outputs.x.push(av.x);
        outputs.y.push(av.y);
        outputs.z.push(av.z);
      }
    }
    return result(makeChannels(outputs, rate, a.start, a.timeSlice));
  }
  if (type === "channel_attribute")
    return result(
      rebuild(
        a,
        a.channels,
        n("sample_rate", 60),
        n("start"),
        flag("time_slice"),
      ),
    );
  if (type === "channel_inverse_curve")
    return result(
      rebuild(
        a,
        a.channels.map((ch) => {
          const values = ch.samples,
            increasing = (values.at(-1) ?? 0) >= (values[0] ?? 0);
          if (
            values.some(
              (v, i) =>
                i && (increasing ? v < values[i - 1] : v > values[i - 1]),
            )
          )
            throw new Error("反求曲线要求单调采样值");
          const size = Math.floor(n("samples", 256));
          return {
            name: ch.name,
            samples: Array.from({ length: size }, (_, i) => {
              const target =
                (values[0] ?? 0) +
                (((values.at(-1) ?? 0) - (values[0] ?? 0)) * i) /
                  Math.max(1, size - 1);
              let j = values.findIndex((x) =>
                increasing ? x >= target : x <= target,
              );
              if (j <= 0) return j === 0 ? 0 : 1;
              const u =
                values[j] === values[j - 1]
                  ? 0
                  : (target - values[j - 1]) / (values[j] - values[j - 1]);
              return (j - 1 + u) / Math.max(1, values.length - 1);
            }),
          };
        }),
      ),
    );
  if (type === "channel_info")
    return result(
      makeChannels({
        channels: [a.channels.length],
        samples: [length],
        sample_rate: [rate],
        duration: [length / rate],
        start: [a.start],
        time_slice: [+a.timeSlice],
      }),
    );
  if (type === "channel_fan") {
    const count = Math.floor(n("outputs", 4)),
      values = a.channels[0]?.samples ?? [];
    return result(
      makeChannels(
        Array.from({ length: count }, (_, c) => ({
          name: `weight${c}`,
          samples: values.map((x) =>
            s("mode", "onehot") === "linear"
              ? clamp(1 - Math.abs(x - c), 0, 1)
              : +(Math.round(x) === c),
          ),
        })),
        rate,
        a.start,
        a.timeSlice,
      ),
    );
  }
  if (type === "channel_clip") {
    const size = Math.floor(n("samples", 256)),
      position = (time * n("speed", 1) + n("offset")) * rate;
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          name: ch.name,
          samples: Array.from({ length: size }, (_, i) =>
            lerpSample(
              ch.samples,
              position + i * n("speed", 1),
              flag("loop", true) ? "wrap" : "hold",
            ),
          ),
        })),
        rate,
        Math.floor(time * rate),
        true,
      ),
    );
  }
  if (type === "channel_clip_blender") {
    const second = getB(),
      mix = clamp(n("mix", 0.5), 0, 1),
      size = Math.floor(n("samples", 256));
    return result(
      rebuild(
        a,
        a.channels.map((ch, c) => {
          const av = resize(ch.samples, size),
            bv = resize(align(second, ch, c), size);
          return {
            name: ch.name,
            samples: av.map(
              (x, i) =>
                x * Math.cos((mix * Math.PI) / 2) +
                bv[i] * Math.sin((mix * Math.PI) / 2),
            ),
          };
        }),
      ),
    );
  }
  if (type === "channel_feedback") {
    if (newFrame || !m.output) {
      const saved = flag("reset") ? undefined : m.saved;
      m.output = saved ? map(saved, (x) => x * n("gain", 1)) : map(a, () => 0);
      m.saved = makeChannels(a.channels, rate, a.start, a.timeSlice);
    }
    return result(m.output);
  }
  if (type === "channel_record" || type === "channel_trail") {
    if (type === "channel_record" && flag("reset")) m.saved = undefined;
    if (newFrame && (type === "channel_trail" || flag("recording", true))) {
      const maximum = Math.min(
        16384,
        Math.max(
          1,
          type === "channel_trail"
            ? Math.ceil(n("seconds", 2) * rate)
            : Math.floor(n("maximum", 4096)),
        ),
      );
      m.saved = rebuild(
        a,
        a.channels.map((ch) => ({
          name: ch.name,
          samples: [
            ...(m.saved?.channels.find((old) => old.name === ch.name)
              ?.samples ?? []),
            ...ch.samples,
          ].slice(-maximum),
        })),
        rate,
        Math.max(0, a.start + length - maximum),
        false,
      );
    }
    return result(
      m.saved ??
        rebuild(
          a,
          a.channels.map((ch) => ({ ...ch, samples: [] })),
        ),
    );
  }
  if (type === "channel_time_slice") {
    const requested =
        m.priorTime === undefined
          ? length
          : Math.max(0, Math.round((time - m.priorTime) * rate)),
      size = Math.min(length, n("max_samples", 4096), requested);
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          ...ch,
          samples: ch.samples.slice(length - size),
        })),
        rate,
        a.start + length - size,
        true,
      ),
    );
  }
  if (type === "channel_script") {
    const program = parse(s("program", "[]"));
    if (!Array.isArray(program) || program.length > 32)
      throw new Error("脚本需要最多 32 步 JSON 操作数组");
    let value = a;
    for (const step of program) {
      if (!step || typeof step !== "object")
        throw new Error("每步必须是操作对象");
      if (step.op === "map") {
        const expr = compileExpression(String(step.expression ?? "x"));
        value = map(value, (x, i, c) =>
          expr({
            x,
            i,
            c,
            t: (value.start + i) / value.sampleRate,
            n: sampleCount(value),
          }),
        );
      } else if (step.op === "select")
        value = rebuild(
          value,
          value.channels.filter((ch) =>
            match(ch.name, String(step.channels ?? "*")),
          ),
        );
      else if (step.op === "rename")
        value = rebuild(
          value,
          value.channels.map((ch) => ({
            ...ch,
            name:
              String(step.prefix ?? "") + ch.name + String(step.suffix ?? ""),
          })),
        );
      else if (step.op === "reverse")
        value = rebuild(
          value,
          value.channels.map((ch) => ({
            ...ch,
            samples: [...ch.samples].reverse(),
          })),
        );
      else throw new Error(`不支持的信号脚本操作：${step.op}`);
    }
    return result(value);
  }
  if (type === "audio_spectrum_chop") {
    const size = Math.floor(n("fft_size", 1024));
    if (size < 32 || size > 16384 || size & (size - 1))
      throw new Error("FFT 长度必须是 32–16384 范围内的 2 的幂");
    return result(
      rebuild(
        a,
        a.channels.map((ch) => ({
          name: ch.name,
          samples: spectrum(
            ch.samples,
            size,
            flag("window", true),
            s("mode", "magnitude"),
          ),
        })),
        size / rate,
        0,
        false,
      ),
    );
  }
  if (type === "audio_binaural") {
    const azimuth = (clamp(n("azimuth", 30), -90, 90) * Math.PI) / 180,
      pan = Math.sin(azimuth),
      delay = Math.round(Math.abs(pan) * 0.00065 * rate),
      distance = Math.max(0.1, n("distance", 1)),
      mono = Array.from(
        { length },
        (_, i) =>
          a.channels.reduce((sum, ch) => sum + ch.samples[i], 0) /
          Math.max(1, a.channels.length),
      );
    const previous = a.timeSlice ? (m.channels.mono ?? []) : [],
      all = [...previous, ...mono],
      offset = previous.length;
    const left = mono.map(
        (_, i) =>
          (sample(all, offset + i - (pan > 0 ? delay : 0), "zero") *
            Math.sqrt((1 - pan) / 2)) /
          distance,
      ),
      right = mono.map(
        (_, i) =>
          (sample(all, offset + i - (pan < 0 ? delay : 0), "zero") *
            Math.sqrt((1 + pan) / 2)) /
          distance,
      );
    m.channels.mono = all.slice(-Math.ceil(rate * 0.001));
    return result(makeChannels({ left, right }, rate, a.start, a.timeSlice));
  }
  if (type === "audio_render_chop") {
    const second = getB(),
      size = Math.max(length, sampleCount(second)),
      left: number[] = [],
      right: number[] = [];
    const gains = [
      clamp(n("pan1", -0.5), -1, 1),
      clamp(n("pan2", 0.5), -1, 1),
    ].map((pan) => [Math.sqrt((1 - pan) / 2), Math.sqrt((1 + pan) / 2)]);
    for (let i = 0; i < size; i++) {
      const first =
          (a.channels.reduce((sum, ch) => sum + sample(ch.samples, i), 0) /
            Math.max(1, a.channels.length)) *
          n("gain1", 0.5),
        other =
          (second.channels.reduce((sum, ch) => sum + sample(ch.samples, i), 0) /
            Math.max(1, second.channels.length)) *
          n("gain2", 0.5);
      left.push(first * gains[0][0] + other * gains[1][0]);
      right.push(first * gains[0][1] + other * gains[1][1]);
    }
    return result(makeChannels({ left, right }, rate, a.start, a.timeSlice));
  }
  const second = getB(),
    reset = input("reset"),
    identity = a.timeSlice ? JSON.stringify([a, second, reset]) : undefined;
  if (identity && m.inputSignature === identity && m.output)
    return result(m.output);
  const output = cookTemporal(type, p, a, second, reset, m);
  m.inputSignature = identity;
  m.output = output;
  return result(output);
}
type Coefficients = [number, number, number, number, number];
function biquad(
  mode: string,
  rate: number,
  frequency: number,
  q: number,
  gain = 0,
): Coefficients {
  const w = (2 * Math.PI * clamp(frequency, 0.0001, rate * 0.499)) / rate,
    c = Math.cos(w),
    si = Math.sin(w),
    alpha = si / (2 * Math.max(0.001, q)),
    A = 10 ** (gain / 40);
  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = -2 * c,
    a2 = 1 - alpha;
  if (mode === "lowpass") {
    b0 = (1 - c) / 2;
    b1 = 1 - c;
    b2 = b0;
    a0 = 1 + alpha;
  } else if (mode === "highpass") {
    b0 = (1 + c) / 2;
    b1 = -(1 + c);
    b2 = b0;
    a0 = 1 + alpha;
  } else if (mode === "bandpass") {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
  } else if (mode === "notch") {
    b0 = 1;
    b1 = -2 * c;
    b2 = 1;
    a0 = 1 + alpha;
  } else if (mode === "peak") {
    b0 = 1 + alpha * A;
    b1 = -2 * c;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a2 = 1 - alpha / A;
  } else if (mode === "lowshelf") {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * c + beta);
    b1 = 2 * A * (A - 1 - (A + 1) * c);
    b2 = A * (A + 1 - (A - 1) * c - beta);
    a0 = A + 1 + (A - 1) * c + beta;
    a1 = -2 * (A - 1 + (A + 1) * c);
    a2 = A + 1 + (A - 1) * c - beta;
  } else if (mode === "highshelf") {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * c + beta);
    b1 = -2 * A * (A - 1 + (A + 1) * c);
    b2 = A * (A + 1 + (A - 1) * c - beta);
    a0 = A + 1 - (A - 1) * c + beta;
    a1 = 2 * (A - 1 - (A + 1) * c);
    a2 = A + 1 - (A - 1) * c - beta;
  } else throw new Error("未知双二阶滤波模式");
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filterSample(
  x: number,
  coeffs: Coefficients,
  state: number[],
  offset = 0,
): number {
  const [b0, b1, b2, a1, a2] = coeffs,
    y = b0 * x + (state[offset] ?? 0);
  state[offset] = b1 * x - a1 * y + (state[offset + 1] ?? 0);
  state[offset + 1] = b2 * x - a2 * y;
  return y;
}
export function spectrum(
  values: number[],
  size: number,
  window = true,
  mode = "magnitude",
): number[] {
  const real = new Float64Array(size),
    imaginary = new Float64Array(size);
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    const w = window ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size) : 1;
    real[i] = (values[i] ?? 0) * w;
    windowSum += w;
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
    }
  }
  for (let width = 2; width <= size; width <<= 1) {
    const angle = (-2 * Math.PI) / width;
    for (let start = 0; start < size; start += width)
      for (let j = 0; j < width / 2; j++) {
        const c = Math.cos(j * angle),
          s = Math.sin(j * angle),
          odd = start + j + width / 2,
          even = start + j,
          re = real[odd] * c - imaginary[odd] * s,
          im = real[odd] * s + imaginary[odd] * c;
        real[odd] = real[even] - re;
        imaginary[odd] = imaginary[even] - im;
        real[even] += re;
        imaginary[even] += im;
      }
  }
  return Array.from({ length: size / 2 + 1 }, (_, i) => {
    const magnitude =
      (Math.hypot(real[i], imaginary[i]) / Math.max(1, windowSum)) *
      (i && i !== size / 2 ? 2 : 1);
    return mode === "decibels"
      ? 20 * Math.log10(Math.max(1e-12, magnitude))
      : mode === "power"
        ? magnitude * magnitude
        : magnitude;
  });
}
function cookTemporal(
  type: string,
  p: GraphNode["data"]["params"],
  a: ChannelBuffer,
  b: ChannelBuffer,
  reset: unknown,
  memory: Memory,
): ChannelBuffer {
  const n = (key: string, fallback = 0) => finite(p[key], fallback),
    mode = String(p.mode ?? ""),
    rate = a.sampleRate,
    dt = 1 / rate;
  const length = sampleCount(a),
    threshold = n("threshold", 0.5),
    resetSamples =
      reset !== undefined ? (asChannels(reset).channels[0]?.samples ?? []) : [];
  const kernel =
    type === "channel_filter"
      ? numbers(String(p.kernel ?? "[0.25,0.5,0.25]"))
      : [];
  if (kernel.length > 1024) throw new Error("FIR 核不能超过 1024 个系数");
  const delay = Math.round(Math.max(0, n("seconds", 0.1)) * rate);
  if (type === "channel_delay" && delay * a.channels.length > 262144)
    throw new Error("延迟缓冲区超过 262144 个总样本，请减少时长或通道数");
  const coefficients =
    type === "audio_filter_chop"
      ? [biquad(mode || "lowpass", rate, n("frequency", 1000), n("q", 0.707))]
      : type === "audio_para_eq"
        ? [biquad("peak", rate, n("frequency", 1000), n("q", 1), n("gain", 6))]
        : type === "audio_band_eq"
          ? [
              biquad(
                "lowshelf",
                rate,
                n("low_frequency", 200),
                0.707,
                n("low_gain", 6),
              ),
              biquad(
                "highshelf",
                rate,
                n("high_frequency", 5000),
                0.707,
                n("high_gain", -3),
              ),
            ]
          : [];
  const known = new Set([
    "channel_count",
    "channel_delay",
    "channel_filter",
    "channel_lag",
    "channel_slope",
    "channel_speed",
    "channel_envelope",
    "channel_hold",
    "channel_event",
    "channel_pulse",
    "channel_spring",
    "channel_trigger",
    "audio_filter_chop",
    "audio_para_eq",
    "audio_band_eq",
    "audio_dynamics",
    "audio_phaser_chop",
  ]);
  if (!known.has(type)) throw new Error(`尚未实现信号执行器：${type}`);
  return rebuild(
    a,
    a.channels.map((ch, c) => {
      let state = a.timeSlice ? [...(memory.channels[ch.name] ?? [])] : [];
      const other = align(b, ch, c);
      if (type === "channel_delay" || type === "channel_filter") {
        const needed = type === "channel_delay" ? delay : kernel.length - 1,
          history = state.slice(-needed),
          all = [
            ...Array(Math.max(0, needed - history.length)).fill(0),
            ...history,
            ...ch.samples,
          ];
        const samples = ch.samples.map((_, i) =>
          type === "channel_delay"
            ? all[i]
            : kernel.reduce(
                (sum, coefficient, j) =>
                  sum + coefficient * all[needed + i - j],
                0,
              ),
        );
        memory.channels[ch.name] = needed ? all.slice(-needed) : [];
        return { name: ch.name, samples };
      }
      const samples = ch.samples.map((x, i) => {
        const previous = state[0] ?? 0;
        if (coefficients.length) {
          let y = x;
          coefficients.forEach((coeff, j) => {
            y = filterSample(y, coeff, state, j * 2);
          });
          return y;
        }
        if (type === "channel_count") {
          let count = state[1] ?? 0;
          if (sample(resetSamples, i) > 0.5) count = 0;
          if (x > threshold && previous <= threshold) count++;
          if (n("maximum") > 0) count %= Math.floor(n("maximum")) + 1;
          state[0] = x;
          state[1] = count;
          return count;
        }
        if (type === "channel_lag") {
          const tau = Math.max(
              0,
              x > previous ? n("rise", 0.1) : n("fall", 0.3),
            ),
            y = tau ? previous + (x - previous) * (1 - Math.exp(-dt / tau)) : x;
          state[0] = y;
          return y;
        }
        if (type === "channel_slope") {
          const y = (x - (state.length ? previous : x)) * rate;
          state[0] = x;
          return y;
        }
        if (type === "channel_speed") {
          const y =
            (state[0] ?? n("initial")) *
              Math.exp(-Math.max(0, n("leak")) * dt) +
            x * dt;
          state[0] = y;
          return y;
        }
        if (type === "channel_envelope") {
          const target = mode === "rms" ? x * x : Math.abs(x),
            tau = Math.max(
              0,
              target > previous ? n("attack", 0.01) : n("release", 0.1),
            ),
            y = tau
              ? previous + (target - previous) * (1 - Math.exp(-dt / tau))
              : target;
          state[0] = y;
          return mode === "rms" ? Math.sqrt(Math.max(0, y)) : y;
        }
        if (type === "channel_hold") {
          const gate = sample(other, i);
          if (gate > threshold && previous <= threshold) state[1] = x;
          state[0] = gate;
          return state[1] ?? 0;
        }
        if (type === "channel_event") {
          state[0] = x;
          return mode === "rising"
            ? +(x > threshold && previous <= threshold)
            : mode === "falling"
              ? +(x <= threshold && previous > threshold)
              : mode === "inside"
                ? +(Math.abs(x) <= threshold)
                : +(Math.abs(x - previous) > n("tolerance", 0.01));
        }
        if (type === "channel_pulse") {
          if (x > threshold && previous <= threshold)
            state[1] = Math.max(1, Math.round(n("seconds", 0.1) * rate));
          const y = +(!!state[1] && state[1] > 0);
          state[1] = Math.max(0, (state[1] ?? 0) - 1);
          state[0] = x;
          return y;
        }
        if (type === "channel_spring") {
          const w = 2 * Math.PI * Math.max(0.001, n("frequency", 2)),
            damping = Math.max(0.001, n("damping", 0.5)),
            displacement = previous - x,
            velocity = state[1] ?? 0;
          let position: number, speed: number;
          if (damping < 1 - 1e-6) {
            const wd = w * Math.sqrt(1 - damping * damping),
              decay = Math.exp(-damping * w * dt),
              sine = Math.sin(wd * dt),
              cosine = Math.cos(wd * dt),
              coeff = (velocity + damping * w * displacement) / wd,
              term = displacement * cosine + coeff * sine;
            position = x + decay * term;
            speed =
              decay *
              (-damping * w * term -
                displacement * wd * sine +
                coeff * wd * cosine);
          } else if (damping > 1 + 1e-6) {
            const term = Math.sqrt(damping * damping - 1),
              r1 = -w * (damping - term),
              r2 = -w * (damping + term),
              c1 = (velocity - r2 * displacement) / (r1 - r2),
              c2 = displacement - c1,
              first = c1 * Math.exp(r1 * dt),
              second = c2 * Math.exp(r2 * dt);
            position = x + first + second;
            speed = r1 * first + r2 * second;
          } else {
            const coeff = velocity + w * displacement,
              decay = Math.exp(-w * dt),
              term = displacement + coeff * dt;
            position = x + decay * term;
            speed = decay * (coeff - w * term);
          }
          state[0] = position;
          state[1] = speed;
          return position;
        }
        if (type === "channel_trigger") {
          let value = state[0] ?? 0,
            phase = state[1] ?? 0,
            elapsed = state[2] ?? 0,
            start = state[3] ?? 0;
          const gate = x > threshold,
            wasOn = (state[4] ?? 0) > threshold;
          if (gate && !wasOn) {
            phase = 1;
            elapsed = 0;
            start = value;
          }
          if (!gate && wasOn) {
            phase = 4;
            elapsed = 0;
            start = value;
          }
          elapsed += dt;
          if (phase === 1) {
            const duration = Math.max(0, n("attack", 0.05));
            value = duration
              ? start + (1 - start) * Math.min(1, elapsed / duration)
              : 1;
            if (elapsed >= duration) {
              phase = 2;
              elapsed = 0;
            }
          } else if (phase === 2) {
            const duration = Math.max(0, n("decay", 0.1));
            value = duration
              ? 1 + (n("sustain", 0.6) - 1) * Math.min(1, elapsed / duration)
              : n("sustain", 0.6);
            if (elapsed >= duration) {
              phase = 3;
              elapsed = 0;
            }
          } else if (phase === 3) value = n("sustain", 0.6);
          else if (phase === 4) {
            const duration = Math.max(0, n("release", 0.2));
            value = duration
              ? start * (1 - Math.min(1, elapsed / duration))
              : 0;
            if (elapsed >= duration) {
              phase = 0;
              elapsed = 0;
            }
          }
          state = [value, phase, elapsed, start, x];
          return value;
        }
        if (type === "audio_dynamics") {
          const absolute = Math.abs(x),
            tau = Math.max(
              0,
              absolute > previous ? n("attack", 0.01) : n("release", 0.1),
            ),
            envelope = tau
              ? previous + (absolute - previous) * (1 - Math.exp(-dt / tau))
              : absolute;
          const db = 20 * Math.log10(Math.max(1e-12, envelope)),
            thresholdDb = n("threshold", -18),
            ratio = Math.max(1, n("ratio", 4));
          const gainDb =
            mode === "expander"
              ? db < thresholdDb
                ? (db - thresholdDb) * (ratio - 1)
                : 0
              : db > thresholdDb
                ? (thresholdDb - db) *
                  (1 - (mode === "limiter" ? 0 : 1 / ratio))
                : 0;
          state[0] = envelope;
          return x * 10 ** ((gainDb + n("makeup")) / 20);
        }
        if (type === "audio_phaser_chop") {
          const seconds = (a.start + i) / rate,
            frequency = clamp(
              n("frequency", 700) *
                (1 +
                  Math.sin(seconds * 2 * Math.PI * n("rate", 0.5)) *
                    n("depth", 0.6)),
              0.01,
              rate * 0.49,
            ),
            tangent = Math.tan((Math.PI * frequency) / rate),
            coefficient = (tangent - 1) / (tangent + 1);
          let wet = x;
          for (let stage = 0; stage < 4; stage++) {
            const y =
              coefficient * wet +
              (state[stage * 2] ?? 0) -
              coefficient * (state[stage * 2 + 1] ?? 0);
            state[stage * 2] = wet;
            state[stage * 2 + 1] = y;
            wet = y;
          }
          return x * (1 - n("mix", 0.5)) + wet * n("mix", 0.5);
        }
        throw new Error(`没有执行器：${type}`);
      });
      memory.channels[ch.name] = state;
      return { name: ch.name, samples };
    }),
  );
}
function cookTable(
  type: string,
  p: GraphNode["data"]["params"],
  time: number,
  input: (handle?: string) => unknown,
  memory: Memory,
  context: ChannelDataContext,
  newFrame: boolean,
  nodeId: string,
): TableData | string {
  const n = (key: string, fallback = 0) => finite(p[key], fallback),
    s = (key: string, fallback = "") => String(p[key] ?? fallback),
    flag = (key: string, fallback = false) =>
      p[key] === undefined ? fallback : Boolean(p[key]);
  const value = input(),
    table = () => asTable(value),
    mode = s("mode");
  if (type === "native_text") {
    const source = isTableData(value)
      ? value.rows.map((row) => row.join(s("separator", "\t"))).join("\n")
      : textValue(value);
    return flag("append")
      ? source + s("text", "Hello TD Open")
      : source || s("text", "Hello TD Open");
  }
  if (type === "native_json") {
    const object = parse(textValue(value) || "[]"),
      keys = s("path").split(".").filter(Boolean);
    let selected: unknown = object;
    if (
      keys.some((key) =>
        ["__proto__", "prototype", "constructor"].includes(key),
      )
    )
      throw new Error("JSON 路径不允许原型属性");
    if (mode === "set") {
      const replacement = parse(s("value", "0"));
      if (!keys.length) return JSON.stringify(replacement);
      if (!object || typeof object !== "object")
        throw new Error("JSON 根节点必须为对象或数组");
      let target = object as Record<string, unknown>;
      keys.slice(0, -1).forEach((key) => {
        if (!target[key] || typeof target[key] !== "object") target[key] = {};
        target = target[key] as Record<string, unknown>;
      });
      target[keys.at(-1)!] = replacement;
      return JSON.stringify(object);
    }
    for (const key of keys) {
      if (!selected || typeof selected !== "object" || !(key in selected))
        throw new Error(`JSON 路径不存在：${key}`);
      selected = (selected as Record<string, unknown>)[key];
    }
    if (mode === "pretty") return JSON.stringify(selected, null, 2);
    if (mode === "select")
      return typeof selected === "string" ? selected : JSON.stringify(selected);
    if (Array.isArray(selected)) {
      if (selected.every(Array.isArray)) return makeTable(selected);
      if (selected.every((row) => row && typeof row === "object")) {
        const headers = [
          ...new Set(selected.flatMap((row) => Object.keys(row))),
        ];
        return makeTable([
          headers,
          ...selected.map((row) =>
            headers.map((key) => (row as Record<string, unknown>)[key]),
          ),
        ]);
      }
      return makeTable(selected.map((value, index) => [index, value]));
    }
    if (selected && typeof selected === "object")
      return makeTable([["key", "value"], ...Object.entries(selected)]);
    return makeTable([[selected]]);
  }
  if (type === "native_table")
    return makeTable(parseTableText(s("csv", "name,value\nalpha,1\nbeta,2")));
  if (type === "channels_to_dat") {
    const channels = asChannels(value),
      length = sampleCount(channels),
      rows: string[][] = flag("header", true)
        ? [channels.channels.map((ch) => ch.name)]
        : [];
    for (let i = 0; i < length; i++)
      rows.push(
        channels.channels.map((ch) =>
          Number(
            ch.samples[i].toFixed(clamp(n("precision", 6), 0, 12)),
          ).toString(),
        ),
      );
    return makeTable(rows);
  }
  if (type === "dat_null") return isTableData(value) ? value : textValue(value);
  if (type === "dat_switch") {
    const index =
        input("mod") === undefined ? n("index") : scalarValue(input("mod")),
      chosen = index >= 0.5 ? input("in2") : value;
    return isTableData(chosen) ? chosen : textValue(chosen);
  }
  if (type === "native_convert") {
    let data: TableData;
    if (isTableData(value)) data = value;
    else if (s("input_format", "csv") === "json") {
      const array = parse(textValue(value));
      if (!Array.isArray(array) || !array.every(Array.isArray))
        throw new Error("输入 JSON 必须为二维数组");
      data = makeTable(array);
    } else
      data = makeTable(
        parseTableText(
          textValue(value),
          s("input_format") === "tsv" ? "\t" : ",",
        ),
      );
    return mode === "csv"
      ? tableCSV(data)
      : mode === "tsv"
        ? data.rows
            .map((row) =>
              row
                .map((cell) => cell.replaceAll("\t", " ").replaceAll("\n", " "))
                .join("\t"),
            )
            .join("\n")
        : mode === "json"
          ? JSON.stringify(data.rows)
          : data;
  }
  if (type === "native_select") {
    const rows = table().rows.slice(n("start"), n("start") + n("length", 100)),
      indices = s("columns")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
    if (indices.some((i) => !Number.isInteger(i) || i < 0))
      throw new Error("列索引必须是非负整数");
    return makeTable(
      indices.length
        ? rows.map((row) => indices.map((i) => row[i] ?? ""))
        : rows,
    );
  }
  if (type === "native_reorder") {
    const rows = table().rows;
    if (mode === "reverse_rows") return makeTable([...rows].reverse());
    if (mode === "reverse_columns")
      return makeTable(rows.map((row) => [...row].reverse()));
    const indices = s("indices", "0,1")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (indices.some((i) => !Number.isInteger(i) || i < 0))
      throw new Error("索引必须是非负整数");
    if (mode === "columns")
      return makeTable(rows.map((row) => indices.map((i) => row[i] ?? "")));
    if (indices.some((i) => i >= rows.length))
      throw new Error("行索引超出范围");
    return makeTable(indices.map((i) => rows[i]));
  }
  if (type === "native_merge" || type === "native_insert") {
    const first = table().rows,
      second = asTable(input("in2")).rows.slice(flag("skip_header") ? 1 : 0),
      position = Math.floor(n("index", 1));
    if (mode === "columns") {
      const width = Math.max(0, ...first.map((row) => row.length)),
        otherWidth = Math.max(0, ...second.map((row) => row.length));
      return makeTable(
        Array.from(
          { length: Math.max(first.length, second.length) },
          (_, i) => {
            const row = Array.from(
                { length: width },
                (_, j) => first[i]?.[j] ?? "",
              ),
              other = Array.from(
                { length: otherWidth },
                (_, j) => second[i]?.[j] ?? "",
              );
            if (type === "native_insert") {
              row.splice(clamp(position, 0, width), 0, ...other);
              return row;
            }
            return [...row, ...other];
          },
        ),
      );
    }
    if (type === "native_merge") return makeTable([...first, ...second]);
    const rows = [...first];
    rows.splice(clamp(position, 0, first.length), 0, ...second);
    return makeTable(rows);
  }
  if (type === "native_transpose") {
    const rows = table().rows,
      width = Math.max(0, ...rows.map((row) => row.length));
    return makeTable(
      Array.from({ length: width }, (_, i) => rows.map((row) => row[i] ?? "")),
    );
  }
  if (type === "native_sort") {
    const rows = table().rows,
      header = flag("header", true) && rows.length ? [rows[0]] : [],
      body = rows.slice(header.length),
      column = n("column");
    body.sort(
      (a, b) =>
        (flag("numeric")
          ? finite(a[column]) - finite(b[column])
          : (a[column] ?? "").localeCompare(b[column] ?? "")) *
        (flag("descending") ? -1 : 1),
    );
    return makeTable([...header, ...body]);
  }
  if (type === "lookup_dat") {
    const column = n("value_column", 1),
      rows = table().rows.filter(
        (row) => row[n("key_column")] === s("key", "alpha"),
      );
    return column < 0
      ? makeTable(rows)
      : makeTable(rows.map((row) => [row[column] ?? ""]));
  }
  if (type === "native_substitute") {
    const search = s("search", "alpha");
    if (search.length > 256) throw new Error("替换模式不能超过 256 字符");
    if (!search) return table();
    // Prevent nested quantifiers/backreferences/lookbehind and reject huge inputs before RegExp.
    if (
      flag("regex") &&
      (/[\\][1-9]|\(\?<|\([^)]*[+*{][^)]*\)[+*{]/.test(search) ||
        textValue(value).length > 65536)
    )
      throw new Error("正则表达式或输入过于复杂，请分步处理");
    const expr =
      flag("regex") || !flag("case_sensitive", true)
        ? new RegExp(
            flag("regex")
              ? search
              : search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "g" + (flag("case_sensitive", true) ? "" : "i"),
          )
        : undefined;
    return makeTable(
      table().rows.map((row) =>
        row.map((cell) =>
          expr
            ? cell.replace(expr, s("replacement", "A"))
            : cell.replaceAll(search, s("replacement", "A")),
        ),
      ),
    );
  }
  if (type === "dat_info") {
    const rows = table().rows;
    return makeTable([
      ["property", "value"],
      ["rows", rows.length],
      ["columns", Math.max(0, ...rows.map((row) => row.length))],
      ["cells", rows.reduce((sum, row) => sum + row.length, 0)],
      ["characters", textValue(value).length],
      ["type", isTableData(value) ? "table" : typeof value],
    ]);
  }
  if (type === "dat_evaluate") {
    const expr = compileExpression(s("expression", "x*2+row"));
    return makeTable(
      table().rows.map((row, r) =>
        row.map((cell, c) =>
          r === 0 && flag("header", true)
            ? cell
            : expr({ x: finite(cell), row: r, col: c, r, c, t: time }),
        ),
      ),
    );
  }
  if (type === "dat_examine") {
    const target =
      typeof value === "string" && /^[\[{]/.test(value.trim())
        ? parse(value)
        : value;
    const rows: unknown[][] = [["path", "type", "value"]],
      seen = new Set<object>();
    const walk = (item: unknown, path: string, depth: number) => {
      if (rows.length >= 8192 || depth > 12) {
        rows.push([path, "truncated", "达到展开上限"]);
        return;
      }
      if (item && typeof item === "object") {
        if (seen.has(item)) {
          rows.push([path, "reference", "已展开对象"]);
          return;
        }
        seen.add(item);
        for (const [key, child] of Object.entries(item))
          walk(child, path ? `${path}.${key}` : key, depth + 1);
      } else rows.push([path, item === null ? "null" : typeof item, item]);
    };
    walk(target, "", 0);
    return makeTable(rows);
  }
  if (type === "dat_fifo") {
    const serialized = textValue(value);
    if (
      (!flag("changes_only", true) && newFrame) ||
      memory.previous !== serialized
    ) {
      memory.rows.push(...table().rows);
      memory.rows = memory.rows.slice(-Math.max(1, n("capacity", 100)));
      memory.previous = serialized;
    }
    return makeTable(memory.rows);
  }
  if (type === "dat_clip") {
    const rows = table().rows;
    if (!rows.length) return makeTable([]);
    const index =
      input("index") === undefined
        ? Math.floor(time * n("rate", 1))
        : Math.floor(scalarValue(input("index")));
    return makeTable([
      rows[
        flag("loop", true)
          ? mod(index, rows.length)
          : clamp(index, 0, rows.length - 1)
      ],
    ]);
  }
  if (type === "dat_panel_execute") {
    const scope = nodeId.includes("/")
        ? nodeId.slice(0, nodeId.lastIndexOf("/") + 1)
        : "",
      path = operatorPath(scope, s("path")),
      target = context.project?.nodes.find((item) => item.id === path);
    if (!target) throw new Error("未找到 Panel Execute 指定的组件路径");
    const keys = s("values", "value,select")
        .split(/[\s,]+/)
        .filter(Boolean),
      previous = memory.previous as Record<string, unknown> | undefined,
      next: Record<string, unknown> = {};
    for (const key of keys) {
      const value =
        key === "select"
          ? +!!scalarValue(target.data.params.value)
          : (target.data.params[key] ?? 0);
      next[key] = value;
      if (previous && previous[key] !== value) {
        const before = scalarValue(previous[key]),
          after = scalarValue(value),
          emit =
            mode === "on"
              ? before <= 0 && after > 0
              : mode === "off"
                ? before > 0 && after <= 0
                : true;
        if (emit)
          memory.rows.push([
            String(time),
            mode || "change",
            `${path}.${key}`,
            textValue(previous[key]),
            textValue(value),
          ]);
      }
    }
    memory.previous = next;
    memory.rows = memory.rows.slice(-Math.max(1, n("capacity", 64)));
    return makeTable([
      ["time", "event", "target", "before", "after"],
      ...memory.rows,
    ]);
  }
  if (type === "dat_op_find")
    return makeTable([
      ["id", "name", "type"],
      ...(context.project?.nodes ?? [])
        .filter(
          (node) =>
            (match(node.id, s("pattern", "*")) ||
              match(node.data.label, s("pattern", "*"))) &&
            match(node.type, s("type", "*")),
        )
        .map((node) => [node.id, node.data.label, node.type]),
    ]);
  if (type === "dat_parameter") {
    const node = context.project?.nodes.find(
      (node) => node.id === s("node_id"),
    );
    if (!node) throw new Error("没有找到指定节点 ID");
    return makeTable([
      ["parameter", "value", "type"],
      ...Object.entries(node.data.params).map(([key, value]) => [
        key,
        value,
        typeof value,
      ]),
    ]);
  }
  if (type === "dat_perform")
    return makeTable([
      ["property", "value"],
      ["nodes", context.project?.nodes.length ?? 0],
      ["edges", context.project?.edges.length ?? 0],
      ["time", time],
      ["executions", memory.count],
    ]);
  if (type === "dat_error") {
    const rows = table().rows,
      reports: unknown[][] = [["row", "column", "issue"]],
      width = rows[0]?.length ?? 0;
    rows.forEach((row, r) => {
      if (row.length !== width) reports.push([r, -1, "列数与首行不同"]);
      row.forEach((cell, c) => {
        if (!cell) reports.push([r, c, "空单元格"]);
        if (flag("header", true) && !r && row.indexOf(cell) !== c)
          reports.push([r, c, "重复表头"]);
        if (
          flag("numeric") &&
          !(flag("header", true) && !r) &&
          cell &&
          !Number.isFinite(Number(cell))
        )
          reports.push([r, c, "不是数字"]);
      });
    });
    return makeTable(reports);
  }
  if (
    [
      "dat_execute",
      "dat_chop_execute",
      "dat_dat_execute",
      "dat_op_execute",
      "dat_parameter_execute",
      "dat_pargroup_execute",
    ].includes(type)
  ) {
    const events: unknown[][] = [],
      add = (event: string, target: string, before: unknown, after: unknown) =>
        events.push([time, event, target, textValue(before), textValue(after)]);
    if (type === "dat_execute" && newFrame)
      add("frame", "timeline", memory.priorTime ?? "", time);
    if (type === "dat_chop_execute") {
      const channels = asChannels(value),
        previous = (memory.previous ?? Object.create(null)) as Record<
          string,
          number
        >,
        next: Record<string, number> = Object.create(null);
      for (const ch of channels.channels) {
        let old = previous[ch.name] ?? 0;
        for (const x of ch.samples) {
          const changed =
            mode === "rising"
              ? x > n("threshold", 0.5) && old <= n("threshold", 0.5)
              : mode === "falling"
                ? x <= n("threshold", 0.5) && old > n("threshold", 0.5)
                : x !== old;
          if (changed) add(mode || "change", ch.name, old, x);
          old = x;
        }
        next[ch.name] = old;
      }
      memory.previous = next;
    } else if (type === "dat_dat_execute") {
      const rows = table().rows,
        previous = memory.previous as string[][] | undefined;
      if (previous)
        for (let r = 0; r < Math.max(rows.length, previous.length); r++)
          for (
            let c = 0;
            c < Math.max(rows[r]?.length ?? 0, previous[r]?.length ?? 0);
            c++
          )
            if (rows[r]?.[c] !== previous[r]?.[c])
              add("cell_change", `${r},${c}`, previous[r]?.[c], rows[r]?.[c]);
      memory.previous = rows.map((row) => [...row]);
    } else if (type === "dat_op_execute") {
      const next = Object.fromEntries(
          (context.project?.nodes ?? []).map((node) => [node.id, node.type]),
        ),
        previous = memory.previous as Record<string, string> | undefined;
      if (previous) {
        for (const [id, value] of Object.entries(next))
          if (previous[id] !== value)
            add(
              previous[id] === undefined ? "node_added" : "type_changed",
              id,
              previous[id],
              value,
            );
        for (const id of Object.keys(previous))
          if (!(id in next)) add("node_removed", id, previous[id], "");
      }
      memory.previous = next;
    } else if (
      type === "dat_parameter_execute" ||
      type === "dat_pargroup_execute"
    ) {
      const node = context.project?.nodes.find(
        (node) => node.id === s("node_id"),
      );
      if (!node) throw new Error("没有找到指定节点 ID");
      const keys =
          type === "dat_pargroup_execute"
            ? s("parameters", "x,y,z")
                .split(/[\s,]+/)
                .filter(Boolean)
            : s("parameter")
              ? [s("parameter")]
              : Object.keys(node.data.params),
        next = Object.fromEntries(
          keys.map((key) => [key, node.data.params[key]]),
        ),
        previous = memory.previous as Record<string, unknown> | undefined;
      if (
        previous &&
        type === "dat_pargroup_execute" &&
        JSON.stringify(previous) !== JSON.stringify(next)
      )
        add("group_change", node.id, previous, next);
      else if (previous && type === "dat_parameter_execute")
        for (const [key, value] of Object.entries(next))
          if (previous[key] !== value)
            add("parameter_change", `${node.id}.${key}`, previous[key], value);
      memory.previous = next;
    }
    memory.rows.push(...makeTable(events).rows);
    memory.rows = memory.rows.slice(-Math.max(1, n("capacity", 64)));
    return makeTable([
      ["time", "event", "target", "before", "after"],
      ...memory.rows,
    ]);
  }
  if (type === "dat_script") {
    const program = parse(s("program", "[]"));
    if (!Array.isArray(program) || program.length > 32)
      throw new Error("表格脚本需要最多 32 步 JSON 操作数组");
    let rows = table().rows.map((row) => [...row]);
    for (const step of program) {
      if (!step || typeof step !== "object")
        throw new Error("每步必须为操作对象");
      if (step.op === "select") {
        if (
          !Array.isArray(step.columns) ||
          !step.columns.every(
            (v: unknown) => Number.isInteger(v) && Number(v) >= 0,
          )
        )
          throw new Error("select.columns 必须是非负整数数组");
        rows = rows.map((row) => step.columns.map((c: number) => row[c] ?? ""));
      } else if (step.op === "filter") {
        const expr = compileExpression(String(step.expression ?? "x")),
          column = Number(step.column ?? 0);
        rows = rows.filter(
          (row, r) =>
            !!expr({ x: finite(row[column]), row: r, col: column, t: time }),
        );
      } else if (step.op === "map") {
        const expr = compileExpression(String(step.expression ?? "x"));
        rows = rows.map((row, r) =>
          row.map((cell, c) =>
            String(expr({ x: finite(cell), row: r, col: c, t: time })),
          ),
        );
      } else if (step.op === "sort") {
        const column = Number(step.column ?? 0);
        rows.sort((a, b) =>
          step.numeric
            ? finite(a[column]) - finite(b[column])
            : (a[column] ?? "").localeCompare(b[column] ?? ""),
        );
      } else if (step.op === "slice")
        rows = rows.slice(
          Number(step.start ?? 0),
          step.end === undefined ? undefined : Number(step.end),
        );
      else throw new Error(`不支持的表格脚本操作：${step.op}`);
    }
    return makeTable(rows);
  }
  if (type === "xml_dat") {
    const xml = textValue(value) || s("xml", "<scene><item>1</item></scene>");
    if (xml.length > 262144 || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("XML 不允许 DTD、实体声明或超过 262144 字符");
    if (typeof DOMParser === "undefined")
      throw new Error("XML 解析需要浏览器 DOMParser");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror"))
      throw new Error("XML 文本解析失败");
    const rows: unknown[][] = [["path", "tag", "attributes", "text"]];
    const walk = (element: Element, path: string, depth: number) => {
      if (depth > 64 || rows.length > 8192)
        throw new Error("XML 层级或元素数量超过限制");
      if (!s("tag") || element.tagName === s("tag"))
        rows.push([
          path,
          element.tagName,
          JSON.stringify(
            Object.fromEntries(
              Array.from(element.attributes).map((attr) => [
                attr.name,
                attr.value,
              ]),
            ),
          ),
          Array.from(element.childNodes)
            .filter((node) => node.nodeType === 3 || node.nodeType === 4)
            .map((node) => node.textContent ?? "")
            .join("")
            .trim(),
        ]);
      const counts: Record<string, number> = {};
      Array.from(element.children).forEach((child) =>
        walk(
          child,
          `${path}/${child.tagName}[${(counts[child.tagName] = (counts[child.tagName] ?? 0) + 1)}]`,
          depth + 1,
        ),
      );
    };
    walk(
      document.documentElement,
      `/${document.documentElement.tagName}[1]`,
      0,
    );
    return makeTable(rows);
  }
  throw new Error(`尚未实现数据执行器：${type}`);
}
