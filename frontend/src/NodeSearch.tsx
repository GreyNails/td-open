import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ArrowRight, Star, Plus, Link2 } from "lucide-react";
import { catalog, familyColors } from "./catalog";
export default function NodeSearch({
  close,
  add,
  favorites,
  toggleFavorite,
  canConnect,
}: {
  close: () => void;
  add: (type: string, connect: boolean) => void;
  favorites: string[];
  toggleFavorite: (type: string) => void;
  canConnect: boolean;
}) {
  const [query, setQuery] = useState(""),
    [family, setFamily] = useState("全部"),
    [active, setActive] = useState(0),
    [connect, setConnect] = useState(canConnect);
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () =>
      catalog.filter(
        (n) =>
          (family === "全部" ||
            (family === "收藏" && favorites.includes(n.type)) ||
            family === n.family) &&
          query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .every((q) =>
              `${n.label} ${n.english} ${n.type} ${n.description}`
                .toLowerCase()
                .includes(q),
            ),
      ),
    [query, family, favorites],
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    setActive(0);
  }, [query, family]);
  useEffect(() => {
    setActive((i) => Math.max(0, Math.min(i, items.length - 1)));
  }, [items.length]);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div
      className="modal-backdrop node-search-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="快捷添加节点"
        className="node-search-modal"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
          if (e.key === "Tab") {
            const controls = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled)",
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (e.shiftKey && e.target === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && e.target === last) {
              e.preventDefault();
              first?.focus();
            }
          }
          if (e.target !== input.current) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, items.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            add(items[active].type, connect);
          }
        }}
      >
        <div className="node-search-header">
          <Search size={21} />
          <input
            ref={input}
            aria-label="搜索全部节点"
            placeholder={`搜索 ${catalog.length} 个节点，例如：万花筒、lag、JSON…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>Esc</kbd>
          <button
            className="icon-button"
            onClick={close}
            aria-label="关闭节点搜索"
          >
            <X size={18} />
          </button>
        </div>
        <div className="node-search-families">
          {[
            "全部",
            "收藏",
            "TOP",
            "CHOP",
            "SOP",
            "COMP",
            "MAT",
            "DAT",
            "AI",
            "OUT",
          ].map((f) => (
            <button
              key={f}
              className={family === f ? "active" : ""}
              onClick={() => setFamily(f)}
            >
              {f === "收藏" ? <Star size={11} /> : null}
              {f}
              <small>
                {f === "全部"
                  ? catalog.length
                  : f === "收藏"
                    ? favorites.length
                    : catalog.filter((n) => n.family === f).length}
              </small>
            </button>
          ))}
        </div>
        <div className="node-search-results" ref={list}>
          {items.map((n, i) => (
            <div
              key={n.type}
              data-index={i}
              className={`search-node-row ${active === i ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
            >
              <button
                className="search-node-main"
                onClick={() => add(n.type, connect)}
              >
                <span
                  className="search-family"
                  style={{
                    color: familyColors[n.family],
                    background: familyColors[n.family] + "17",
                  }}
                >
                  {n.family}
                </span>
                <span>
                  <strong>
                    {n.label}
                    <small>{n.english}</small>
                  </strong>
                  <p>{n.description}</p>
                </span>
                <Plus size={16} />
              </button>
              <button
                className={`favorite-node ${favorites.includes(n.type) ? "is-favorite" : ""}`}
                title={
                  favorites.includes(n.type)
                    ? "取消收藏" + n.label
                    : "收藏" + n.label
                }
                onClick={() => toggleFavorite(n.type)}
              >
                <Star
                  size={14}
                  fill={favorites.includes(n.type) ? "currentColor" : "none"}
                />
              </button>
            </div>
          ))}
          {!items.length && (
            <div className="node-search-empty">
              没有匹配的节点，试试类别名称或英文关键字。
            </div>
          )}
        </div>
        <div className="node-search-footer">
          <label>
            <input
              type="checkbox"
              disabled={!canConnect}
              checked={connect && canConnect}
              onChange={(e) => setConnect(e.target.checked)}
            />
            <Link2 size={13} />
            自动连接选中节点的兼容输出
          </label>
          <span>
            ↑ ↓ 选择 <kbd>Enter</kbd> 添加
            <ArrowRight size={13} />
          </span>
        </div>
      </section>
    </div>
  );
}
