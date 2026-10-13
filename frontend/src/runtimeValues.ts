/** Portable, JSON-serializable values shared by the browser and extension runtimes. */
export type Channel = { name: string; samples: number[] };
export type ChannelBuffer = {
  kind: "channels";
  channels: Channel[];
  sampleRate: number;
  /** Index of the first sample on the channel's sample-rate timeline. */
  start: number;
  timeSlice: boolean;
};
export type TableData = { kind: "table"; rows: string[][] };
export const MAX_CHANNEL_SAMPLES = 262144;
export const MAX_TABLE_CELLS = 262144;
export function isChannelBuffer(value: unknown): value is ChannelBuffer {
  return (
    !!value &&
    typeof value === "object" &&
    (value as ChannelBuffer).kind === "channels" &&
    Array.isArray((value as ChannelBuffer).channels)
  );
}
export function isTableData(value: unknown): value is TableData {
  return (
    !!value &&
    typeof value === "object" &&
    (value as TableData).kind === "table" &&
    Array.isArray((value as TableData).rows)
  );
}
export function makeChannels(
  channels: Channel[] | Record<string, number[]>,
  sampleRate = 60,
  start = 0,
  timeSlice = false,
): ChannelBuffer {
  const list = Array.isArray(channels)
    ? channels
    : Object.entries(channels).map(([name, samples]) => ({ name, samples }));
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 384000)
    throw new Error("采样率必须介于 0 和 384000 Hz 之间");
  if (!Number.isFinite(start)) throw new Error("起始样本必须是有限数字");
  if (
    list.length > 1024 ||
    list.reduce((sum, ch) => sum + ch.samples.length, 0) > MAX_CHANNEL_SAMPLES
  )
    throw new Error("信号缓冲区超过 1024 个通道或 262144 个总样本");
  const names = new Set<string>();
  const length = list[0]?.samples.length ?? 0;
  for (const ch of list) {
    if (!ch.name || names.has(ch.name))
      throw new Error("通道名称不能为空或重复");
    names.add(ch.name);
    if (ch.samples.length !== length)
      throw new Error("同一缓冲区的通道样本数量必须相等");
    if (ch.samples.some((v) => !Number.isFinite(v)))
      throw new Error("通道不能包含 NaN 或 Infinity");
  }
  return {
    kind: "channels",
    channels: list.map((ch) => ({ name: ch.name, samples: [...ch.samples] })),
    sampleRate,
    start,
    timeSlice,
  };
}
export function makeTable(rows: unknown[][]): TableData {
  if (
    rows.length > 65536 ||
    rows.reduce((n, row) => n + row.length, 0) > MAX_TABLE_CELLS
  )
    throw new Error("表格超过 262144 个单元格");
  return {
    kind: "table",
    rows: rows.map((row) =>
      row.map((cell) =>
        typeof cell === "object" && cell !== null
          ? JSON.stringify(cell)
          : String(cell ?? ""),
      ),
    ),
  };
}
export function scalarValue(value: unknown, fallback = 0): number {
  if (isChannelBuffer(value))
    return value.channels[0]?.samples.at(-1) ?? fallback;
  if (isTableData(value)) return scalarValue(value.rows[0]?.[0], fallback);
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return fallback;
}
export function tableCSV(value: TableData): string {
  return value.rows
    .map((row) =>
      row
        .map((s) =>
          /[,"\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s,
        )
        .join(","),
    )
    .join("\n");
}
export function textValue(value: unknown): string {
  if (isTableData(value)) return tableCSV(value);
  if (isChannelBuffer(value)) return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function asChannels(value: unknown, sampleRate = 60): ChannelBuffer {
  if (isChannelBuffer(value)) return value;
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("通道 JSON 格式错误");
    }
    if (isChannelBuffer(parsed))
      return makeChannels(
        parsed.channels,
        parsed.sampleRate,
        parsed.start,
        parsed.timeSlice,
      );
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "number"))
      return makeChannels({ chan1: parsed }, sampleRate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return makeChannels(parsed as Record<string, number[]>, sampleRate);
    throw new Error("通道 JSON 必须是数字数组或名称到样本数组的映射");
  }
  return makeChannels({ chan1: [scalarValue(value)] }, sampleRate);
}
/** CSV reader that preserves quoted delimiters, newlines, and empty cells. */
export function parseTableText(text: string, delimiter = ","): string[][] {
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else cell += c;
    } else if (!quoted && c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 引号没有闭合");
  if (cell || row.length || !/[\r\n]$/.test(text)) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function asTable(value: unknown): TableData {
  if (isTableData(value)) return value;
  if (isChannelBuffer(value)) {
    const rows: unknown[][] = [value.channels.map((ch) => ch.name)];
    for (let i = 0; i < (value.channels[0]?.samples.length ?? 0); i++)
      rows.push(value.channels.map((ch) => ch.samples[i]));
    return makeTable(rows);
  }
  return makeTable(parseTableText(textValue(value)));
}
