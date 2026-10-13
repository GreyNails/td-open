import { useEffect, useState } from "react";
import {
  X,
  Plus,
  Plug,
  KeyRound,
  Check,
  LoaderCircle,
  ExternalLink,
  Trash2,
  BookOpen,
  Pencil,
} from "lucide-react";
import { api, uid } from "./types";
import type { Provider } from "./types";
import type { GuidePage } from "./guideRoute";
import "./settings-guide.css";
type Server = {
  id: string;
  name: string;
  url: string;
  allowed_tools?: string[] | null;
  has_token?: boolean;
};
export default function Settings({
  close,
  notify,
  openGuide,
}: {
  close: () => void;
  notify: (s: string) => void;
  openGuide: (page: GuidePage) => void;
}) {
  const [tab, setTab] = useState("ai"),
    [providers, setProviders] = useState<Provider[]>([]),
    [servers, setServers] = useState<Server[]>([]),
    [busy, setBusy] = useState(false),
    [tools, setTools] = useState<Record<string, unknown[]>>({});
  const [form, setForm] = useState({
    id: uid("provider"),
    name: "我的 AI 服务",
    kind: "openai",
    base_url: "https://api.openai.com/v1",
    api_key: "",
    model: "",
    capability: "text",
    path: "/generate",
    body_template: '{"prompt":"{{prompt}}","model":"{{model}}"}',
  });
  const [server, setServer] = useState({
    id: uid("mcp"),
    name: "MCP 服务",
    url: "http://127.0.0.1:3000/mcp",
    token: "",
  });
  const [editingServer, setEditingServer] = useState(false);
  const [toolPolicy, setToolPolicy] = useState("all");
  const [allowedTools, setAllowedTools] = useState("");
  const newServer = () => {
    setServer({
      id: uid("mcp"),
      name: "MCP 服务",
      url: "http://127.0.0.1:3000/mcp",
      token: "",
    });
    setEditingServer(false);
    setToolPolicy("all");
    setAllowedTools("");
  };
  const refresh = () =>
    Promise.all([
      api<Provider[] | { providers: Provider[] }>("/providers").then((r) =>
        setProviders(Array.isArray(r) ? r : r.providers),
      ),
      api<Server[] | { servers: Server[] }>("/mcp/servers").then((r) =>
        setServers(Array.isArray(r) ? r : r.servers),
      ),
    ]);
  useEffect(() => {
    refresh().catch((e) => notify(e.message));
  }, []);
  const field = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        id: form.id,
        name: form.name,
        kind: form.kind,
        base_url: form.base_url,
        model: form.model,
        capability: form.capability,
        api_key: form.api_key || undefined,
        path: form.kind === "http" ? form.path || "/generate" : undefined,
        body_template:
          form.kind === "http" ? JSON.parse(form.body_template) : undefined,
      };
      await api("/providers", body);
      await refresh();
      setForm((f) => ({ ...f, id: uid("provider"), api_key: "" }));
      notify("AI 服务已保存，密钥只保留在本机后端");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveMCP = async () => {
    setBusy(true);
    try {
      const names = [
        ...new Set(
          allowedTools
            .split(/[,，\n]/)
            .map((name) => name.trim())
            .filter(Boolean),
        ),
      ];
      if (toolPolicy === "selected" && !names.length)
        throw new Error("请填写至少一个工具名，或选择“禁止全部工具”");
      await api("/mcp/servers", {
        ...server,
        token: server.token || undefined,
        allowed_tools:
          toolPolicy === "all" ? null : toolPolicy === "none" ? [] : names,
      });
      await refresh();
      setServer((s) => ({ ...s, token: "" }));
      setEditingServer(true);
      notify("MCP 连接配置已保存");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="连接设置"
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">CONNECTED CREATIVITY</span>
            <h2>连接你的 AI 工具箱</h2>
            <p>服务由你选择，创作始终在你手中。</p>
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭设置">
            <X size={20} />
          </button>
        </div>
        <div className="modal-tabs">
          <button
            className={tab === "ai" ? "active" : ""}
            onClick={() => setTab("ai")}
          >
            <KeyRound size={16} /> AI 服务
          </button>
          <button
            className={tab === "mcp" ? "active" : ""}
            onClick={() => setTab("mcp")}
          >
            <Plug size={16} /> MCP 连接
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-guide-link">
            <div>
              <strong>第一次接入，跟着指南完成配置</strong>
              <p>
                {tab === "ai"
                  ? "API 地址、密钥、模型名称与完整请求示例。"
                  : "连接外部工具，或让 AI 对话操作 TD Open。"}
              </p>
            </div>
            <button
              className="button small"
              onClick={() => openGuide(tab === "ai" ? "ai" : "mcp")}
            >
              <BookOpen size={15} />
              接入指南
            </button>
          </div>
          {tab === "ai" ? (
            <>
              <div className="saved-services">
                {providers.length === 0 ? (
                  <div className="empty-note">
                    还没有连接服务。添加一个服务后，就能在节点和对话中使用。
                  </div>
                ) : (
                  providers.map((p) => (
                    <button
                      key={p.id}
                      className="service"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          ...p,
                          api_key: "",
                          body_template:
                            typeof p.body_template === "object"
                              ? JSON.stringify(p.body_template, null, 2)
                              : String(p.body_template || f.body_template),
                        }))
                      }
                    >
                      <span className="service-icon">
                        <Plug size={17} />
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.id} · {p.capability} · {p.model || "自定义模型"}
                        </small>
                      </span>
                      <Check size={14} />
                    </button>
                  ))
                )}
              </div>
              <div className="form-grid">
                <label>
                  服务名称
                  <input
                    value={form.name}
                    onChange={(e) => field("name", e.target.value)}
                  />
                </label>
                <label>
                  协议
                  <select
                    value={form.kind}
                    onChange={(e) => field("kind", e.target.value)}
                  >
                    <option value="openai">OpenAI 兼容</option>
                    <option value="http">自定义 HTTP</option>
                  </select>
                </label>
                <label>
                  生成类型
                  <select
                    value={form.capability}
                    onChange={(e) => field("capability", e.target.value)}
                  >
                    <option value="text">语言 / 对话</option>
                    <option value="image">图片</option>
                    <option value="music">音乐</option>
                    <option value="3d">3D 模型</option>
                  </select>
                </label>
                <label>
                  模型名称
                  <input
                    placeholder="填写服务商提供的模型 ID"
                    value={form.model}
                    onChange={(e) => field("model", e.target.value)}
                  />
                </label>
                <label className="span-2">
                  API 基础地址
                  <input
                    value={form.base_url}
                    onChange={(e) => field("base_url", e.target.value)}
                    placeholder="https://your-provider.com/v1"
                  />
                </label>
                <label className="span-2">
                  API Key <span className="muted">· 留空保留已有密钥</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.api_key}
                    onChange={(e) => field("api_key", e.target.value)}
                    placeholder="密钥只保存在服务器，不写入作品文件"
                  />
                </label>
                {form.kind === "http" && (
                  <>
                    <label className="span-2">
                      请求路径
                      <input
                        value={form.path}
                        onChange={(e) => field("path", e.target.value)}
                      />
                    </label>
                    <label className="span-2">
                      请求体模板{" "}
                      <span className="muted">
                        · 使用 {"{{prompt}}"} 和 {"{{model}}"}
                      </span>
                      <textarea
                        rows={4}
                        value={form.body_template}
                        onChange={(e) => field("body_template", e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
              <p className="form-tip">
                OpenAI 兼容协议支持文本与图片；音乐、3D 及其他服务使用自定义
                HTTP。异步任务需按服务商返回的任务 ID 查询结果。
              </p>
              <button className="button primary" disabled={busy} onClick={save}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                保存服务
              </button>
            </>
          ) : (
            <>
              <div className="saved-services">
                {servers.length === 0 && (
                  <div className="empty-note">
                    通过 Streamable HTTP 连接 MCP 服务器，然后发现和调用工具。
                  </div>
                )}
                {servers.map((s) => (
                  <div key={s.id} className="mcp-item">
                    <div className="service">
                      <button
                        className="mcp-edit"
                        aria-label={`编辑 MCP 连接 ${s.name}`}
                        onClick={() => {
                          setServer({
                            id: s.id,
                            name: s.name,
                            url: s.url,
                            token: "",
                          });
                          setEditingServer(true);
                          setToolPolicy(
                            s.allowed_tools == null
                              ? "all"
                              : s.allowed_tools.length
                                ? "selected"
                                : "none",
                          );
                          setAllowedTools((s.allowed_tools || []).join(", "));
                        }}
                      >
                        <Plug size={18} />
                        <span>
                          <strong>{s.name}</strong>
                          <small>{s.url}</small>
                          <small>
                            {s.allowed_tools == null
                              ? "不限工具"
                              : s.allowed_tools.length
                                ? `${s.allowed_tools.length} 个指定工具`
                                : "禁止全部工具"}
                            {s.has_token ? " · 已保存 Token" : ""}
                          </small>
                        </span>
                        <Pencil size={13} />
                      </button>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const r = await api<
                              unknown[] | { tools: unknown[] }
                            >(`/mcp/servers/${s.id}/tools`, {});
                            setTools((t) => ({
                              ...t,
                              [s.id]: Array.isArray(r) ? r : r.tools,
                            }));
                            notify("工具发现完成");
                          } catch (e) {
                            notify((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        发现工具
                      </button>
                    </div>
                    {tools[s.id] && (
                      <pre className="tool-result">
                        {JSON.stringify(tools[s.id], null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
              <div className="mcp-form-head">
                <strong>
                  {editingServer ? "编辑已有 MCP 连接" : "添加 MCP 连接"}
                </strong>
                <button className="button small" onClick={newServer}>
                  <Plus size={14} />
                  新增连接
                </button>
              </div>
              <div className="form-grid">
                <label>
                  服务名称
                  <input
                    value={server.name}
                    onChange={(e) =>
                      setServer((s) => ({ ...s, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  服务 ID
                  <input
                    value={server.id}
                    readOnly={editingServer}
                    title={
                      editingServer
                        ? "已有连接的服务 ID 不可修改；新连接请点击“新增连接”"
                        : undefined
                    }
                    onChange={(e) =>
                      setServer((s) => ({ ...s, id: e.target.value }))
                    }
                  />
                </label>
                <label className="span-2">
                  Streamable HTTP 地址
                  <input
                    value={server.url}
                    onChange={(e) =>
                      setServer((s) => ({ ...s, url: e.target.value }))
                    }
                  />
                </label>
                <label className="span-2">
                  Bearer Token{" "}
                  <span className="muted">· 留空保留已有 Token</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="填写新 Token 可替换已保存凭证"
                    value={server.token}
                    onChange={(e) =>
                      setServer((s) => ({ ...s, token: e.target.value }))
                    }
                  />
                </label>
                <label className="span-2">
                  工具权限
                  <select
                    value={toolPolicy}
                    onChange={(e) => setToolPolicy(e.target.value)}
                  >
                    <option value="all">不限制工具</option>
                    <option value="none">禁止全部工具</option>
                    <option value="selected">仅允许指定工具</option>
                  </select>
                </label>
                {toolPolicy === "selected" && (
                  <label className="span-2">
                    允许的工具名称
                    <textarea
                      value={allowedTools}
                      onChange={(e) => setAllowedTools(e.target.value)}
                      rows={3}
                      placeholder="例如：search, get_weather（逗号或换行分隔）"
                    />
                  </label>
                )}
                <p className="mcp-permissions-note">
                  工具名需与 MCP
                  服务返回的名称完全一致。选择“禁止全部工具”会阻止所有工具调用；保存已有连接时会保留当前权限设置。
                </p>
              </div>
              <p className="form-tip">
                工具节点会显示服务和工具名，并由你手动执行。也可通过本项目的
                stdio MCP 服务，让外部 AI 操作项目。
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={saveMCP}
              >
                <Plus size={16} />
                保存连接
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
