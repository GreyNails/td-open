export type Params = Record<string, string | number | boolean>;
export type GraphNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label: string; params: Params; graph?: Project };
};
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
export type Project = {
  id: string;
  name: string;
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  settings?: Record<string, unknown>;
};
export type Param = {
  key: string;
  label: string;
  type: "number" | "text" | "color" | "select" | "boolean";
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  hint?: string;
};
export type Port = { id: string; kind: string; label: string };
export type NodeSpec = {
  type: string;
  label: string;
  english: string;
  family: string;
  description: string;
  inputs: Port[];
  outputs: Port[];
  params: Param[];
  comfy?: { class_type: string; terminal: boolean };
  reference?: {
    family: string;
    name: string;
    level: "native" | "subset" | "bridge";
    note?: string;
  };
};
export type Command = Record<string, unknown> & { op: string };
export type Provider = {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  model: string;
  capability: string;
  has_key?: boolean;
  path?: string;
  body_template?: unknown;
};
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail;
    try {
      const json = await response.json();
      detail =
        typeof json.detail === "string"
          ? json.detail
          : JSON.stringify(json.detail ?? json);
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail || "请求失败");
  }
  return response.json();
}
export function uid(prefix = "node") {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
