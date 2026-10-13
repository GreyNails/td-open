export const panelIds = [
  "library",
  "preview",
  "graph",
  "inspector",
  "assistant",
] as const;
export type PanelId = (typeof panelIds)[number];
export type Rect = { x: number; y: number; width: number; height: number };
export type PanelRect = Rect & { visible: boolean };
export type WorkspaceLayout = {
  version: 1;
  reference: { width: number; height: number };
  panels: Record<PanelId, PanelRect>;
  order: PanelId[];
  snap: boolean;
  preset: string;
};
export const panelNames: Record<PanelId, string> = {
  library: "节点资源",
  preview: "实时预览",
  graph: "无限节点画布",
  inspector: "节点参数",
  assistant: "创作助手",
};
export const minimums: Record<PanelId, { width: number; height: number }> = {
  library: { width: 190, height: 180 },
  preview: { width: 280, height: 190 },
  graph: { width: 320, height: 210 },
  inspector: { width: 240, height: 190 },
  assistant: { width: 250, height: 200 },
};
const finite = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), Math.max(min, max));
export function clampRect(
  rect: Rect,
  id: PanelId,
  width: number,
  height: number,
): Rect {
  const w = clamp(
      finite(rect.width, minimums[id].width),
      Math.min(minimums[id].width, width),
      width,
    ),
    h = clamp(
      finite(rect.height, minimums[id].height),
      Math.min(minimums[id].height, height),
      height,
    );
  return {
    x: clamp(finite(rect.x, 0), 0, width - w),
    y: clamp(finite(rect.y, 0), 0, height - h),
    width: w,
    height: h,
  };
}
export function presetLayout(
  width: number,
  height: number,
  preset = "studio",
): WorkspaceLayout {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const gap = 10,
    left = Math.max(190, Math.min(220, width * 0.18)),
    right = Math.max(250, Math.min(290, width * 0.23)),
    center = width - left - right - gap * 2,
    previewHeight = Math.round(height * 0.46),
    inspectorHeight = Math.round(height * 0.54);
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    visible = true,
  ): PanelRect => ({ x, y, width: w, height: h, visible });
  const panels: WorkspaceLayout["panels"] = {
    library: rect(0, 0, left, height),
    preview: rect(left + gap, 0, center, previewHeight),
    graph: rect(
      left + gap,
      previewHeight + gap,
      center,
      height - previewHeight - gap,
    ),
    inspector: rect(width - right, 0, right, inspectorHeight),
    assistant: rect(
      width - right,
      inspectorHeight + gap,
      right,
      height - inspectorHeight - gap,
    ),
  };
  if (preset === "canvas") {
    panels.graph = rect(left + gap, 0, width - left - gap, height);
    panels.preview = rect(width - 330, 12, 320, 230);
    panels.inspector = rect(width - 270, height - 330, 260, 320);
    panels.assistant.visible = false;
  }
  if (preset === "visual") {
    panels.library.visible = false;
    panels.assistant.visible = false;
    panels.preview = rect(0, 0, width - right - gap, height - 240 - gap);
    panels.graph = rect(0, height - 240, width - right - gap, 240);
    panels.inspector = rect(width - right, 0, right, height);
  }
  for (const id of panelIds)
    panels[id] = { ...panels[id], ...clampRect(panels[id], id, width, height) };
  return {
    version: 1,
    reference: { width, height },
    panels,
    order:
      preset === "canvas"
        ? ["library", "graph", "preview", "inspector", "assistant"]
        : [...panelIds],
    snap: true,
    preset,
  };
}
export function readLayout(
  saved: unknown,
  width: number,
  height: number,
): WorkspaceLayout {
  const fallback = presetLayout(width, height);
  if (!saved || typeof saved !== "object") return fallback;
  const s = saved as Partial<WorkspaceLayout>;
  if (s.version !== 1 || !s.panels) return fallback;
  const refW = finite(s.reference?.width, width),
    refH = finite(s.reference?.height, height);
  const sx = width / Math.max(1, refW),
    sy = height / Math.max(1, refH);
  for (const id of panelIds) {
    const r = s.panels[id];
    if (!r || typeof r !== "object") continue;
    fallback.panels[id] = {
      ...clampRect(
        {
          x: finite(r.x, 0) * sx,
          y: finite(r.y, 0) * sy,
          width: finite(r.width, minimums[id].width) * sx,
          height: finite(r.height, minimums[id].height) * sy,
        },
        id,
        width,
        height,
      ),
      visible: typeof r.visible === "boolean" ? r.visible : true,
    };
  }
  const order = Array.isArray(s.order)
    ? s.order.filter((id, i, a) => panelIds.includes(id) && a.indexOf(id) === i)
    : [];
  fallback.order = [...order, ...panelIds.filter((id) => !order.includes(id))];
  fallback.snap = typeof s.snap === "boolean" ? s.snap : true;
  fallback.preset = typeof s.preset === "string" ? s.preset : "custom";
  if (!panelIds.some((id) => fallback.panels[id].visible))
    fallback.panels.graph.visible = true;
  return fallback;
}
export function dragRect(
  start: Rect,
  dx: number,
  dy: number,
  id: PanelId,
  width: number,
  height: number,
  snap: boolean,
): Rect {
  const step = snap ? 8 : 1;
  return clampRect(
    {
      ...start,
      x: Math.round((start.x + dx) / step) * step,
      y: Math.round((start.y + dy) / step) * step,
    },
    id,
    width,
    height,
  );
}
export function resizeRect(
  start: Rect,
  dx: number,
  dy: number,
  direction: string,
  id: PanelId,
  width: number,
  height: number,
  snap: boolean,
): Rect {
  const step = snap ? 8 : 1;
  dx = Math.round(dx / step) * step;
  dy = Math.round(dy / step) * step;
  const minW = Math.min(minimums[id].width, width),
    minH = Math.min(minimums[id].height, height);
  let left = start.x,
    top = start.y,
    right = start.x + start.width,
    bottom = start.y + start.height;
  if (direction.includes("w")) left = clamp(start.x + dx, 0, right - minW);
  if (direction.includes("e")) right = clamp(right + dx, left + minW, width);
  if (direction.includes("n")) top = clamp(start.y + dy, 0, bottom - minH);
  if (direction.includes("s")) bottom = clamp(bottom + dy, top + minH, height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
