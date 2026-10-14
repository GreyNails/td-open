import { byType } from "./catalog";
import type { StudioEngine } from "./engine";
import type { Project } from "./types";
import { isChannelBuffer, isTableData } from "./runtimeValues";
import { isGeometrySpec } from "./nodes/geometry";

export function mentionedNodes(message: string, project: Project): string[] {
  const tokens = [...message.matchAll(/@([\w\u3400-\u9fff./-]+)/g)].map(
    (m) => m[1],
  );
  return [
    ...new Set(
      tokens.flatMap((token) => {
        const exact = project.nodes.find((n) => n.id === token);
        if (exact) return [exact.id];
        const named = project.nodes.filter((n) => n.data.label === token);
        return named.length === 1 ? [named[0].id] : [];
      }),
    ),
  ];
}

export function summarizeValue(value: unknown): Record<string, unknown> {
  if (value === undefined)
    return { status: "not_cooked", note: "尚未计算，不代表空输出" };
  if (
    typeof HTMLCanvasElement !== "undefined" &&
    value instanceof HTMLCanvasElement
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    try {
      ctx.drawImage(value, 0, 0, 32, 32);
      const bytes = ctx.getImageData(0, 0, 32, 32).data;
      let alpha = 0,
        bright = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i + 3] > 2) alpha++;
        if (
          bytes[i + 3] > 2 &&
          (bytes[i] + bytes[i + 1] + bytes[i + 2]) / 3 >= 128
        )
          bright++;
      }
      return {
        kind: "image",
        width: value.width,
        height: value.height,
        sampled_pixels: 1024,
        opaque_fraction: alpha / 1024,
        bright_fraction: bright / 1024,
        note: "像素统计，不含图像内容识别",
      };
    } catch {
      return {
        kind: "image",
        width: value.width,
        height: value.height,
        note: "跨域限制，无法读取像素",
      };
    }
  }
  if (isGeometrySpec(value)) {
    const points = value.mesh?.positions,
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const point of points || [])
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], point[k]);
        max[k] = Math.max(max[k], point[k]);
      }
    return {
      kind: "geometry",
      shape: value.shape,
      point_count: points?.length ?? null,
      face_count: value.mesh?.faces.length ?? null,
      bounds: points?.length ? { min, max } : null,
      samples: points?.slice(0, 5) ?? [],
      attributes: Object.keys(value.mesh?.pointAttributes || {}),
      note: points
        ? "实际点坐标，bounds 为全量包围盒"
        : "参数几何，尚无显式网格",
    };
  }
  if (isChannelBuffer(value))
    return {
      kind: "channels",
      sample_rate: value.sampleRate,
      channel_count: value.channels.length,
      channels: value.channels
        .slice(0, 8)
        .map((c) => ({
          name: c.name,
          count: c.samples.length,
          samples: c.samples.slice(-8),
        })),
    };
  if (isTableData(value))
    return {
      kind: "table",
      row_count: value.rows.length,
      rows: value.rows
        .slice(0, 4)
        .map((r) => r.slice(0, 6).map((c) => c.slice(0, 160))),
    };
  if (typeof value === "string")
    return {
      kind: "text",
      length: value.length,
      preview: value.slice(0, 1200),
    };
  if (typeof value === "number") return { kind: "number", value };
  return { kind: "structured", note: "此类型暂未提供运行摘要" };
}

export function captureNodeRuntime(
  engine: StudioEngine | null,
  project: Project,
  ids: string[],
) {
  return ids.map((id) => {
    const node = project.nodes.find((n) => n.id === id)!,
      spec = byType[node.type];
    return {
      id,
      error: engine?.errors.get(engine.resolveId(id)) || null,
      inputs: Object.fromEntries(
        (spec?.inputs || []).map((port) => {
          const edge = project.edges.find(
            (e) =>
              e.target === id &&
              (e.targetHandle || spec.inputs[0]?.id) === port.id,
          );
          return [
            port.id,
            edge
              ? summarizeValue(
                  engine?.values.get(engine.resolveId(edge.source)),
                )
              : { status: "unconnected" },
          ];
        }),
      ),
      outputs: Object.fromEntries(
        (spec?.outputs || []).map((port) => [
          port.id,
          summarizeValue(engine?.values.get(engine.resolveId(id))),
        ]),
      ),
    };
  });
}
