import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { templates } from "./templates";
import { byType } from "./catalog";
import "./examples.css";

export function TemplateGallery({ open }: { open: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [beginner, setBeginner] = useState(false);
  const categories = ["全部", ...new Set(templates.map((t) => t.category))];
  const filtered = useMemo(
    () =>
      templates.filter((t) => {
        const names =
          t.recipe?.nodes
            .map((n) => byType[typeof n === "string" ? n : n[0]])
            .map((n) => `${n?.label} ${n?.english}`)
            .join(" ") ?? "";
        return (
          (category === "全部" || t.category === category) &&
          (!beginner || t.level === "入门") &&
          `${t.name} ${t.description} ${t.learn} ${names}`
            .toLowerCase()
            .includes(query.toLowerCase().trim())
        );
      }),
    [query, category, beginner],
  );
  return (
    <div className="example-gallery">
      <div className="example-search-row">
        <label className="example-search">
          <Search size={16} />
          <input
            autoFocus
            aria-label="搜索案例"
            placeholder="搜索效果、节点或创作方向…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="清空案例搜索" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <button
          className={`example-level ${beginner ? "active" : ""}`}
          aria-pressed={beginner}
          onClick={() => setBeginner((v) => !v)}
        >
          <SlidersHorizontal size={14} /> 只看入门
        </button>
      </div>
      <div className="example-categories" aria-label="案例分类">
        {categories.map((c) => (
          <button
            key={c}
            aria-pressed={category === c}
            className={category === c ? "active" : ""}
            onClick={() => setCategory(c)}
          >
            {c}
            <span>
              {c === "全部"
                ? templates.length
                : templates.filter((t) => t.category === c).length}
            </span>
          </button>
        ))}
      </div>
      <div className="example-summary">
        <span>{filtered.length} 个案例 · 原件保留，编辑自动另存为你的项目</span>
        <span>打开 → 编辑 → 自动保存到「我的作品」</span>
      </div>
      <div className="example-scroll">
        <div className="template-grid example-grid">
          {filtered.map((t) => (
            <button
              className="template-card example-card"
              key={t.id}
              data-example={t.id}
              onClick={() => open(t.id)}
            >
              <div className="example-art">
                <img
                  src={`/examples/${t.id}.webp`}
                  alt={
                    t.requires === "ai" ||
                    t.requires === "mcp" ||
                    t.requires === "local"
                      ? `${t.name}工作流连接说明`
                      : `${t.name}实际渲染效果`
                  }
                  loading="lazy"
                />
                <span className="example-badge">{t.level}</span>
                {t.requires && (
                  <span className="example-requires">
                    {t.requires === "audio"
                      ? "可连接音频"
                      : t.requires === "mcp"
                        ? "需连接 MCP"
                        : t.requires === "local"
                          ? "需安装本地模型"
                          : "需配置 AI"}
                  </span>
                )}
                <span className="example-open">
                  <ArrowUpRight size={21} />
                </span>
              </div>
              <div className="example-copy">
                <div className="example-meta">
                  <span>{t.category}</span>
                  <span>
                    {t.recipe ? `${t.recipe.nodes.length} 节点` : "起步作品"}
                  </span>
                </div>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <div className="example-learn">
                  <Sparkles size={12} />
                  <span>{t.learn}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <div className="example-empty">
            没有匹配的案例。试试“三维”“文字”或“噪声”。
            <button
              className="button subtle"
              onClick={() => {
                setQuery("");
                setCategory("全部");
                setBeginner(false);
              }}
            >
              重置筛选
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
