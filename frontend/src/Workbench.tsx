import { useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import {
  GripVertical,
  Maximize2,
  Minimize2,
  Minus,
  PanelsTopLeft,
  RotateCcw,
  Move,
  Check,
  ChevronDown,
  LayoutDashboard,
  PanelTop,
  Scan,
  Plus,
  Combine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  panelIds,
  panelNames,
  presetLayout,
  readLayout,
  measureLayout,
  findNode,
  activatePanel,
  dockPanel,
  hidePanel,
  restorePanel,
  resizeSplit,
  dropZone,
  ratioBounds,
  SPLITTER_SIZE,
} from "./workspaceLayout";
import type {
  PanelId,
  WorkspaceLayout,
  DockZone,
  PlacedSplit,
  Rect,
} from "./workspaceLayout";

type Props = {
  saved: unknown;
  panels: Record<PanelId, ReactNode>;
  onChange: (layout: WorkspaceLayout) => void;
  nodeCount: number;
  onAdd: () => void;
};
type DragState = {
  panel: PanelId;
  x: number;
  y: number;
  target: string | null;
  zone: DockZone;
};
const zones: DockZone[] = ["left", "top", "center", "bottom", "right"];
const zoneNames = {
  left: "左侧拆分",
  right: "右侧拆分",
  top: "上方拆分",
  bottom: "下方拆分",
  center: "合并为标签组",
};
const zoneIcons = {
  left: ArrowLeft,
  right: ArrowRight,
  top: ArrowUp,
  bottom: ArrowDown,
  center: Combine,
};
function dropRect(rect: Rect, zone: DockZone): Rect {
  if (zone === "center") return rect;
  const result = { ...rect };
  if (zone === "left" || zone === "right") {
    result.width /= 2;
    if (zone === "right") result.x += result.width;
  } else {
    result.height /= 2;
    if (zone === "bottom") result.y += result.height;
  }
  return result;
}
const position = (rect: Rect) => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
});

