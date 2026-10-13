import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Check, Copy, Download, Search, X } from "lucide-react";
import type { GuidePage } from "./guideRoute";
import start from "../../docs/API_GUIDE.md?raw";
import ai from "../../docs/AI_API.md?raw";
import mcp from "../../docs/MCP_GUIDE.md?raw";
import http from "../../docs/HTTP_API.md?raw";
import io from "../../docs/IO_GUIDE.md?raw";
import "./docs.css";

const documents: {
  id: GuidePage;
  title: string;
  summary: string;
  file: string;
  source: string;
}[] = [
  {
    id: "start",
    title: "接入总览",
    summary: "选择方式，完成第一次接入",
    file: "API_GUIDE.md",
    source: start,
  },
  {
    id: "ai",
    title: "AI 服务",
    summary: "语言、图片、音乐与 3D",
    file: "AI_API.md",
    source: ai,
  },
  {
    id: "mcp",
    title: "MCP 与 AI 对话",
    summary: "外部工具和对话操作项目",
    file: "MCP_GUIDE.md",
    source: mcp,
  },
  {
    id: "http",
    title: "项目 HTTP API",
    summary: "管理作品、运行与导出",
    file: "HTTP_API.md",
    source: http,
  },
  {
    id: "io",
    title: "设备与实时协议",
    summary: "OSC、MIDI、网络和文件",
    file: "IO_GUIDE.md",
    source: io,
  },
];
type Heading = { id: string; title: string; level: number };
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
const plainText = (value: ReactNode): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : Array.isArray(value)
      ? value.map(plainText).join("")
      : value && typeof value === "object" && "props" in value
        ? plainText((value.props as { children?: ReactNode }).children)
        : "";

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const text = plainText(children).replace(/\n$/, "");
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        const previous = document.activeElement as HTMLElement | null;
        document.body.append(input);
        input.select();
        const result = document.execCommand("copy");
        input.remove();
        previous?.focus();
        if (!result) throw new Error("copy");
      }
      setCopied(true);
      setError("");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请选中代码后手动复制。");
    }
  };
  return (
    <div className="guide-code">
      <button
        className="guide-copy"
        onClick={copy}
        aria-label={copied ? "代码已复制" : "复制代码"}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre>{children}</pre>
      {error && <small role="status">{error}</small>}
    </div>
  );
}

