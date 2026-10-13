import { useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import {
  GripHorizontal,
  Maximize2,
  Minimize2,
  Minus,
  PanelsTopLeft,
  RotateCcw,
  Move,
  Check,
  Magnet,
  ChevronDown,
  LayoutDashboard,
  PanelTop,
  Scan,
  Plus,
} from "lucide-react";
import {
  panelIds,
  panelNames,
  presetLayout,
  readLayout,
  dragRect,
  resizeRect,
} from "./workspaceLayout";
import type { PanelId, WorkspaceLayout } from "./workspaceLayout";

type Props = {
  saved: unknown;
  panels: Record<PanelId, ReactNode>;
  onChange: (layout: WorkspaceLayout) => void;
  nodeCount: number;
  onAdd: () => void;
};
export default function Workbench({
  saved,
  panels,
  onChange,
  nodeCount,
  onAdd,
}: Props) {
  const stage = useRef<HTMLDivElement>(null),
    initial = useRef(saved),
    layoutRef = useRef<WorkspaceLayout>(readLayout(saved, 1280, 760)),
    onChangeRef = useRef(onChange);
  const [layout, setLayout] = useState(layoutRef.current),
    [maximized, setMaximized] = useState<PanelId | null>(null),
    [menu, setMenu] = useState(false),
    [moving, setMoving] = useState(""),
    [measured, setMeasured] = useState(false),
    [compact, setCompact] = useState(false);
  onChangeRef.current = onChange;
  layoutRef.current = layout;
  const lastPublished = useRef(saved),
    dragCleanup = useRef<(() => void) | null>(null);
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
    let first = true;
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      const mobile = width < 800;
      setCompact(mobile);
      if (mobile) {
        setMeasured(true);
        return;
      }
      if (width < 100 || height < 100) return;
      const next = readLayout(
        first ? initial.current : layoutRef.current,
        width,
        height,
      );
      first = false;
      update(next);
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
    const current = layoutRef.current;
    update(
      readLayout(saved, current.reference.width, current.reference.height),
    );
    lastPublished.current = saved;
  }, [saved]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".workbench-layout-menu"))
        setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const front = (id: PanelId, base = layoutRef.current) => ({
    ...base,
    order: [...base.order.filter((p) => p !== id), id],
  });
  const begin = (e: ReactPointerEvent, id: PanelId, edge?: string) => {
    if (e.button !== 0 || compact || maximized) return;
    if (!edge && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    dragCleanup.current?.();
    const start = layoutRef.current.panels[id],
      sx = e.clientX,
      sy = e.clientY;
    const base = front(id);
    update(base);
    setMoving(id);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      const { width, height } = base.reference;
      const r = edge
        ? resizeRect(
            start,
            event.clientX - sx,
            event.clientY - sy,
            edge,
            id,
            width,
            height,
            base.snap,
          )
        : dragRect(
            start,
            event.clientX - sx,
            event.clientY - sy,
            id,
            width,
            height,
            base.snap,
          );
      update({
        ...base,
        preset: "custom",
        panels: { ...base.panels, [id]: { ...r, visible: true } },
      });
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {}
      setMoving("");
      dragCleanup.current = null;
    };
    const finish = () => {
      cleanup();
      update(layoutRef.current, true);
    };
    dragCleanup.current = cleanup;
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  };
  const toggle = (id: PanelId) => {
    const current = layoutRef.current;
    const visible = !current.panels[id].visible;
    update(
      front(id, {
        ...current,
        panels: { ...current.panels, [id]: { ...current.panels[id], visible } },
      }),
      true,
    );
    if (maximized === id) setMaximized(null);
  };
  const choose = (preset: string) => {
    const { width, height } = layoutRef.current.reference;
    update(presetLayout(width, height, preset), true);
    setMaximized(null);
    setMenu(false);
  };
  return (
    <main
      className={`workbench ${compact ? "compact" : ""} ${moving ? "is-moving" : ""}`}
    >
      <div className="workbench-toolbar">
        <div className="workbench-title">
          <PanelsTopLeft size={17} />
          <strong>自由工作台</strong>
          <span>{nodeCount} 个可用节点</span>
        </div>
        <div className="workbench-tools">
          <button className="button subtle small" onClick={onAdd}>
            <Plus size={14} />
            添加节点 <kbd>Tab</kbd>
          </button>
          <button
            className={`icon-button ${layout.snap ? "on" : ""}`}
            title={layout.snap ? "关闭面板网格吸附" : "开启面板网格吸附"}
            aria-pressed={layout.snap}
            onClick={() =>
              update(
                { ...layoutRef.current, snap: !layoutRef.current.snap },
                true,
              )
            }
          >
            <Magnet size={15} />
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
                    标准工作台<small>预览、画布与工具各就其位</small>
                  </span>
                </button>
                <button onClick={() => choose("canvas")}>
                  <Scan size={15} />
                  <span>
                    画布优先<small>大画布 + 浮动预览与参数</small>
                  </span>
                </button>
                <button onClick={() => choose("visual")}>
                  <PanelTop size={15} />
                  <span>
                    视觉优先<small>放大预览，保留底部节点区</small>
                  </span>
                </button>
                <span className="popover-label">显示面板</span>
                {panelIds.map((id) => (
                  <button key={id} onClick={() => toggle(id)}>
                    <span className="panel-check">
                      {layout.panels[id].visible && <Check size={13} />}
                    </span>
                    {panelNames[id]}
                  </button>
                ))}
                <div className="layout-menu-foot">
                  <Move size={13} />
                  拖动标题栏移动 · 拖动边缘缩放
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
          const r = layout.panels[id],
            max = maximized === id;
          const hidden = !r.visible || Boolean(maximized && !max);
          return (
            <section
              key={id}
              data-panel={id}
              className={`dock-panel ${max ? "maximized" : ""} ${moving === id ? "dragging" : ""}`}
              aria-label={panelNames[id] + "面板"}
              style={
                compact
                  ? { display: r.visible ? "flex" : "none" }
                  : {
                      left: max ? 0 : r.x,
                      top: max ? 0 : r.y,
                      width: max ? "100%" : r.width,
                      height: max ? "100%" : r.height,
                      zIndex: max ? 30 : layout.order.indexOf(id) + 1,
                      visibility: hidden ? "hidden" : "visible",
                      pointerEvents: hidden ? "none" : undefined,
                    }
              }
              onClick={() => {
                if (layoutRef.current.preset === "canvas" && id === "graph")
                  return;
                if (layoutRef.current.order.at(-1) !== id)
                  update(front(id), true);
              }}
            >
              <div
                className="dock-titlebar"
                onPointerDown={(e) => begin(e, id)}
                onDoubleClick={(e) => {
                  if (!(e.target as Element).closest("button") && !compact)
                    setMaximized(max ? null : id);
                }}
              >
                <GripHorizontal size={14} className="dock-grip" />
                <span>{panelNames[id]}</span>
                {id === "graph" && <small>INFINITE CANVAS</small>}
                <div className="dock-actions">
                  <button
                    className="icon-button"
                    title={`隐藏${panelNames[id]}面板`}
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
                    onClick={() => setMaximized(max ? null : id)}
                  >
                    {max ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  </button>
                </div>
              </div>
              <div className="dock-content">{panels[id]}</div>
              {!compact &&
                !max &&
                ["n", "e", "s", "w", "ne", "nw", "se", "sw"].map((edge) => (
                  <div
                    key={edge}
                    className={`panel-resize resize-${edge}`}
                    role="separator"
                    tabIndex={0}
                    aria-label={`调整${panelNames[id]}大小 ${edge}`}
                    aria-orientation={
                      edge === "e" || edge === "w" ? "vertical" : "horizontal"
                    }
                    onPointerDown={(e) => begin(e, id, edge)}
                    onKeyDown={(e) => {
                      const delta = e.shiftKey ? 40 : 8;
                      if (
                        ![
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                        ].includes(e.key)
                      )
                        return;
                      e.preventDefault();
                      const current = layoutRef.current;
                      const size = resizeRect(
                        current.panels[id],
                        e.key === "ArrowLeft"
                          ? -delta
                          : e.key === "ArrowRight"
                            ? delta
                            : 0,
                        e.key === "ArrowUp"
                          ? -delta
                          : e.key === "ArrowDown"
                            ? delta
                            : 0,
                        edge,
                        id,
                        current.reference.width,
                        current.reference.height,
                        current.snap,
                      );
                      update(
                        {
                          ...current,
                          preset: "custom",
                          panels: {
                            ...current.panels,
                            [id]: { ...size, visible: true },
                          },
                        },
                        true,
                      );
                    }}
                  />
                ))}
            </section>
          );
        })}
      </div>
      <div className="workbench-foot">
        <span>
          <Move size={11} />
          {compact
            ? "窄屏模式 · 面板顺序排列"
            : "拖动标题栏自由排列 · 拖动面板边缘调整大小 · 双击标题栏最大化"}
        </span>
        <div>
          {panelIds
            .filter((id) => !layout.panels[id].visible)
            .map((id) => (
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