export default function Workbench({
  saved,
  panels,
  onChange,
  nodeCount,
  onAdd,
}: Props) {
  const stage = useRef<HTMLDivElement>(null),
    layoutRef = useRef<WorkspaceLayout>(readLayout(saved, 1280, 760)),
    onChangeRef = useRef(onChange);
  const [layout, setLayout] = useState(layoutRef.current),
    [maximized, setMaximized] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [drag, setDrag] = useState<DragState | null>(null),
    [resizing, setResizing] = useState<string | null>(null),
    [measured, setMeasured] = useState(false),
    [compact, setCompact] = useState(false);
  const lastPublished = useRef(saved),
    dragCleanup = useRef<(() => void) | null>(null),
    dragRef = useRef<DragState | null>(null);
  onChangeRef.current = onChange;
  const update = (next: WorkspaceLayout, persist = false) => {
    layoutRef.current = next;
    setLayout(next);
    if (persist) {
      lastPublished.current = next;
      onChangeRef.current(next);
    }
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setCompact(width < 800);
      if (width < 10 || height < 10) return;
      const current = layoutRef.current;
      if (
        Math.abs(current.reference.width - width) > 0.5 ||
        Math.abs(current.reference.height - height) > 0.5
      )
        update({ ...current, reference: { width, height } });
      setMeasured(true);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      dragCleanup.current?.();
    };
  }, []);
  useEffect(() => {
    if (saved === lastPublished.current) return;
    const { width, height } = layoutRef.current.reference;
    update(readLayout(saved, width, height));
    lastPublished.current = saved;
  }, [saved]);
  useEffect(() => {
    if (maximized && !findNode(layout.root, maximized)) setMaximized(null);
  }, [layout.root, maximized]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".workbench-layout-menu"))
        setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dragCleanup.current?.();
        setMaximized(null);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const placed = measureLayout(layout);
  const beginDock = (event: ReactPointerEvent, panel: PanelId) => {
    if (
      event.button !== 0 ||
      compact ||
      maximized ||
      (event.target as Element).closest(".dock-actions")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanup.current?.();
    const startX = event.clientX,
      startY = event.clientY,
      pointerId = event.pointerId;
    let moved = false;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !stage.current) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 6)
        return;
      moved = true;
      const bounds = stage.current.getBoundingClientRect(),
        x = e.clientX - bounds.left,
        y = e.clientY - bounds.top;
      const target = measureLayout(layoutRef.current).groups.find(
        (g) =>
          x >= g.rect.x &&
          x <= g.rect.x + g.rect.width &&
          y >= g.rect.y &&
          y <= g.rect.y + g.rect.height,
      );
      let zone: DockZone = target ? dropZone(target.rect, x, y) : "center";
      const hovered = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-dock-zone]");
      if (hovered && zones.includes(hovered.dataset.dockZone as DockZone))
        zone = hovered.dataset.dockZone as DockZone;
      const next = { panel, x, y, target: target?.node.id || null, zone };
      dragRef.current = next;
      setDrag(next);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      dragRef.current = null;
      setDrag(null);
      dragCleanup.current = null;
    };
    const cancel = () => cleanup();
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const drop = dragRef.current;
      cleanup();
      if (moved && drop?.target)
        update(
          dockPanel(layoutRef.current, panel, drop.target, drop.zone),
          true,
        );
      else if (!moved) update(activatePanel(layoutRef.current, panel), true);
    };
    dragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };
  const beginResize = (event: ReactPointerEvent, split: PlacedSplit) => {
    if (event.button !== 0 || compact || maximized) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanup.current?.();
    const isRow = split.node.axis === "row",
      start = isRow ? event.clientX : event.clientY,
      extent = (isRow ? split.rect.width : split.rect.height) - SPLITTER_SIZE,
      pointerId = event.pointerId,
      initial = layoutRef.current;
    setResizing(split.node.id);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      update(
        resizeSplit(
          initial,
          split.node.id,
          split.ratio +
            ((isRow ? e.clientX : e.clientY) - start) / Math.max(1, extent),
        ),
      );
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setResizing(null);
      dragCleanup.current = null;
    };
    const cancel = () => {
      cleanup();
      update(initial);
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      cleanup();
      update(layoutRef.current, true);
    };
    // Escape restores the boundary to its original position.
    dragCleanup.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };
  const toggle = (id: PanelId) =>
    update(
      layout.hidden.includes(id)
        ? restorePanel(layoutRef.current, id)
        : hidePanel(layoutRef.current, id),
      true,
    );
  const choose = (name: string) => {
    const { width, height } = layoutRef.current.reference;
    update(presetLayout(width, height, name), true);
    setMaximized(null);
    setMenu(false);
  };
  const targetGroup = drag?.target
    ? placed.groups.find((g) => g.node.id === drag.target)
    : undefined;
  const dropPreview =
    drag && targetGroup ? dropRect(targetGroup.rect, drag.zone) : null;
  return (
    <main
      className={`workbench ${compact ? "compact" : ""} ${drag || resizing ? "is-moving" : ""}`}
    >
      <div className="workbench-toolbar">
        <div className="workbench-title">
          <PanelsTopLeft size={17} />
          <strong>自由工作台</strong>
          <span>{nodeCount} 个节点入口</span>
          <em>联动分区</em>
        </div>
        <div className="workbench-tools">
          <button className="button subtle small" onClick={onAdd}>
            <Plus size={14} />
            添加节点 <kbd>Tab</kbd>
          </button>
          <div className="workbench-layout-menu">
            <button
              className="button small layout-trigger"
              onClick={() => setMenu((v) => !v)}
              aria-expanded={menu}
            >
              <LayoutDashboard size={14} />
              布局与面板
              <ChevronDown size={12} />
            </button>
            {menu && (
              <div className="layout-popover">
                <span className="popover-label">工作区预设</span>
                <button onClick={() => choose("studio")}>
                  <LayoutDashboard size={15} />
                  <span>
                    标准工作台<small>五个分区，共享边界联动缩放</small>
                  </span>
                </button>
                <button onClick={() => choose("canvas")}>
                  <Scan size={15} />
                  <span>
                    画布优先<small>放大节点区，参数与助手收纳为标签</small>
                  </span>
                </button>
                <button onClick={() => choose("visual")}>
                  <PanelTop size={15} />
                  <span>
                    视觉优先<small>大预览与底部节点区</small>
                  </span>
                </button>
                <span className="popover-label">显示面板</span>
                {panelIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => toggle(id)}
                    disabled={
                      !layout.hidden.includes(id) &&
                      placed.groups.length === 1 &&
                      placed.groups[0].node.tabs.length === 1
                    }
                  >
                    <span className="panel-check">
                      {!layout.hidden.includes(id) && <Check size={13} />}
                    </span>
                    {panelNames[id]}
                  </button>
                ))}
                <div className="layout-menu-foot">
                  <Move size={13} />
                  拖标签至四边拆分 · 至中央合并
                </div>
              </div>
            )}
          </div>
          <button
            className="icon-button"
            title="恢复默认工作区布局"
            onClick={() => choose("studio")}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <div
        className="workbench-stage"
        ref={stage}
        style={{ visibility: measured ? "visible" : "hidden" }}
      >
        {panelIds.map((id) => {
          const found = placed.groups.find((g) => g.node.tabs.includes(id)),
            group = found?.node,
            max = !!group && maximized === group.id,
            active = compact || group?.active === id,
            hidden = !found || !active || Boolean(maximized && !max),
            rect = found?.rect || { x: 0, y: 0, width: 320, height: 250 };
          const last = placed.groups.length === 1 && group?.tabs.length === 1;
          return (
            <section
              key={id}
              data-panel={id}
              data-group={group?.id}
              data-active={active && !!found ? "true" : "false"}
              className={`dock-panel ${max ? "maximized" : ""} ${drag?.panel === id ? "dragging" : ""}`}
              aria-label={panelNames[id] + "面板"}
              aria-hidden={hidden}
              style={
                compact
                  ? { display: found ? "flex" : "none" }
                  : {
                      ...position(
                        max ? { x: 0, y: 0, ...layout.reference } : rect,
                      ),
                      visibility: hidden ? "hidden" : "visible",
                      pointerEvents: hidden ? "none" : undefined,
                      zIndex: max ? 30 : 1,
                    }
              }
            >
              <div
                className="dock-titlebar"
                onPointerDown={(e) => beginDock(e, id)}
                onDoubleClick={(e) => {
                  if (
                    !(e.target as Element).closest(".dock-actions") &&
                    !compact &&
                    group
                  )
                    setMaximized(max ? null : group.id);
                }}
              >
                <GripVertical size={13} className="dock-grip" />
                <div
                  className="dock-tabs"
                  role="tablist"
                  aria-label={`${panelNames[id]}区域标签`}
                >
                  {(compact ? [id] : group?.tabs || [id]).map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      className={`dock-tab ${tab === id ? "active" : ""}`}
                      aria-selected={tab === id}
                      data-dock-tab={tab}
                      title={`${panelNames[tab]} · 拖动拆分或合并`}
                      onPointerDown={(e) => beginDock(e, tab)}
                      onClick={() =>
                        update(activatePanel(layoutRef.current, tab), true)
                      }
                      onKeyDown={(e) => {
                        if (
                          !group ||
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            e.key,
                          )
                        )
                          return;
                        e.preventDefault();
                        const index = group.tabs.indexOf(tab),
                          next =
                            e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? group.tabs.length - 1
                                : (index +
                                    (e.key === "ArrowLeft" ? -1 : 1) +
                                    group.tabs.length) %
                                  group.tabs.length;
                        update(
                          activatePanel(layoutRef.current, group.tabs[next]),
                          true,
                        );
                        requestAnimationFrame(() =>
                          stage.current
                            ?.querySelector<HTMLElement>(
                              `[data-panel="${group.tabs[next]}"] [data-dock-tab="${group.tabs[next]}"]`,
                            )
                            ?.focus(),
                        );
                      }}
                    >
                      {panelNames[tab]}
                    </button>
                  ))}
                </div>
                <div className="dock-actions">
                  <button
                    className="icon-button"
                    title={`隐藏${panelNames[id]}面板`}
                    disabled={last}
                    onClick={() => toggle(id)}
                  >
                    <Minus size={12} />
                  </button>
                  <button
                    className="icon-button"
                    title={
                      max
                        ? `还原${panelNames[id]}面板`
                        : `最大化${panelNames[id]}面板`
                    }
                    onClick={() => group && setMaximized(max ? null : group.id)}
                  >
                    {max ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  </button>
                </div>
              </div>
              <div className="dock-content" role="tabpanel">
                {panels[id]}
              </div>
            </section>
          );
        })}
        {!compact &&
          !maximized &&
          placed.splits.map((split) => {
            const row = split.node.axis === "row",
              bounds = ratioBounds(
                split.node,
                row ? split.rect.width : split.rect.height,
              );
            return (
              <div
                key={split.node.id}
                data-splitter={split.node.id}
                className={`dock-splitter ${row ? "splitter-row" : "splitter-column"} ${resizing === split.node.id ? "resizing" : ""}`}
                style={position(split.handle)}
                role="separator"
                tabIndex={0}
                aria-label={row ? "调整左右分区大小" : "调整上下分区大小"}
                aria-orientation={row ? "vertical" : "horizontal"}
                aria-valuemin={Math.round(bounds.min * 100)}
                aria-valuemax={Math.round(bounds.max * 100)}
                aria-valuenow={Math.round(split.ratio * 100)}
                onPointerDown={(event) => beginResize(event, split)}
                onDoubleClick={() =>
                  update(
                    resizeSplit(layoutRef.current, split.node.id, 0.5),
                    true,
                  )
                }
                onKeyDown={(event) => {
                  const backward = row ? "ArrowLeft" : "ArrowUp",
                    forward = row ? "ArrowRight" : "ArrowDown";
                  if (![backward, forward, "Home", "End"].includes(event.key))
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const delta =
                    (event.shiftKey ? 40 : 8) /
                    Math.max(
                      1,
                      (row ? split.rect.width : split.rect.height) -
                        SPLITTER_SIZE,
                    );
                  const ratio =
                    event.key === "Home"
                      ? bounds.min
                      : event.key === "End"
                        ? bounds.max
                        : split.ratio +
                          (event.key === backward ? -delta : delta);
                  update(
                    resizeSplit(layoutRef.current, split.node.id, ratio),
                    true,
                  );
                }}
              >
                <span />
              </div>
            );
          })}
        {drag && targetGroup && dropPreview && (
          <>
            <div
              className={`dock-drop-preview ${drag.zone === "center" ? "merge" : ""}`}
              data-drop-preview={drag.zone}
              style={position(dropPreview)}
            >
              <span>{zoneNames[drag.zone]}</span>
            </div>
            <div
              className="dock-targets"
              style={{
                left: targetGroup.rect.x + targetGroup.rect.width / 2,
                top: targetGroup.rect.y + targetGroup.rect.height / 2,
              }}
            >
              {zones.map((zone) => {
                const Icon = zoneIcons[zone];
                return (
                  <div
                    key={zone}
                    data-dock-zone={zone}
                    className={`dock-target target-${zone} ${drag.zone === zone ? "active" : ""}`}
                    title={zoneNames[zone]}
                  >
                    <Icon size={17} />
                  </div>
                );
              })}
            </div>
          </>
        )}
        {drag && (
          <div
            className="dock-drag-label"
            style={{ left: drag.x + 15, top: drag.y + 19 }}
          >
            <GripVertical size={13} />
            {panelNames[drag.panel]}
            <small>Esc 取消</small>
          </div>
        )}
      </div>
      <div className="workbench-foot">
        <span>
          <Move size={11} />
          {compact
            ? "窄屏模式 · 面板顺序排列"
            : "拖动标签：四边拆分 / 中央合并 · 拖动分隔线联动缩放 · 双击标题最大化"}
        </span>
        <div>
          {layout.hidden.map((id) => (
            <button key={id} onClick={() => toggle(id)}>
              <Plus size={10} />
              {panelNames[id]}
            </button>
          ))}
          <span className="layout-save-note">布局随作品保存</span>
        </div>
      </div>
    </main>
  );
}
