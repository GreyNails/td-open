import type { GraphNode } from "../types";
import { advancedDataCatalog } from "./advancedDataCatalog";
import { parseCSV } from "./dataRuntime";
import {
  isGeometrySpec,
  validateGeometrySpec,
  type GeometrySpec,
  type Vec3,
} from "./geometry";

type Result =
  { handled: false } | { handled: true; value: number | string | GeometrySpec };
const supported = new Set(advancedDataCatalog.map((n) => n.type));
export const advancedTemporalTypes = new Set([
  "spring",
  "delay_chop",
  "moving_average",
  "peak_chop",
  "rms_chop",
  "adsr",
  "hysteresis",
  "random_hold",
  "timer_chop",
  "slew_chop",
]);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mod = (x: number, p: number) => ((x % p) + p) % p;
const finite = (v: unknown, d = 0) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() && Number.isFinite(Number(v))
      ? Number(v)
      : d;
const hash = (x: number, seed: number) =>
  mod(Math.sin(x * 127.1 + seed * 311.7) * 43758.5453123, 1);
type Memory = {
  signature: string;
  time: number;
  value: number;
  velocity: number;
  previous: number;
  count: number;
  started?: number;
  released?: number;
  releaseValue: number;
  attackValue: number;
  samples: [number, number][];
};
const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("输入不是有效的 JSON 文本");
  }
};
const array = (text: string) => {
  const x = parse(text);
  if (!Array.isArray(x)) throw new Error("输入必须是 JSON 数组");
  return x as unknown[];
};
const object = (text: string) => {
  const x = parse(text);
  if (!x || Array.isArray(x) || typeof x !== "object")
    throw new Error("输入必须是 JSON 对象");
  return x as Record<string, unknown>;
};
const display = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);
const csv = (rows: unknown[][]) =>
  rows
    .map((row) =>
      row
        .map((v) => {
          const s = String(v ?? "");
          return /[,"\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
        })
        .join(","),
    )
    .join("\n");
const cmp = (a: unknown, b: unknown, numeric: boolean) =>
  numeric
    ? finite(a) - finite(b)
    : display(a) < display(b)
      ? -1
      : display(a) > display(b)
        ? 1
        : 0;
function points(value: string, dimensions: 2 | 3): number[][] {
  const rows = array(value);
  if (
    rows.length < 2 ||
    rows.length > 512 ||
    !rows.every(
      (row) =>
        Array.isArray(row) &&
        row.length === dimensions &&
        row.every((x) => typeof x === "number" && Number.isFinite(x)),
    )
  )
    throw new Error(`需要 2–512 个 ${dimensions} 维有限坐标点`);
  return rows as number[][];
}

export function cookAdvancedDataNode(
  node: GraphNode,
  time: number,
  input: (handle?: string) => unknown,
  state: Map<string, unknown>,
): Result {
  const type = node.type;
  if (!supported.has(type)) return { handled: false };
  const p = node.data.params,
    n = (k: string, d = 0) => finite(p[k], d),
    s = (k: string, d = "") => String(p[k] ?? d),
    a = () => finite(input()),
    b = () => finite(input("in2")),
    text = (handle = "in", fallback = "") =>
      typeof input(handle) === "string" ? (input(handle) as string) : fallback;
  const result = (value: number | string | GeometrySpec): Result => {
    if (typeof value === "object") validateGeometrySpec(value);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("运算结果不是有限数值");
    return { handled: true, value };
  };
  if (advancedTemporalTypes.has(type)) {
    const signature = JSON.stringify([type, p]),
      saved = state.get(node.id) as Memory | undefined;
    const fresh = !saved || saved.signature !== signature || time < saved.time;
    const x = a(),
      m: Memory = fresh
        ? {
            signature,
            time,
            value: ["spring", "slew_chop"].includes(type) ? x : 0,
            velocity: 0,
            previous: 0,
            count: 0,
            releaseValue: 0,
            attackValue: 0,
            samples: [],
          }
        : saved;
    const dt = fresh ? 0 : Math.max(0, time - m.time),
      threshold = n("threshold", 0.5),
      on = x > threshold,
      wasOn = m.previous > threshold,
      rising = on && !wasOn;
    if (type === "spring") {
      // Exact damped oscillator integration with a constant target over this frame.
      // It stays stable at all advertised frequency/damping settings and long frame gaps.
      const w = 2 * Math.PI * Math.max(0.0001, n("frequency", 2)),
        damping = Math.max(0, n("damping", 0.45)),
        displacement = m.value - x,
        velocity = m.velocity;
      if (damping < 1 - 1e-6) {
        const wd = w * Math.sqrt(1 - damping * damping),
          decay = Math.exp(-damping * w * dt),
          sine = Math.sin(wd * dt),
          cosine = Math.cos(wd * dt),
          coefficient = (velocity + damping * w * displacement) / wd,
          position = displacement * cosine + coefficient * sine;
        m.value = x + decay * position;
        m.velocity =
          decay *
          (-damping * w * position -
            displacement * wd * sine +
            coefficient * wd * cosine);
      } else if (damping > 1 + 1e-6) {
        const term = Math.sqrt(damping * damping - 1),
          r1 = -w * (damping - term),
          r2 = -w * (damping + term),
          c1 = (velocity - r2 * displacement) / (r1 - r2),
          c2 = displacement - c1,
          first = c1 * Math.exp(r1 * dt),
          second = c2 * Math.exp(r2 * dt);
        m.value = x + first + second;
        m.velocity = r1 * first + r2 * second;
      } else {
        const coefficient = velocity + w * displacement,
          decay = Math.exp(-w * dt),
          position = displacement + coefficient * dt;
        m.value = x + decay * position;
        m.velocity = decay * (coefficient - w * position);
      }
    } else if (type === "slew_chop")
      m.value += clamp(
        x - m.value,
        -Math.max(0, n("fall", 1)) * dt,
        Math.max(0, n("rise", 1)) * dt,
      );
    else if (
      ["delay_chop", "moving_average", "peak_chop", "rms_chop"].includes(type)
    ) {
      if (m.samples.at(-1)?.[0] === time)
        m.samples[m.samples.length - 1] = [time, x];
      else m.samples.push([time, x]);
      const window =
        type === "delay_chop"
          ? Math.max(0, n("delay", 0.5))
          : Math.max(0.001, n("window", 1));
      while (m.samples.length > 2 && m.samples[1][0] < time - window)
        m.samples.shift();
      if (m.samples.length > 4096) m.samples.splice(0, m.samples.length - 4096);
      if (type === "delay_chop") {
        const target = time - window,
          first = m.samples[0];
        if (target < first[0]) m.value = n("initial");
        else {
          let left = first,
            right = first;
          for (const sample of m.samples) {
            right = sample;
            if (sample[0] >= target) break;
            left = sample;
          }
          m.value =
            right[0] === left[0]
              ? left[1]
              : left[1] +
                ((right[1] - left[1]) * (target - left[0])) /
                  (right[0] - left[0]);
        }
      } else {
        const values = m.samples
          .filter(([t]) => t >= time - window)
          .map(([, v]) => v);
        m.value =
          type === "moving_average"
            ? values.reduce((sum, v) => sum + v, 0) / values.length
            : type === "peak_chop"
              ? Math.max(...values.map(Math.abs))
              : Math.sqrt(
                  values.reduce((sum, v) => sum + v * v, 0) / values.length,
                );
      }
    } else if (type === "hysteresis") {
      const low = Math.min(n("low", 0.3), n("high", 0.7)),
        high = Math.max(n("low", 0.3), n("high", 0.7));
      if (x >= high) m.value = 1;
      else if (x <= low) m.value = 0;
    } else if (type === "random_hold") {
      if (fresh) m.value = n("min");
      if (rising) {
        m.count++;
        m.value =
          n("min") + hash(m.count, n("seed", 1)) * (n("max", 1) - n("min"));
      }
    } else if (type === "timer_chop") {
      if (rising) m.started = time;
      const duration = Math.max(0.001, n("duration", 2)),
        elapsed = m.started === undefined ? 0 : Math.max(0, time - m.started);
      m.value = p.loop ? mod(elapsed, duration) : Math.min(elapsed, duration);
      if (s("output", "progress") === "progress") m.value /= duration;
    } else if (type === "adsr") {
      const attack = Math.max(0, n("attack", 0.1)),
        decay = Math.max(0, n("decay", 0.2)),
        sustain = clamp(n("sustain", 0.6), 0, 1),
        release = Math.max(0, n("release", 0.4));
      if (rising) {
        m.started = time;
        m.attackValue = m.value;
        m.released = undefined;
      }
      const held = (now: number) => {
        const elapsed = Math.max(0, now - (m.started ?? now));
        return elapsed < attack
          ? m.attackValue + ((1 - m.attackValue) * elapsed) / attack
          : elapsed < attack + decay
            ? 1 + ((sustain - 1) * (elapsed - attack)) / decay
            : sustain;
      };
      if (!on && wasOn) {
        m.releaseValue = held(time);
        m.released = time;
      }
      m.value =
        on && m.started !== undefined
          ? held(time)
          : m.released !== undefined && release > 0
            ? m.releaseValue * Math.max(0, 1 - (time - m.released) / release)
            : 0;
    }
    m.previous = x;
    m.time = time;
    state.set(node.id, m);
    return result(m.value);
  }
  switch (type) {
    case "weighted_sum":
      return result(
        a() * n("weight1", 1) +
          b() * n("weight2", 0.5) +
          finite(input("in3")) * n("weight3", 0.25) +
          n("offset"),
      );
    case "function_chop": {
      const x = a(),
        functions: Record<string, () => number> = {
          power: () => Math.pow(x, n("exponent", 2)),
          sqrt: () => Math.sqrt(x),
          log: () => Math.log(x),
          exp: () => Math.exp(x),
          cos: () => Math.cos(x),
          tan: () => Math.tan(x),
          asin: () => Math.asin(x),
          acos: () => Math.acos(x),
          atan: () => Math.atan(x),
          tanh: () => Math.tanh(x),
        };
      const fn = functions[s("function", "power")];
      if (!fn) throw new Error("未知数值函数");
      return result(fn());
    }
    case "atan2":
      return result(
        Math.atan2(a(), b()) *
          (s("unit", "degrees") === "degrees" ? 180 / Math.PI : 1),
      );
    case "mix_chop": {
      let v = finite(input("mod"), n("mix", 0.5));
      if (p.clamp ?? true) v = clamp(v, 0, 1);
      return result(a() + (b() - a()) * v);
    }
    case "ease_chop": {
      const x = clamp(a(), 0, 1),
        curve = s("curve", "sine");
      const bounce = (t: number) => {
        const c = 7.5625,
          d = 2.75;
        if (t < 1 / d) return c * t * t;
        if (t < 2 / d) return c * (t -= 1.5 / d) * t + 0.75;
        if (t < 2.5 / d) return c * (t -= 2.25 / d) * t + 0.9375;
        return c * (t -= 2.625 / d) * t + 0.984375;
      };
      const f = (t: number) =>
        curve === "quadratic"
          ? t * t
          : curve === "cubic"
            ? t * t * t
            : curve === "bounce"
              ? 1 - bounce(1 - t)
              : 1 - Math.cos((t * Math.PI) / 2);
      return result(
        s("direction", "in_out") === "in"
          ? f(x)
          : s("direction") === "out"
            ? 1 - f(1 - x)
            : x < 0.5
              ? f(2 * x) / 2
              : 1 - f(2 - 2 * x) / 2,
      );
    }
    case "smoothstep": {
      const span = n("edge1", 1) - n("edge0");
      if (!span) throw new Error("两个阈值不能相同");
      const x = clamp((a() - n("edge0")) / span, 0, 1);
      return result(
        p.smoother ? x * x * x * (x * (x * 6 - 15) + 10) : x * x * (3 - 2 * x),
      );
    }
    case "angle_wrap":
      return result(
        n("start", -180) +
          mod(
            a() - n("start", -180),
            Math.max(0.001, Math.abs(n("period", 360))),
          ),
      );
    case "angle_distance": {
      const period = Math.max(0.001, Math.abs(n("period", 360)));
      return result(mod(b() - a() + period / 2, period) - period / 2);
    }
    case "sequence_chop": {
      const values = s("values", "0,1,0.25,0.75")
        .split(",")
        .map((v) => Number(v.trim()));
      if (
        !values.length ||
        values.length > 4096 ||
        values.some((v) => !Number.isFinite(v))
      )
        throw new Error("请输入逗号分隔的有限数值序列");
      const phase = mod(time * n("rate", 2), values.length),
        index = Math.floor(phase);
      return result(
        s("mode", "step") === "linear"
          ? values[index] +
              (values[(index + 1) % values.length] - values[index]) *
                (phase - index)
          : values[index],
      );
    }
    case "gaussian_chop":
      return result(
        n("amplitude", 1) *
          Math.exp(
            -0.5 *
              Math.pow(
                (a() - n("center")) / Math.max(0.001, Math.abs(n("sigma", 1))),
                2,
              ),
          ),
      );
    case "exponential_chop":
      return result(
        n("amplitude", 1) *
          Math.exp(-Math.max(0, n("decay", 2)) * Math.max(0, a())),
      );
    case "damped_wave": {
      const t =
        n("repeat", 3) > 0 ? mod(time, n("repeat", 3)) : Math.max(0, time);
      return result(
        Math.sin(t * n("frequency", 3) * Math.PI * 2) *
          Math.exp(-t * n("decay", 1)) *
          n("amplitude", 1),
      );
    }
    case "text_length":
      return result(
        s("mode", "characters") === "lines"
          ? text().split(/\r?\n/).length
          : s("mode") === "words"
            ? text().trim()
              ? text().trim().split(/\s+/).length
              : 0
            : Array.from(text()).length,
      );
    case "substring_dat": {
      const chars = Array.from(text()),
        start =
          n("start") < 0
            ? Math.max(0, chars.length + Math.trunc(n("start")))
            : Math.trunc(n("start"));
      return result(
        chars
          .slice(start, start + Math.max(0, Math.trunc(n("length", 10))))
          .join(""),
      );
    }
    case "pad_dat": {
      const chars = Array.from(text()),
        fill = Array.from(s("fill", "0")),
        count = clamp(Math.trunc(n("length", 8)) - chars.length, 0, 10000),
        padding = fill.length
          ? Array.from({ length: count }, (_, i) => fill[i % fill.length]).join(
              "",
            )
          : "";
      return result(
        s("side", "left") === "left" ? padding + text() : text() + padding,
      );
    }
    case "format_dat":
      return result(
        s("template", "第一路：{in}\n第二路：{in2}").replace(
          /\{in2?\}/g,
          (match) => text(match === "{in}" ? "in" : "in2"),
        ),
      );
    case "encode_dat": {
      const value = text(),
        mode = s("mode", "base64_encode");
      try {
        if (mode === "url_encode") return result(encodeURIComponent(value));
        if (mode === "url_decode") return result(decodeURIComponent(value));
        if (mode === "base64_encode")
          return result(
            btoa(
              Array.from(new TextEncoder().encode(value), (v) =>
                String.fromCharCode(v),
              ).join(""),
            ),
          );
        return result(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
          ),
        );
      } catch {
        throw new Error("输入不是有效的编码文本");
      }
    }
    case "sort_dat":
    case "unique_dat": {
      const format = s("format", "lines"),
        values = format === "json" ? array(text()) : text().split(/\r?\n/);
      const seen = new Set<string>();
      const output =
        type === "sort_dat"
          ? [...values].sort(
              (a, b) => cmp(a, b, Boolean(p.numeric)) * (p.descending ? -1 : 1),
            )
          : values.filter((value) => {
              const key = JSON.stringify(value);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
      return result(
        format === "json" ? JSON.stringify(output) : output.join("\n"),
      );
    }
    case "filter_dat": {
      const query = s("query", "a"),
        mode = s("mode", "contains");
      return result(
        text()
          .split(/\r?\n/)
          .filter((line) => {
            const match =
              mode === "starts"
                ? line.startsWith(query)
                : mode === "ends"
                  ? line.endsWith(query)
                  : line.includes(query);
            return p.invert ? !match : match;
          })
          .join("\n"),
      );
    }
    case "join_dat":
      return result(array(text()).map(display).join(s("separator", ", ")));
    case "json_merge":
      return result(
        JSON.stringify({ ...object(text()), ...object(text("in2", "{}")) }),
      );
    case "json_set": {
      const value = parse(text()),
        path = s("path", "settings.amount").split(".");
      if (
        !value ||
        typeof value !== "object" ||
        path.some(
          (key) =>
            !key || ["__proto__", "prototype", "constructor"].includes(key),
        )
      )
        throw new Error("JSON 路径无效或包含保留键");
      const indexCheck = (target: unknown, key: string) => {
        if (
          Array.isArray(target) &&
          (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > 10000)
        )
          throw new Error("数组索引必须为 0–10000 的整数");
      };
      let target = value;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        indexCheck(target, key);
        if (
          !Object.hasOwn(target, key) ||
          !target[key] ||
          typeof target[key] !== "object"
        )
          target[key] = /^\d+$/.test(path[i + 1]) ? [] : {};
        target = target[key];
      }
      let next: unknown;
      try {
        next = JSON.parse(s("value", "1"));
      } catch {
        next = s("value", "1");
      }
      indexCheck(target, path.at(-1)!);
      target[path.at(-1)!] = next;
      return result(JSON.stringify(value));
    }
    case "json_keys": {
      const obj = object(text());
      return result(
        JSON.stringify(
          s("mode", "keys") === "keys"
            ? Object.keys(obj)
            : s("mode") === "values"
              ? Object.values(obj)
              : Object.entries(obj),
        ),
      );
    }
    case "table_transpose": {
      const rows = parseCSV(text()),
        width = Math.max(...rows.map((r) => r.length));
      return result(
        csv(
          Array.from({ length: width }, (_, i) =>
            rows.map((row) => row[i] ?? ""),
          ),
        ),
      );
    }
    case "table_select": {
      const rows = parseCSV(text()).slice(
        Math.max(0, Math.trunc(n("start"))),
        Math.max(0, Math.trunc(n("start"))) +
          Math.max(0, Math.trunc(n("count", 10))),
      );
      const columns = s("columns").trim()
        ? s("columns")
            .split(",")
            .map((v) => Number(v.trim()))
        : null;
      if (columns?.some((v) => !Number.isInteger(v) || v < 0))
        throw new Error("列索引必须是非负整数");
      return result(
        csv(
          columns ? rows.map((row) => columns.map((i) => row[i] ?? "")) : rows,
        ),
      );
    }
    case "table_sort": {
      const rows = parseCSV(text()),
        head = (p.header ?? true) ? rows.shift() : undefined,
        col = Math.max(0, Math.trunc(n("column", 1)));
      rows.sort(
        (a, b) =>
          cmp(a[col] ?? "", b[col] ?? "", Boolean(p.numeric ?? true)) *
          (p.descending ? -1 : 1),
      );
      return result(csv(head ? [head, ...rows] : rows));
    }
    case "table_merge": {
      const rows = parseCSV(text()),
        second = parseCSV(text("in2"));
      return result(
        csv(
          s("axis", "rows") === "rows"
            ? [...rows, ...second.slice((p.skip_header ?? true) ? 1 : 0)]
            : Array.from(
                { length: Math.max(rows.length, second.length) },
                (_, i) => [
                  ...(rows[i] ??
                    Array(Math.max(...rows.map((r) => r.length))).fill("")),
                  ...(second[i] ?? []),
                ],
              ),
        ),
      );
    }
    case "table_to_json": {
      const [header, ...rows] = parseCSV(text());
      if (new Set(header).size !== header.length)
        throw new Error("表头名称不能重复");
      return result(
        JSON.stringify(
          rows.map((row) =>
            Object.fromEntries(
              header.map((key, i) => {
                const value = row[i] ?? "";
                return [
                  key,
                  (p.numeric ?? true) &&
                  value.trim() &&
                  Number.isFinite(Number(value))
                    ? Number(value)
                    : value,
                ];
              }),
            ),
          ),
        ),
      );
    }
    case "chop_to_dat":
      return result(
        s("prefix") +
          a().toFixed(clamp(Math.trunc(n("digits", 2)), 0, 12)) +
          s("suffix"),
      );
  }
  const source = input(),
    children = isGeometrySpec(source) ? [source] : [],
    detail = clamp(Math.round(n("detail", 48)), 4, 128);
  const group = (items: GeometrySpec[]): GeometrySpec => ({
    shape: "group",
    detail: 0,
    children: items,
  });
  const wrapper = (
    position: Vec3 = [0, 0, 0],
    rotation: Vec3 = [0, 0, 0],
    scale: Vec3 = [1, 1, 1],
  ): GeometrySpec => ({ ...group(children), position, rotation, scale });
  switch (type) {
    case "platonic_sop":
      return result({
        shape: s("solid", "icosahedron"),
        detail: clamp(n("subdivision"), 0, 4),
        radius: n("radius", 1),
      });
    case "capsule":
      return result({
        shape: "capsule",
        detail,
        radius: n("radius", 0.5),
        height: n("height", 1),
      });
    case "ring_sop":
      return result({
        shape: "ring",
        detail,
        inner: n("inner", 0.5),
        radius: n("outer", 1),
      });
    case "tube_sop":
      return result({
        shape: "tube",
        detail,
        points: points(s("points", "[[-1,-1,0],[0,1,0],[1,-1,0]]"), 3),
        tube: n("tube", 0.12),
        segments: n("segments", 12),
        closed: Boolean(p.closed),
      });
    case "lathe_sop":
      return result({
        shape: "lathe",
        detail,
        points: points(
          s("points", "[[0,-1],[0.7,-0.8],[0.35,0],[0.8,0.8],[0.6,1]]"),
          2,
        ),
        angle: n("angle", 360),
      });
    case "extrude_sop":
      return result({
        shape: "extrude",
        detail: 1,
        points: points(s("points", "[[-1,-0.7],[1,-0.7],[0,1]]"), 2),
        depth: n("depth", 0.4),
        bevel: n("bevel", 0.05),
      });
    case "helix_sop":
      return result({
        shape: "helix",
        detail,
        radius: n("radius", 1),
        height: n("height", 3),
        turns: n("turns", 3),
        tube: n("tube", 0.08),
        segments: n("segments", 12),
      });
    case "torus_knot":
      return result({
        shape: "torus_knot",
        detail,
        radius: n("radius", 1),
        tube: n("tube", 0.18),
        p: n("p", 2),
        q: n("q", 3),
        segments: n("segments", 12),
      });
    case "grid_sop": {
      const rows = clamp(Math.floor(n("rows", 8)), 1, 64),
        cols = clamp(Math.floor(n("columns", 8)), 1, 64),
        spacing = n("spacing", 0.35),
        width = n("width", 0.015),
        items: GeometrySpec[] = [];
      for (let i = 0; i <= rows; i++)
        items.push({
          shape: "line",
          detail: 8,
          width,
          start: [(-cols * spacing) / 2, 0, (i - rows / 2) * spacing],
          end: [(cols * spacing) / 2, 0, (i - rows / 2) * spacing],
        });
      for (let i = 0; i <= cols; i++)
        items.push({
          shape: "line",
          detail: 8,
          width,
          start: [(i - cols / 2) * spacing, 0, (-rows * spacing) / 2],
          end: [(i - cols / 2) * spacing, 0, (rows * spacing) / 2],
        });
      return result(group(items));
    }
    case "copy_sop": {
      const count = clamp(Math.floor(n("count", 5)), 1, 128);
      return result(
        group(
          Array.from({ length: count }, (_, i) => {
            const scale = Math.pow(n("scale", 0.9), i);
            return wrapper(
              [
                n("x", 0.6) * (i - (count - 1) / 2),
                n("y") * (i - (count - 1) / 2),
                n("z") * (i - (count - 1) / 2),
              ],
              [0, n("rotation", 20) * i, 0],
              [scale, scale, scale],
            );
          }),
        ),
      );
    }
    case "radial_copy": {
      const count = clamp(Math.floor(n("count", 12)), 1, 128),
        radius = n("radius", 2),
        angle = n("angle", 360);
      return result(
        group(
          Array.from({ length: count }, (_, i) => {
            const theta =
              ((i / (angle === 360 ? count : Math.max(1, count - 1))) *
                angle *
                Math.PI) /
              180;
            return wrapper(
              [Math.sin(theta) * radius, 0, Math.cos(theta) * radius],
              [0, (p.orient ?? true) ? (theta * 180) / Math.PI : 0, 0],
            );
          }),
        ),
      );
    }
    case "scatter_sop":
      return result(
        group(
          Array.from(
            { length: clamp(Math.floor(n("count", 30)), 1, 128) },
            (_, i) => {
              const seed = n("seed", 1),
                scale =
                  n("scale_min", 0.15) +
                  hash(i * 5 + 3, seed) *
                    (n("scale_max", 0.5) - n("scale_min", 0.15));
              return wrapper(
                [
                  (hash(i * 5, seed) - 0.5) * n("width", 4),
                  (hash(i * 5 + 1, seed) - 0.5) * n("height", 4),
                  (hash(i * 5 + 2, seed) - 0.5) * n("depth", 4),
                ],
                [0, hash(i * 5 + 4, seed) * 360, 0],
                [scale, scale, scale],
              );
            },
          ),
        ),
      );
    case "twist_sop":
    case "taper_sop":
    case "wave_sop":
    case "noise_sop":
      return result({
        shape: "deform",
        detail: 0,
        children,
        modifier: {
          kind: type,
          amount:
            n("amount", type === "twist_sop" ? 90 : 0.4) + finite(input("mod")),
          amplitude:
            n("amplitude", type === "wave_sop" ? 0.25 : 0.2) +
            finite(input("mod")),
          frequency: n("frequency", 2),
          phase: time * n("speed", 1),
          seed: n("seed", 1),
        },
      });
    case "mirror_sop": {
      const scale: Vec3 = [1, 1, 1];
      scale[({ x: 0, y: 1, z: 2 } as Record<string, number>)[s("axis", "x")]] =
        -1;
      return result(
        group([
          ...((p.keep ?? true) ? children : []),
          wrapper([0, 0, 0], [0, 0, 0], scale),
        ]),
      );
    }
    case "wireframe_sop":
      return result({
        shape: "wireframe",
        detail: 0,
        children,
        mode: s("mode", "edges"),
        threshold: n("threshold", 20),
      });
    case "bounds_sop":
      return result({
        shape: "bounds",
        detail: 0,
        children,
        wireframe: Boolean(p.wireframe ?? true),
      });
  }
  return { handled: false };
}
