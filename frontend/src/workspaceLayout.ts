export const panelIds = [
  "library",
  "preview",
  "graph",
  "inspector",
  "assistant",
] as const;
export type PanelId = (typeof panelIds)[number];
export type Rect = { x: number; y: number; width: number; height: number };
export type DockZone = "left" | "right" | "top" | "bottom" | "center";
export type DockGroup = {
  type: "group";
  id: string;
  tabs: PanelId[];
  active: PanelId;
};
export type DockSplit = {
  type: "split";
  id: string;
  axis: "row" | "column";
  ratio: number;
  first: DockNode;
  second: DockNode;
};
export type DockNode = DockGroup | DockSplit;
export type WorkspaceLayout = {
  version: 2;
  reference: { width: number; height: number };
  root: DockNode;
  hidden: PanelId[];
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
  library: { width: 170, height: 150 },
  preview: { width: 240, height: 180 },
  graph: { width: 280, height: 200 },
  inspector: { width: 220, height: 170 },
  assistant: { width: 220, height: 180 },
};
export const SPLITTER_SIZE = 4;
const finite = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;
const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(n, min), max);
const isPanel = (id: unknown): id is PanelId =>
  panelIds.includes(id as PanelId);
let sequence = 0;
const identifier = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${++sequence}`;
const group = (id: string, ...tabs: PanelId[]): DockGroup => ({
  type: "group",
  id,
  tabs,
  active: tabs[0],
});
const split = (
  id: string,
  axis: DockSplit["axis"],
  ratio: number,
  first: DockNode,
  second: DockNode,
): DockSplit => ({ type: "split", id, axis, ratio, first, second });

export function presetLayout(
  width: number,
  height: number,
  preset = "studio",
): WorkspaceLayout {
  const library = group("library-area", "library"),
    preview = group("preview-area", "preview"),
    graph = group("graph-area", "graph"),
    inspector = group("inspector-area", "inspector"),
    assistant = group("assistant-area", "assistant");
  let root: DockNode;
  let hidden: PanelId[] = [];
  if (preset === "canvas") {
    root = split(
      "canvas-main",
      "row",
      0.18,
      library,
      split(
        "canvas-tools",
        "row",
        0.73,
        graph,
        split(
          "canvas-side",
          "column",
          0.48,
          preview,
          group("properties-area", "inspector", "assistant"),
        ),
      ),
    );
  } else if (preset === "visual") {
    root = split(
      "visual-main",
      "row",
      0.77,
      split("visual-editors", "column", 0.69, preview, graph),
      group("properties-area", "inspector", "assistant"),
    );
    hidden = ["library"];
  } else {
    root = split(
      "studio-main",
      "row",
      0.175,
      library,
      split(
        "studio-tools",
        "row",
        0.73,
        split("studio-editors", "column", 0.46, preview, graph),
        split("studio-side", "column", 0.54, inspector, assistant),
      ),
    );
    preset = "studio";
  }
  return {
    version: 2,
    reference: { width: Math.max(1, width), height: Math.max(1, height) },
    root,
    hidden,
    preset,
  };
}

export function groups(node: DockNode): DockGroup[] {
  return node.type === "group"
    ? [node]
    : [...groups(node.first), ...groups(node.second)];
}
export function findNode(node: DockNode, id: string): DockNode | undefined {
  if (node.id === id) return node;
  return node.type === "split"
    ? findNode(node.first, id) || findNode(node.second, id)
    : undefined;
}
export function findGroup(
  node: DockNode,
  panel: PanelId,
): DockGroup | undefined {
  return groups(node).find((g) => g.tabs.includes(panel));
}
export function minimumSize(node: DockNode): { width: number; height: number } {
  if (node.type === "group")
    return {
      width: Math.max(...node.tabs.map((p) => minimums[p].width)),
      height: Math.max(...node.tabs.map((p) => minimums[p].height)),
    };
  const a = minimumSize(node.first),
    b = minimumSize(node.second);
  return node.axis === "row"
    ? {
        width: a.width + b.width + SPLITTER_SIZE,
        height: Math.max(a.height, b.height),
      }
    : {
        width: Math.max(a.width, b.width),
        height: a.height + b.height + SPLITTER_SIZE,
      };
}
/** On small screens both minimums shrink proportionally; neither adjacent area can become negative. */
export function ratioBounds(
  node: DockSplit,
  extent: number,
): { min: number; max: number } {
  const available = Math.max(1, extent - SPLITTER_SIZE),
    key = node.axis === "row" ? "width" : "height";
  const a = minimumSize(node.first)[key],
    b = minimumSize(node.second)[key];
  const scale = Math.min(1, available / (a + b));
  return { min: (a * scale) / available, max: 1 - (b * scale) / available };
}
export type PlacedGroup = { node: DockGroup; rect: Rect };
export type PlacedSplit = {
  node: DockSplit;
  rect: Rect;
  handle: Rect;
  ratio: number;
};
export function measureLayout(
  layout: WorkspaceLayout,
  width = layout.reference.width,
  height = layout.reference.height,
): { groups: PlacedGroup[]; splits: PlacedSplit[] } {
  const result: { groups: PlacedGroup[]; splits: PlacedSplit[] } = {
    groups: [],
    splits: [],
  };
  const visit = (node: DockNode, rect: Rect) => {
    if (node.type === "group") {
      result.groups.push({ node, rect });
      return;
    }
    const extent = node.axis === "row" ? rect.width : rect.height,
      gap = Math.min(SPLITTER_SIZE, extent);
    const { min, max } = ratioBounds(node, extent),
      ratio = clamp(node.ratio, min, Math.max(min, max));
    const firstSize = Math.round(Math.max(0, extent - gap) * ratio),
      secondSize = Math.max(0, extent - gap - firstSize);
    const a = { ...rect },
      b = { ...rect },
      handle = { ...rect };
    if (node.axis === "row") {
      a.width = firstSize;
      b.x += firstSize + gap;
      b.width = secondSize;
      handle.x += firstSize;
      handle.width = gap;
    } else {
      a.height = firstSize;
      b.y += firstSize + gap;
      b.height = secondSize;
      handle.y += firstSize;
      handle.height = gap;
    }
    result.splits.push({ node, rect, handle, ratio });
    visit(node.first, a);
    visit(node.second, b);
  };
  visit(layout.root, {
    x: 0,
    y: 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  });
  return result;
}
function mapNode(
  node: DockNode,
  id: string,
  update: (n: DockNode) => DockNode,
): DockNode {
  if (node.id === id) return update(node);
  return node.type === "split"
    ? {
        ...node,
        first: mapNode(node.first, id, update),
        second: mapNode(node.second, id, update),
      }
    : node;
}
/** Remove a tab, collapsing empty leaves and their now-unnecessary parent split. */
export function removePanel(node: DockNode, panel: PanelId): DockNode | null {
  if (node.type === "group") {
    const tabs = node.tabs.filter((p) => p !== panel);
    return tabs.length
      ? {
          ...node,
          tabs,
          active: tabs.includes(node.active) ? node.active : tabs[0],
        }
      : null;
  }
  const first = removePanel(node.first, panel),
    second = removePanel(node.second, panel);
  return first && second ? { ...node, first, second } : first || second;
}
export function activatePanel(
  layout: WorkspaceLayout,
  panel: PanelId,
): WorkspaceLayout {
  const target = findGroup(layout.root, panel);
  return target
    ? {
        ...layout,
        root: mapNode(layout.root, target.id, (node) => ({
          ...(node as DockGroup),
          active: panel,
        })),
      }
    : layout;
}
export function dockPanel(
  layout: WorkspaceLayout,
  panel: PanelId,
  targetId: string,
  zone: DockZone,
): WorkspaceLayout {
  const target = findNode(layout.root, targetId);
  if (!target || target.type !== "group") return layout;
  if (
    target.tabs.includes(panel) &&
    (zone === "center" || target.tabs.length === 1)
  )
    return activatePanel(layout, panel);
  const removed = removePanel(layout.root, panel);
  if (!removed) return layout;
  const root = mapNode(removed, targetId, (node) => {
    const targetGroup = node as DockGroup;
    if (zone === "center")
      return {
        ...targetGroup,
        tabs: [...targetGroup.tabs, panel],
        active: panel,
      };
    const added = group(identifier("group"), panel),
      before = zone === "left" || zone === "top";
    return split(
      identifier("split"),
      zone === "left" || zone === "right" ? "row" : "column",
      0.5,
      before ? added : targetGroup,
      before ? targetGroup : added,
    );
  });
  return {
    ...layout,
    root,
    hidden: layout.hidden.filter((id) => id !== panel),
    preset: "custom",
  };
}
export function hidePanel(
  layout: WorkspaceLayout,
  panel: PanelId,
): WorkspaceLayout {
  const root = removePanel(layout.root, panel);
  if (!root || layout.hidden.includes(panel)) return layout;
  return {
    ...layout,
    root,
    hidden: [...layout.hidden, panel],
    preset: "custom",
  };
}
export function restorePanel(
  layout: WorkspaceLayout,
  panel: PanelId,
): WorkspaceLayout {
  if (!layout.hidden.includes(panel)) return activatePanel(layout, panel);
  if (panel === "library")
    return {
      ...layout,
      root: split(
        identifier("split"),
        "row",
        0.175,
        group(identifier("group"), panel),
        layout.root,
      ),
      hidden: layout.hidden.filter((id) => id !== panel),
      preset: "custom",
    };
  const preferred: Partial<Record<PanelId, PanelId>> = {
    preview: "graph",
    graph: "preview",
    inspector: "assistant",
    assistant: "inspector",
  };
  const target =
    (preferred[panel] && findGroup(layout.root, preferred[panel]!)) ||
    groups(layout.root).at(-1)!;
  return dockPanel(
    layout,
    panel,
    target.id,
    panel === "preview" ? "top" : panel === "graph" ? "bottom" : "center",
  );
}
export function resizeSplit(
  layout: WorkspaceLayout,
  id: string,
  ratio: number,
): WorkspaceLayout {
  const placed = measureLayout(layout).splits.find((s) => s.node.id === id);
  if (!placed) return layout;
  const extent =
    placed.node.axis === "row" ? placed.rect.width : placed.rect.height;
  const bounds = ratioBounds(placed.node, extent);
  return {
    ...layout,
    preset: "custom",
    root: mapNode(layout.root, id, (node) => ({
      ...(node as DockSplit),
      ratio: clamp(
        finite(ratio, 0.5),
        bounds.min,
        Math.max(bounds.min, bounds.max),
      ),
    })),
  };
}
/** Read untrusted project JSON without allowing duplicate panels, IDs, cycles, or empty branches. */
export function readLayout(
  saved: unknown,
  width: number,
  height: number,
): WorkspaceLayout {
  const fallback = presetLayout(width, height);
  if (!saved || typeof saved !== "object") return fallback;
  const value = saved as Record<string, unknown>;
  if (value.version === 1 && value.panels && typeof value.panels === "object") {
    let migrated = presetLayout(
      width,
      height,
      typeof value.preset === "string" ? value.preset : "studio",
    );
    const old = value.panels as Record<
      string,
      { visible?: boolean; width?: number }
    >;
    // Floating windows have no shared topology: retain the preset and visibility, then fit into contiguous areas.
    for (const id of panelIds) {
      if (old[id]?.visible === false) migrated = hidePanel(migrated, id);
      else if (migrated.hidden.includes(id))
        migrated = restorePanel(migrated, id);
    }
    if (panelIds.every((id) => old[id]?.visible === false))
      return {
        ...migrated,
        root: group("graph-area", "graph"),
        hidden: panelIds.filter((id) => id !== "graph"),
      };
    return migrated;
  }
  if (value.version !== 2) return fallback;
  const seenPanels = new Set<PanelId>(),
    seenIds = new Set<string>();
  const sanitize = (candidate: unknown, depth = 0): DockNode | null => {
    if (!candidate || typeof candidate !== "object" || depth > 12) return null;
    const n = candidate as Record<string, unknown>;
    let id =
      typeof n.id === "string" && n.id.length < 100 && !seenIds.has(n.id)
        ? n.id
        : identifier("restored");
    seenIds.add(id);
    if (n.type === "group" && Array.isArray(n.tabs)) {
      const tabs = n.tabs.filter((p) => {
        if (!isPanel(p) || seenPanels.has(p)) return false;
        seenPanels.add(p);
        return true;
      }) as PanelId[];
      return tabs.length
        ? {
            type: "group",
            id,
            tabs,
            active: tabs.includes(n.active as PanelId)
              ? (n.active as PanelId)
              : tabs[0],
          }
        : null;
    }
    if (n.type !== "split") return null;
    const first = sanitize(n.first, depth + 1),
      second = sanitize(n.second, depth + 1);
    return first && second
      ? {
          type: "split",
          id,
          axis: n.axis === "column" ? "column" : "row",
          ratio: clamp(finite(n.ratio, 0.5), 0.01, 0.99),
          first,
          second,
        }
      : first || second;
  };
  const root = sanitize(value.root);
  if (!root) return fallback;
  return {
    version: 2,
    root,
    reference: fallback.reference,
    hidden: panelIds.filter((id) => !seenPanels.has(id)),
    preset: typeof value.preset === "string" ? value.preset : "custom",
  };
}
export function dropZone(rect: Rect, x: number, y: number): DockZone {
  const rx = (x - rect.x) / Math.max(1, rect.width),
    ry = (y - rect.y) / Math.max(1, rect.height);
  // Header and the central area merge panels into a tab group.
  if (y - rect.y < 32 || (rx > 0.26 && rx < 0.74 && ry > 0.26 && ry < 0.74))
    return "center";
  const distances: [DockZone, number][] = [
    ["left", rx],
    ["right", 1 - rx],
    ["top", ry],
    ["bottom", 1 - ry],
  ];
  return distances.sort((a, b) => a[1] - b[1])[0][0];
}
