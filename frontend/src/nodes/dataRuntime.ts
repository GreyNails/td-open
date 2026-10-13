import type { GraphNode } from "../types";
import { dataCatalog } from "./dataCatalog";
import { isGeometrySpec, type GeometrySpec } from "./geometry";

type Result =
  { handled: false } | { handled: true; value: number | string | GeometrySpec };
type Memory = {
  signature: string;
  time: number;
  value: number;
  previous: number;
  startedAt?: number;
};
const supported = new Set(dataCatalog.map((entry) => entry.type));
const temporal = new Set([
  "lag",
  "speed",
  "counter",
  "trigger",
  "derivative",
  "hold",
]);
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const modulo = (value: number, period: number) =>
  ((value % period) + period) % period;
const finite = (value: unknown, fallback = 0): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Minimal RFC 4180 CSV reader: quotes, escaped quotes, CRLF, and multiline cells. */
export function parseCSV(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ",") pushCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      pushCell();
      rows.push(row);
      row = [];
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed) throw new Error("CSV 引号结束后应为逗号或换行");
    else cell += char;
  }
  if (quoted) throw new Error("CSV 中存在未闭合的引号");
  if (cell || row.length || closed || !rows.length) {
    pushCell();
    rows.push(row);
  }
  return rows;
}

/** Pure numbers/text/geometry; temporal operators keep one bounded record per node. */
export function cookDataNode(
  node: GraphNode,
  time: number,
  input: (handle?: string) => unknown,
  state: Map<string, unknown>,
): Result {
  const type = node.type;
  if (!supported.has(type)) return { handled: false };
  const p = node.data.params;
  const n = (key: string, fallback = 0) => finite(p[key], fallback);
  const s = (key: string, fallback = "") => String(p[key] ?? fallback);
  const a = () => finite(input());
  const text = (fallback = "") => {
    const source = input();
    return typeof source === "string" ? source : fallback;
  };
  const result = (value: number | string | GeometrySpec): Result => ({
    handled: true,
    value,
  });

  if (temporal.has(type)) {
    const signature = JSON.stringify([type, p]);
    const saved = state.get(node.id) as Memory | undefined;
    const fresh = !saved || saved.signature !== signature || time < saved.time;
    const value = a();
    const memory: Memory = fresh
      ? {
          signature,
          time,
          value: type === "lag" ? value : n("initial"),
          previous: 0,
        }
      : saved;
    const dt = fresh ? 0 : Math.max(0, time - memory.time);
    const gate = type === "hold" ? finite(input("in2")) : value;
    const threshold = n("threshold", 0.5);
    const rising = gate > threshold && memory.previous <= threshold;
    switch (type) {
      case "lag": {
        const duration = n(
          value >= memory.value ? "rise" : "fall",
          value >= memory.value ? 0.2 : 0.5,
        );
        memory.value =
          duration <= 0
            ? value
            : memory.value +
              (value - memory.value) * (1 - Math.exp(-dt / duration));
        break;
      }
      case "speed":
        if (!fresh)
          memory.value += ((value + memory.previous) / 2) * dt * n("scale", 1);
        break;
      case "counter":
        if (rising) {
          memory.value += n("step", 1);
          if (p.wrap) {
            const initial = n("initial"),
              max = n("max", 16);
            const low = Math.min(initial, max),
              high = Math.max(initial, max);
            memory.value = low + modulo(memory.value - low, high - low + 1);
          }
        }
        break;
      case "trigger": {
        if (rising) memory.startedAt = time;
        const elapsed =
          memory.startedAt === undefined
            ? Infinity
            : Math.max(0, time - memory.startedAt);
        const attack = Math.max(0, n("attack", 0.05)),
          hold = Math.max(0, n("hold", 0.1)),
          release = Math.max(0, n("release", 0.5));
        memory.value =
          n("amplitude", 1) *
          (elapsed < attack
            ? elapsed / attack
            : elapsed < attack + hold
              ? 1
              : release > 0 && elapsed < attack + hold + release
                ? 1 - (elapsed - attack - hold) / release
                : 0);
        break;
      }
      case "derivative":
        if (dt > 0)
          memory.value = ((value - memory.previous) / dt) * n("scale", 1);
        break;
      case "hold":
        if (rising) memory.value = value;
        break;
    }
    memory.previous = gate;
    memory.time = time;
    state.set(node.id, memory);
    return result(memory.value);
  }

  switch (type) {
    case "time":
      return result(time * n("speed", 1) + n("offset"));
    case "beat":
      return result(
        modulo((time * n("bpm", 120)) / 60 + n("phase"), 1) <
          clamp(n("width", 0.1), 0, 1)
          ? 1
          : 0,
      );
    case "saw":
    case "triangle":
    case "square": {
      const phase = modulo(time * n("frequency", 1) + n("phase"), 1);
      const wave =
        type === "saw"
          ? phase * 2 - 1
          : type === "triangle"
            ? 1 - 4 * Math.abs(phase - 0.5)
            : phase < clamp(n("width", 0.5), 0, 1)
              ? 1
              : -1;
      return result(wave * n("amplitude", 1) + n("offset"));
    }
    case "noise_chop": {
      const t = time * n("frequency", 1),
        left = Math.floor(t),
        fraction = t - left;
      const hash = (index: number) =>
        modulo(
          Math.sin(index * 127.1 + n("seed", 1) * 311.7) * 43758.5453123,
          1,
        ) *
          2 -
        1;
      const blend = fraction * fraction * (3 - 2 * fraction);
      return result(
        (hash(left) * (1 - blend) + hash(left + 1) * blend) *
          n("amplitude", 1) +
          n("offset"),
      );
    }
    case "range": {
      const start = n("in_min"),
        span = n("in_max", 1) - start;
      if (!span) throw new Error("范围映射的输入最小值和最大值不能相同");
      let fraction = (a() - start) / span;
      if (p.clamp ?? true) fraction = clamp(fraction, 0, 1);
      return result(
        n("out_min") + fraction * (n("out_max", 360) - n("out_min")),
      );
    }
    case "limit": {
      const min = Math.min(n("min"), n("max", 1)),
        max = Math.max(n("min"), n("max", 1)),
        span = max - min;
      if (!span) return result(min);
      const value = a();
      if (s("mode", "clamp") === "wrap")
        return result(min + modulo(value - min, span));
      if (s("mode") === "mirror")
        return result(
          min + span - Math.abs(modulo(value - min, 2 * span) - span),
        );
      return result(clamp(value, min, max));
    }
    case "logic": {
      const value = a(),
        second = finite(input("in2")),
        threshold = n("value", 0.5);
      const firstOn = value > threshold,
        secondOn = second > threshold;
      const operations: Record<string, boolean> = {
        greater: firstOn,
        less: value < threshold,
        equal: Math.abs(value - threshold) < 1e-9,
        between:
          value >= Math.min(threshold, n("high", 1)) &&
          value <= Math.max(threshold, n("high", 1)),
        and: firstOn && secondOn,
        or: firstOn || secondOn,
        xor: firstOn !== secondOn,
        not: !firstOn,
      };
      return result(operations[s("operation", "greater")] ? 1 : 0);
    }
    case "switch_chop":
      return result(
        finite(input(finite(input("mod"), n("index")) >= 0.5 ? "in2" : "in")),
      );
    case "null_chop":
      return result(a());
    case "sine":
      return result(
        Math.sin(
          a() * (s("unit", "radians") === "degrees" ? Math.PI / 180 : 1),
        ) * n("amplitude", 1),
      );
    case "abs":
      return result(Math.abs(a()));
    case "quantize": {
      const step = Math.abs(n("step", 0.25));
      if (!step) throw new Error("量化步长必须大于 0");
      const round =
        s("mode", "round") === "floor"
          ? Math.floor
          : s("mode") === "ceil"
            ? Math.ceil
            : Math.round;
      return result(round(a() / step) * step);
    }
    case "text_dat":
      return result(s("text", "Hello, TD Open"));
    case "concatenate":
      return result(
        text(s("text", "Hello")) +
          s("separator", " ") +
          (typeof input("in2") === "string"
            ? input("in2")
            : s("text2", "world")),
      );
    case "replace_text":
      return result(
        s("find", "Hello")
          ? text().split(s("find", "Hello")).join(s("replace", "你好"))
          : text(),
      );
    case "case_text": {
      const value = text();
      return result(
        s("mode", "upper") === "upper"
          ? value.toUpperCase()
          : s("mode") === "lower"
            ? value.toLowerCase()
            : s("mode") === "reverse"
              ? Array.from(value).reverse().join("")
              : value.trim(),
      );
    }
    case "split_text": {
      const separator = s("separator", ",");
      const parts = separator ? text().split(separator) : Array.from(text());
      return result(
        JSON.stringify(
          parts.map((part) => ((p.trim ?? true) ? part.trim() : part)),
        ),
      );
    }
    case "json_select": {
      let value: unknown;
      try {
        value = JSON.parse(text());
      } catch {
        throw new Error("输入不是有效的 JSON 文本");
      }
      const path = s("path", "name").trim();
      for (const part of path ? path.split(".") : []) {
        if (
          value === null ||
          typeof value !== "object" ||
          !Object.hasOwn(value, part)
        )
          return result(s("fallback"));
        value = (value as Record<string, unknown>)[part];
      }
      return result(typeof value === "string" ? value : JSON.stringify(value));
    }
    case "table_dat": {
      const value = text(s("csv", "name,value\nalpha,1\nbeta,2"));
      if (s("mode", "csv") === "csv") return result(value);
      const rows = parseCSV(value);
      return result(
        s("mode") === "json"
          ? JSON.stringify(rows)
          : (rows[Math.max(0, Math.floor(n("row", 1)))]?.[
              Math.max(0, Math.floor(n("column", 1)))
            ] ?? ""),
      );
    }
    case "dat_to_chop":
      return result(finite(text(), n("fallback")));
    case "transform_sop": {
      const source = input();
      return result({
        shape: "group",
        detail: 0,
        children: isGeometrySpec(source) ? [source] : [],
        position: [n("x"), n("y"), n("z")],
        rotation: [n("rx"), n("ry") + finite(input("mod")), n("rz")],
        scale: [n("sx", 1), n("sy", 1), n("sz", 1)],
      });
    }
    case "merge_sop":
      return result({
        shape: "group",
        detail: 0,
        children: [input(), input("in2")].filter(isGeometrySpec),
      });
    case "line_sop":
      return result({
        shape: "line",
        detail: 8,
        width: n("width", 0.025),
        start: [n("x1", -1), n("y1"), n("z1")],
        end: [n("x2", 1), n("y2"), n("z2")],
      });
    case "box":
      return result({
        shape: "box",
        detail: n("detail", 1),
        width: n("width", 1.6),
        height: n("height", 1.6),
        depth: n("depth", 1.6),
      });
    case "sphere":
      return result({
        shape: "sphere",
        detail: n("detail", 32),
        radius: n("radius", 1.2),
      });
    case "torus":
      return result({
        shape: "torus",
        detail: n("detail", 32),
        radius: n("radius", 1),
        tube: n("tube", 0.3),
      });
    case "cone":
      return result({
        shape: "cone",
        detail: n("detail", 32),
        radius: n("radius", 1),
        height: n("height", 2),
      });
    case "cylinder":
      return result({
        shape: "cylinder",
        detail: n("detail", 32),
        radius: n("radius", 0.8),
        radius_top: n("radius_top", 0.8),
        height: n("height", 2),
      });
    case "plane":
      return result({
        shape: "plane",
        detail: n("detail", 12),
        width: n("width", 2),
        height: n("height", 2),
      });
    case "circle_sop":
      return result({
        shape: "circle",
        detail: n("detail", 32),
        radius: n("radius", 1.2),
      });
    default:
      return { handled: false };
  }
}