function DocsCenter({
  page,
  navigate,
  close,
}: {
  page: GuidePage;
  navigate: (page: GuidePage) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState(""),
    [headings, setHeadings] = useState<Heading[]>([]);
  const [pendingAnchor, setPendingAnchor] = useState("");
  const panel = useRef<HTMLElement>(null),
    article = useRef<HTMLElement>(null),
    search = useRef<HTMLInputElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const active = documents.find((doc) => doc.id === page)!;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    search.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input, select, [tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => {
      window.removeEventListener("keydown", keyboard, true);
      document.body.style.overflow = previousOverflow;
      previous?.isConnected && previous.focus();
    };
  }, []);
  useEffect(() => {
    const seen = new Map<string, number>();
    const rows = Array.from(
      article.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4") || [],
    ).map((el) => {
      const title = el.textContent || "",
        base = slug(title),
        count = seen.get(base) || 0;
      seen.set(base, count + 1);
      el.id = count ? `${base}-${count}` : base;
      return { id: el.id, title, level: Number(el.tagName[1]) };
    });
    setHeadings(rows);
    article.current?.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    if (!pendingAnchor) return;
    document.getElementById(pendingAnchor)?.scrollIntoView({ block: "start" });
    setPendingAnchor("");
  }, [page, pendingAnchor]);
  const go = (target: GuidePage, anchor = "") => {
    setQuery("");
    setPendingAnchor(anchor);
    navigate(target);
  };
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      table: ({ children }) => (
        <div className="guide-table" tabIndex={0}>
          <table>{children}</table>
        </div>
      ),
      a: ({ href = "", children }) => {
        const [file, rawAnchor = ""] = href.split("#");
        const target = documents.find(
          (doc) => file.split("/").pop() === doc.file,
        );
        if (!file || target)
          return (
            <a
              href={target ? `#guide/${target.id}` : href}
              onClick={(event) => {
                event.preventDefault();
                let anchor = rawAnchor;
                try {
                  anchor = decodeURIComponent(rawAnchor);
                } catch {}
                if (target) go(target.id, anchor);
                else
                  document
                    .getElementById(anchor)
                    ?.scrollIntoView({ block: "start" });
              }}
            >
              {children}
            </a>
          );
        const external = /^(https?:|mailto:)/.test(href);
        const resolved = external
          ? href
          : `https://github.com/GreyNails/td-open/blob/main/${href.startsWith("../") ? href.slice(3) : "docs/" + href.replace(/^\.\//, "")}`;
        return (
          <a href={resolved} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      img: ({ src = "", alt }) => (
        <img
          src={
            /^https?:/.test(src)
              ? src
              : `https://raw.githubusercontent.com/GreyNails/td-open/main/docs/${src.replace(/^\.\//, "")}`
          }
          alt={alt || "文档示意图"}
          loading="lazy"
        />
      ),
    }),
    [page],
  );
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return documents.flatMap((doc) => {
      const at = doc.source.toLocaleLowerCase().indexOf(needle);
      return at < 0
        ? []
        : [
            {
              ...doc,
              excerpt:
                (at > 70 ? "…" : "") +
                doc.source
                  .slice(Math.max(0, at - 70), at + needle.length + 120)
                  .replace(/[#*`|]/g, "") +
                "…",
            },
          ];
    });
  }, [query]);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([active.source], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = active.file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div
      className="docs-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="docs-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        ref={panel}
      >
        <header className="guide-header">
          <div>
            <span>TD OPEN · 开发与接入</span>
            <h2 id="guide-title">
              <BookOpen size={21} />
              API 接入文档
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="关闭 API 接入文档"
          >
            <X size={22} />
          </button>
        </header>
        <div className="guide-layout">
          <aside className="guide-sidebar">
            <label className="guide-search">
              <Search size={16} />
              <input
                ref={search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索全部文档…"
                aria-label="搜索 API 文档"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="清除文档搜索">
                  <X size={14} />
                </button>
              )}
            </label>
            <nav aria-label="API 文档章节">
              {documents.map((doc, index) => (
                <button
                  key={doc.id}
                  className={page === doc.id ? "active" : ""}
                  aria-current={page === doc.id ? "page" : undefined}
                  onClick={() => go(doc.id)}
                >
                  <span>0{index + 1}</span>
                  <div>
                    <strong>{doc.title}</strong>
                    <small>{doc.summary}</small>
                  </div>
                </button>
              ))}
            </nav>
            <p className="guide-offline">
              与仓库文档同步 · 可离线阅读
              <br />按 Esc 返回创作
            </p>
          </aside>
          <main className="guide-main">
            <div className="guide-toolbar">
              <span>{query.trim() ? "搜索全部文档" : active.title}</span>
              <button className="button small" onClick={download}>
                <Download size={15} />
                下载 Markdown
              </button>
            </div>
            {!query.trim() && (
              <label className="guide-mobile-outline">
                本页目录
                <select
                  aria-label="跳转到文档章节"
                  value=""
                  onChange={(event) =>
                    document
                      .getElementById(event.target.value)
                      ?.scrollIntoView({ block: "start" })
                  }
                >
                  <option value="">选择章节…</option>
                  {headings
                    .filter((heading) => heading.level > 1)
                    .map((heading) => (
                      <option key={heading.id} value={heading.id}>
                        {heading.level >= 3 ? "　" : ""}
                        {heading.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {query.trim() && (
              <div className="guide-results" aria-live="polite">
                <p>
                  在 {results.length} 篇文档中找到“{query.trim()}”
                </p>
                {results.map((doc) => (
                  <button key={doc.id} onClick={() => go(doc.id)}>
                    <strong>{doc.title}</strong>
                    <span>{doc.excerpt}</span>
                    <small>打开完整文档 →</small>
                  </button>
                ))}
                {!results.length && (
                  <p>没有匹配结果。试试“API Key”“MCP”或“OSC”。</p>
                )}
              </div>
            )}
            <article
              ref={article}
              className="guide-markdown"
              hidden={Boolean(query.trim())}
              aria-label={`${active.title}文档`}
            >
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={components}
                skipHtml
              >
                {active.source}
              </Markdown>
            </article>
          </main>
          <aside className="guide-outline" aria-label="本页目录">
            <strong>本页目录</strong>
            <nav>
              {headings
                .filter((heading) => heading.level > 1)
                .map((heading) => (
                  <button
                    key={heading.id}
                    className={heading.level >= 3 ? "nested" : ""}
                    onClick={() => {
                      setQuery("");
                      requestAnimationFrame(() =>
                        document
                          .getElementById(heading.id)
                          ?.scrollIntoView({ block: "start" }),
                      );
                    }}
                  >
                    {heading.title}
                  </button>
                ))}
            </nav>
          </aside>
        </div>
      </section>
    </div>
  );
}
export default memo(DocsCenter);
