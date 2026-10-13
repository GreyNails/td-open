import type { GraphNode } from "../types";
import {
  isGeometrySpec,
  validateGeometrySpec,
  type GeometrySpec,
} from "./geometry";
import { makeChannels, type ChannelBuffer } from "../runtimeValues";
import { ioDefinitions, type IODefinition } from "./ioDefinitions";

export type IOChannels = ChannelBuffer;
type IOValue = string | number | IOChannels | HTMLCanvasElement | GeometrySpec;
type IOMemory = {
  tag: "td-open-io";
  signature: string;
  disposed: boolean;
  sid?: string;
  pending: boolean;
  next: number;
  cursor: number;
  value: IOValue;
  error: string;
  lastSent: string;
  controller: AbortController;
  canvas?: HTMLCanvasElement;
  imageGeneration: number;
};
const definitions = new Map(ioDefinitions.map((d) => [d.type, d]));

async function request(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<any> {
  const response = await fetch(`/api/io${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : JSON.stringify(result.detail),
    );
  return result;
}
export function disposeIOState(state: Map<string, unknown>) {
  for (const value of state.values()) {
    const memory = value as IOMemory;
    if (memory?.tag !== "td-open-io") continue;
    memory.disposed = true;
    if (memory.sid)
      void request(`/sessions/${memory.sid}`, undefined, "DELETE").catch(
        () => {},
      );
    // Do not abort session creation: its response is needed to close a raced session.
  }
}
function empty(family: string): IOValue {
  if (family === "CHOP")
    return {
      kind: "channels",
      channels: [{ name: "value", samples: [0] }],
      sampleRate: 60,
      start: 0,
      timeSlice: true,
    };
  if (family === "TOP") {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    return canvas;
  }
  return "";
}
function encode(value: unknown): unknown {
  if (
    typeof HTMLCanvasElement !== "undefined" &&
    value instanceof HTMLCanvasElement
  )
    return {
      mime: "image/png",
      data: value.toDataURL("image/png").split(",")[1],
    };
  return value ?? "";
}
export function channelsFromIO(value: any): IOChannels {
  if (value === null || value === undefined)
    throw new Error("CHOP数据不能是null或缺失值");
  if (value?.kind === "channels" && Array.isArray(value.channels)) {
    const channels = value.channels.map((c: any, index: number) => ({
      name: String(c.name ?? `chan${index + 1}`),
      samples: (Array.isArray(c.samples) ? c.samples : []).map((v: unknown) =>
        Number(v),
      ),
    }));
    if (
      !channels.length ||
      channels.some((c: { samples: number[] }) => !c.samples.length)
    )
      throw new Error("接收的多通道数据没有有效样本");
    return makeChannels(
      channels,
      value.sampleRate ?? 60,
      value.start ?? 0,
      Boolean(value.timeSlice),
    );
  }
  if (value?.args) value = value.args;
  else if (value?.channels) value = value.channels;
  else if (value?.payload !== undefined) return channelsFromIO(value.payload);
  else if (typeof value === "string") {
    try {
      return channelsFromIO(JSON.parse(value));
    } catch {
      value = Number(value);
    }
  }
  const values = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? Object.values(value)
      : [value];
  const names =
    typeof value === "object" && !Array.isArray(value) && value !== null
      ? Object.keys(value)
      : values.map((_, i) => `chan${i + 1}`);
  const channels = values.map((v, i) => ({
    name: names[i],
    samples: Array.isArray(v) ? v.map(Number) : [Number(v)],
  }));
  if (
    !channels.length ||
    channels.some(
      (c) => !c.samples.length || c.samples.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("收到非数值数据；CHOP 输入需要数字、数组或多通道 JSON");
  return makeChannels(channels, 60, 0, true);
}
function decode(value: any, definition: IODefinition, memory: IOMemory) {
  if (definition.family === "SOP") {
    if (typeof value === "string") value = JSON.parse(value);
    if (!isGeometrySpec(value))
      throw new Error("SOP外部适配器需要有效GeometrySpec几何JSON");
    validateGeometrySpec(value);
    memory.value = value;
    return;
  }
  if (definition.family === "CHOP") {
    memory.value = channelsFromIO(value);
    return;
  }
  if (definition.family !== "TOP") {
    memory.value =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return;
  }
  if (value?.payload) value = value.payload;
  if (typeof value === "string" && value.startsWith("data:image/"))
    value = { url: value };
  if (
    !(value?.mime?.startsWith("image/") && typeof value.data === "string") &&
    !(typeof value?.url === "string" && value.url.startsWith("data:image/"))
  )
    throw new Error(
      "图像桥接需 {mime:'image/png',data:'base64…'}；不接受假图像或专有 GPU 句柄",
    );
  const generation = ++memory.imageGeneration;
  const image = new Image();
  image.onload = () => {
    if (memory.disposed || generation !== memory.imageGeneration) return;
    const canvas =
      memory.canvas || (memory.canvas = document.createElement("canvas"));
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    memory.value = canvas;
    memory.error = "";
  };
  image.onerror = () => {
    if (!memory.disposed && generation === memory.imageGeneration)
      memory.error = "图像桥接解码失败";
  };
  image.src = value.url || `data:${value.mime};base64,${value.data}`;
}
function outgoing(
  value: any,
  definition: IODefinition,
  p: Record<string, unknown>,
): any {
  if (definition.protocol === "osc")
    return {
      address: String(p.address || "/td-open"),
      args:
        value?.kind === "channels"
          ? value.channels.map((c: any) => c.samples.at(-1) || 0)
          : Array.isArray(value)
            ? value
            : [value],
    };
  if (definition.protocol === "artnet")
    return {
      universe: Number(p.universe) || 0,
      channels:
        value?.kind === "channels"
          ? value.channels.map((c: any) => c.samples.at(-1) || 0)
          : Array.isArray(value)
            ? value
            : [Number(value) || 0],
    };
  return value;
}
async function update(
  node: GraphNode,
  definition: IODefinition,
  memory: IOMemory,
  incoming: unknown,
) {
  const p = node.data.params,
    protocol = definition.protocol,
    input = encode(incoming),
    hasInput = incoming !== undefined;
  try {
    if (protocol === "file_read") {
      decode(
        (await request("/files/read", { path: p.path })).value,
        definition,
        memory,
      );
    } else if (protocol === "file_write") {
      if (!hasInput) throw new Error("文件输出需要连接输入数据");
      const payload = JSON.stringify(input);
      if (payload !== memory.lastSent) {
        await request("/files/write", {
          path: p.path,
          value: input,
          append: p.append,
        });
        memory.lastSent = payload;
      }
      decode(input, definition, memory);
    } else if (protocol === "folder") {
      memory.value = JSON.stringify(
        (await request("/files/list", { path: p.path })).files,
        null,
        2,
      );
    } else if (protocol === "http") {
      const headers = JSON.parse(String(p.headers || "{}"));
      const response = await request("/http", {
        url: p.url,
        method: p.method,
        headers,
        ...(hasInput ? { value: input } : {}),
      });
      memory.value = JSON.stringify(response, null, 2);
      if (response.status >= 400)
        throw new Error(
          `HTTP ${response.status}: ${typeof response.value === "string" ? response.value.slice(0, 180) : JSON.stringify(response.value).slice(0, 180)}`,
        );
    } else if (protocol === "webserver") {
      const path = `/web/${encodeURIComponent(String(p.channel || "example"))}`,
        payload = JSON.stringify(input);
      if (hasInput && payload !== memory.lastSent) {
        await request(path, { value: input });
        memory.lastSent = payload;
      }
      memory.value = JSON.stringify((await request(path)).value, null, 2);
    } else {
      if (!memory.sid) {
        const response = await request("/sessions", {
          protocol,
          mode: p.mode || "listen",
          host: p.host || "127.0.0.1",
          port: Number(p.port) || 0,
          url: p.url || "",
          channel: p.channel || "td-open",
          topic: p.topic || "",
          device: p.device || "",
          baud: Number(p.baud) || 115200,
          framing: p.framing || "newline",
          adapter: definition.adapter,
        });
        if (memory.disposed) {
          await request(`/sessions/${response.id}`, undefined, "DELETE");
          return;
        }
        memory.sid = response.id;
      }
      if (definition.direction !== "in" && hasInput) {
        const payload = outgoing(input, definition, p),
          serialized = JSON.stringify(payload);
        if (serialized !== memory.lastSent) {
          await request(`/sessions/${memory.sid}/send`, {
            value: payload,
            options: {
              address: p.address,
              universe: p.universe,
              topic: p.publish_topic,
            },
          });
          memory.lastSent = serialized;
          decode(input, definition, memory);
        }
      }
      const response = await request(
        `/sessions/${memory.sid}/messages?after=${memory.cursor}`,
      );
      if (response.error) throw new Error(response.error);
      if (response.state === "disconnected")
        throw new Error("连接已断开；关闭启用开关再打开可重连");
      const messages = response.messages;
      if (messages.length) {
        const last = messages.at(-1);
        memory.cursor = last.seq;
        decode(last.value, definition, memory);
      } else if (definition.adapter && !memory.cursor)
        throw new Error(
          `等待 ${definition.english} 外部适配器；未内置原生驱动。依赖：${definition.dependency}`,
        );
    }
    memory.error = "";
  } catch (error) {
    if (!memory.disposed)
      memory.error = error instanceof Error ? error.message : String(error);
  } finally {
    memory.pending = false;
  }
}
export function cookIONode(
  node: GraphNode,
  _time: number,
  input: (handle?: string) => unknown,
  state: Map<string, unknown>,
): { handled: false } | { handled: true; value: IOValue } {
  const definition = definitions.get(node.type);
  if (!definition) return { handled: false };
  const signature = JSON.stringify([node.type, node.data.params]);
  let memory = state.get(node.id) as IOMemory | undefined;
  if (!memory || memory.signature !== signature) {
    if (memory) disposeIOState(new Map([[node.id, memory]]));
    memory = {
      tag: "td-open-io",
      signature,
      disposed: false,
      pending: false,
      next: 0,
      cursor: 0,
      value: empty(definition.family),
      error: "",
      lastSent: "",
      controller: new AbortController(),
      imageGeneration: 0,
    };
    state.set(node.id, memory);
  }
  if (!node.data.params.enabled) return { handled: true, value: memory.value };
  const now = performance.now();
  if (!memory.pending && now >= memory.next) {
    memory.pending = true;
    memory.next = now + Math.max(30, Number(node.data.params.interval) || 100);
    void update(node, definition, memory, input());
  }
  if (memory.error) throw new Error(memory.error);
  return { handled: true, value: memory.value };
}
