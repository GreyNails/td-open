import { useEffect, useRef, useState } from "react";
import {
  Cpu,
  Download,
  LoaderCircle,
  Play,
  Square,
  X,
  BookOpen,
  RefreshCw,
  Plus,
  Search,
  FileCode2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { api } from "./types";
import type { GraphNode, Params } from "./types";
import { localNodeProfile } from "./nodes/localAICatalog";
import "./local-ai.css";

export type LocalOutput = {
  url: string;
  name: string;
  kind: string;
  size: number;
  source_node: string;
};
export type LocalJob = {
  id: string;
  kind: "generate" | "install";
  status: string;
  progress: number;
  message: string;
  profile_id?: string;
  profile_ids?: string[];
  outputs?: LocalOutput[];
  peak_vram_mib?: number;
  elapsed_seconds?: number;
  result_url?: string;
  metadata?: Record<string, unknown>;
};
type ModelProfile = {
  id: string;
  name: string;
  category: string;
  description: string;
  license: string;
  source: string;
  vram_gb: number;
  ram_gb: number;
  installed: boolean;
  verified: boolean;
  recommended: boolean;
  download_bytes: number;
  tasks: string[];
  validation?: {
    passed: boolean;
    peak_vram_mib: number;
    elapsed_seconds: number;
  };
  files: {
    filename: string;
    local_path: string;
    size: number;
    installed: boolean;
    verified: boolean;
    url: string;
  }[];
};
type Status = {
  profiles: ModelProfile[];
  hardware: {
    gpus: {
      index: number;
      name: string;
      total_mib: number;
      free_mib: number;
    }[];
    ram_bytes: number;
    disk_free_bytes: number;
    platform: string;
  };
  settings: {
    url: string;
    gpu: number;
    vram_limit_gb: number;
    managed: boolean;
    download_source: "auto" | "official";
  };
  runtime_online: boolean;
  environment_ready: boolean;
  storage: string;
  jobs: LocalJob[];
};
type ComfyInfo = {
  display_name?: string;
  description?: string;
  category?: string;
  input: {
    required?: Record<string, [string | string[], Record<string, unknown>?]>;
  };
  output: string[];
  output_node: boolean;
};
const labels: Record<string, string> = {
  all: "全部",
  image: "图片",
  music: "音乐",
  stems: "分轨",
  "3d": "三维",
  video: "视频",
};
const statusLabels: Record<string, string> = {
  queued: "排队",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
export const terminalJob = (job: LocalJob) =>
  ["succeeded", "failed", "cancelled", "interrupted"].includes(job.status);
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? (bytes / 1024 ** 3).toFixed(1) + " GiB"
    : (bytes / 1024 ** 2).toFixed(1) + " MiB";
export function localResult(job: LocalJob): Params {
  const output = job.outputs?.[0];
  if (job.status !== "succeeded")
    return { job_status: job.status, result_text: job.message };
  return {
    job_status: job.status,
    result_url: output?.url || "",
    result_kind: output?.kind || "",
    outputs_json: JSON.stringify(job.outputs || []),
    result_text:
      job.status === "succeeded"
        ? `${job.outputs?.length || 0} 个真实资源 · ${job.elapsed_seconds || 0} 秒 · 显存峰值 ${((job.peak_vram_mib || 0) / 1024).toFixed(2)} GiB`
        : job.message,
  };
}

function Outputs({
  outputs,
  choose,
  play,
}: {
  outputs: LocalOutput[];
  choose?: (output: LocalOutput) => void;
  play?: (url: string) => void;
}) {
  return (
    <div className="local-outputs">
      {outputs.map((output) => (
        <div className="local-output" key={output.url}>
          <span>
            <strong>{output.name}</strong>
            <small>
              {labels[output.kind] || output.kind} · {size(output.size)}
            </small>
          </span>
          <a
            className="button small"
            href={output.url}
            target="_blank"
            rel="noreferrer"
          >
            打开
          </a>
          <a
            className="icon-button"
            href={output.url}
            download={output.name}
            aria-label={"下载 " + output.name}
          >
            <Download size={14} />
          </a>
          {choose && (
            <button className="button small" onClick={() => choose(output)}>
              选为输出
            </button>
          )}
          {play && output.kind === "audio" && (
            <button
              className="icon-button"
              aria-label={"播放 " + output.name}
              onClick={() => play(output.url)}
            >
              <Play size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function LocalNodePanel({
  node,
  onRun,
  onPatch,
  openManager,
  openGuide,
  notify,
  play,
  decode,
}: {
  node: GraphNode;
  onRun: () => Promise<void>;
  onPatch: (params: Params) => void;
  openManager: () => void;
  openGuide: () => void;
  notify: (text: string) => void;
  play: (url: string) => void;
  decode: () => void;
}) {
  const [job, setJob] = useState<LocalJob | null>(null),
    [starting, setStarting] = useState(false);
  const jobId = String(node.data.params.job_id || "");
  useEffect(() => {
    let disposed = false,
      timer = 0;
    setJob(null);
    if (!jobId) return;
    const poll = async () => {
      try {
        const result = await api<LocalJob>("/local-ai/jobs/" + jobId);
        if (disposed) return;
        setJob(result);
        if (!terminalJob(result)) timer = window.setTimeout(poll, 2000);
      } catch (error) {
        if (!disposed) {
          setJob({
            id: jobId,
            kind: "generate",
            status: "failed",
            progress: 0,
            message: (error as Error).message,
          });
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [jobId, node.id]);
  let outputs: LocalOutput[] = [];
  try {
    outputs = JSON.parse(String(node.data.params.outputs_json || "[]"));
    if (!Array.isArray(outputs)) outputs = [];
  } catch {}
  const busy = starting || (job && !terminalJob(job));
  const profile = localNodeProfile(node.type, node.data.params);
  const uploadInput = async (file: File, key: string) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      onPatch({ [key]: result.url });
      notify("已接入输入素材：" + file.name);
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const start = async () => {
    setStarting(true);
    try {
      await onRun();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="local-node-panel">
      <div className="local-node-banner">
        <Cpu size={17} />
        <span>
          本机运行 · {profile || "ComfyUI 工作流"}
          <small>环境和权重由本地模型中心管理</small>
        </span>
      </div>
      {[
        "local_image_edit",
        "local_image_to_image",
        "local_inpaint",
        "local_3d",
        "local_stems",
        "local_music",
        "local_video",
      ].includes(node.type) && (
        <div className="local-node-actions">
          <label className="button small">
            {["local_stems", "local_music"].includes(node.type)
              ? "上传输入音频"
              : "上传输入图片"}
            <input
              type="file"
              hidden
              accept={
                ["local_stems", "local_music"].includes(node.type)
                  ? "audio/*"
                  : "image/*"
              }
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadInput(file, "input_url");
                event.target.value = "";
              }}
            />
          </label>
          {node.type === "local_inpaint" && (
            <label className="button small">
              上传重绘遮罩
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadInput(file, "mask_url");
                  event.target.value = "";
                }}
              />
            </label>
          )}
          {node.type === "local_image_edit" && (
            <label className="button small">
              上传第二参考图
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadInput(file, "reference_url");
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      )}
      <div className="local-node-actions">
        <button className="button small" onClick={openManager}>
          <Download size={13} />
          模型与环境
        </button>
        <button className="button small" onClick={openGuide}>
          <BookOpen size={13} />
          安装教程
        </button>
      </div>
      {node.type === "comfy_workflow" && (
        <label className="button full">
          <FileCode2 size={14} /> 导入 ComfyUI API JSON
          <input
            type="file"
            accept=".json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const raw = JSON.parse(await file.text());
                const workflow =
                  raw.prompt && typeof raw.prompt === "object"
                    ? raw.prompt
                    : raw;
                if (
                  !workflow ||
                  Array.isArray(workflow) ||
                  !Object.values(workflow).some(
                    (value) =>
                      value &&
                      typeof value === "object" &&
                      "class_type" in value,
                  )
                )
                  throw new Error(
                    "请在 ComfyUI 开启开发者模式，导出 API 格式工作流；画布 JSON 不能直接执行",
                  );
                onPatch({ workflow_json: JSON.stringify(workflow, null, 2) });
                notify("已导入 API 工作流");
              } catch (error) {
                notify((error as Error).message);
              } finally {
                event.target.value = "";
              }
            }}
          />
        </label>
      )}
      <button className="button primary full" disabled={!!busy} onClick={start}>
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Play size={15} />
        )}
        运行本地工作流
      </button>
      {job && (
        <div className={"local-job " + job.status} role="status">
          <strong>{statusLabels[job.status] || job.status}</strong>
          <p>{job.message}</p>
          {!terminalJob(job) && (
            <>
              <progress max={100} value={job.progress || 5} />
              <button
                className="button small"
                onClick={() =>
                  api("/local-ai/jobs/" + job.id + "/cancel", {}).catch((e) =>
                    notify(e.message),
                  )
                }
              >
                <Square size={12} />
                取消当前任务
              </button>
            </>
          )}
          {terminalJob(job) && !!job.outputs?.length && (
            <button
              className="text-button"
              onClick={() => onPatch(localResult(job))}
            >
              重新载入该任务结果
            </button>
          )}
          {job.peak_vram_mib !== undefined && (
            <small>
              进程显存峰值 {(job.peak_vram_mib / 1024).toFixed(2)} GiB
            </small>
          )}
        </div>
      )}
      {outputs.length > 0 && (
        <>
          <strong className="local-result-title">本地生成资源</strong>
          <Outputs
            outputs={outputs}
            choose={(output) =>
              onPatch({ result_url: output.url, result_kind: output.kind })
            }
            play={play}
          />
        </>
      )}
      {node.data.params.result_url &&
        ["audio"].includes(String(node.data.params.result_kind)) && (
          <button className="button full" onClick={decode}>
            读取完整文件为 PCM 采样
          </button>
        )}
      {node.data.params.result_text && (
        <p className="local-result-note">
          {String(node.data.params.result_text)}
        </p>
      )}
    </div>
  );
}

export default function LocalAI({
  close,
  guide,
  addNode,
  addComfy,
  notify,
}: {
  close: () => void;
  guide: () => void;
  addNode: (type: string, model: string) => void;
  addComfy: (classType: string, info: ComfyInfo) => void;
  notify: (text: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [tab, setTab] = useState("models"),
    [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(""),
    [log, setLog] = useState(""),
    [logName, setLogName] = useState("comfy-server.log"),
    [objects, setObjects] = useState<Record<string, ComfyInfo>>({});
  const [settings, setSettings] = useState<Status["settings"] | null>(null);
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const refresh = async () => {
    try {
      const data = await api<Status>("/local-ai/status");
      setStatus(data);
      setSettings((s) => s || data.settings);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const tick = async () => {
      if (disposed) return;
      await refresh();
      if (!disposed) timer = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input,select,textarea",
          ) || [],
        ).filter((e) => e.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
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
      previous?.isConnected && previous.focus();
    };
  }, []);
  const action = async (name: string, path: string, body: unknown = {}) => {
    setBusy(name);
    try {
      await api(path, body);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const install = (ids: string[]) =>
    void action("install", "/local-ai/install", {
      profile_ids: ids,
      environment: true,
    });
  const viewLog = async (name = logName) => {
    setLogName(name);
    setTab("logs");
    setBusy("log");
    try {
      const r = await api<{ text: string }>("/local-ai/logs/" + name);
      setLog(r.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const browseNodes = async () => {
    setTab("nodes");
    if (Object.keys(objects).length) return;
    setBusy("nodes");
    try {
      if (!status?.runtime_online) {
        if (!status?.environment_ready && status?.settings.managed)
          throw new Error("请先在模型库一键安装运行环境，再打开 Comfy 节点库");
        await api("/local-ai/start", {});
        await refresh();
      }
      setObjects(await api("/local-ai/object-info"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const modelType: Record<string, string> = {
    image: "local_image",
    music: "local_music",
    "3d": "local_3d",
    stems: "local_stems",
    video: "local_video",
  };
  return (
    <div
      className="modal-backdrop local-ai-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="local-ai-center"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="本地模型中心"
      >
        <header>
          <div>
            <span className="eyebrow">TD OPEN · LOCAL GENERATION</span>
            <h2>
              <Cpu size={24} />
              本地模型中心
            </h2>
            <p>安装一次，在节点画布生成图片、音乐、网格、分轨和视频。</p>
          </div>
          <div className="local-header-actions">
            <button className="button small" onClick={guide}>
              <BookOpen size={15} />
              安装说明
            </button>
            <button
              className="icon-button"
              onClick={close}
              aria-label="关闭本地模型中心"
            >
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="local-hardware">
          {status ? (
            <>
              <span>
                <Cpu size={15} />
                {status.hardware.gpus.length
                  ? status.hardware.gpus
                      .map(
                        (g) =>
                          `${g.index}: ${g.name} · ${Math.round(g.total_mib / 1024)} GiB`,
                      )
                      .join(" / ")
                  : "未检测到 NVIDIA 显卡"}
              </span>
              <span>空闲磁盘 {size(status.hardware.disk_free_bytes)}</span>
              <span className={status.runtime_online ? "local-online" : ""}>
                {status.runtime_online ? "● 推理引擎在线" : "○ 推理引擎未启动"}
              </span>
            </>
          ) : (
            <span>正在检测设备与已安装模型…</span>
          )}
        </div>
        <nav className="local-tabs">
          {[
            ["models", "模型库"],
            ["jobs", "任务与结果"],
            ["settings", "环境设置"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            className={tab === "nodes" ? "active" : ""}
            onClick={browseNodes}
          >
            Comfy 节点库
          </button>
          <button
            className={tab === "logs" ? "active" : ""}
            onClick={() => viewLog()}
          >
            运行日志
          </button>
          <button
            className="icon-button"
            aria-label="刷新本地状态"
            onClick={() => refresh()}
          >
            <RefreshCw size={15} />
          </button>
        </nav>
        {error && (
          <div className="local-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="关闭错误">
              <X size={14} />
            </button>
          </div>
        )}
        <main className="local-content">
          {tab === "models" && (
            <>
              <div className="local-model-toolbar">
                <div>
                  {Object.entries(labels)
                    .filter(([key]) => key !== "audio")
                    .map(([key, label]) => (
                      <button
                        className={category === key ? "active" : ""}
                        onClick={() => setCategory(key)}
                        key={key}
                      >
                        {label}
                      </button>
                    ))}
                </div>
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => install([])}
                >
                  {status?.environment_ready ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  仅安装运行环境
                </button>
              </div>
              <p className="local-explainer">
                首次安装会下载独立 Python
                环境和模型权重。编码器共享、文件可续传，安装过程保留日志。选择模型卡可查看每个文件的官方地址、许可与本地路径。
              </p>
              <div className="local-model-grid">
                {status?.profiles
                  .filter((p) => category === "all" || p.category === category)
                  .map((profile) => (
                    <article className="local-model-card" key={profile.id}>
                      <div className="local-model-card-title">
                        <span className="local-category">
                          {labels[profile.category]}
                        </span>
                        <span
                          className={
                            profile.verified
                              ? "local-installed"
                              : "local-missing"
                          }
                        >
                          {profile.verified
                            ? "已校验"
                            : profile.installed
                              ? "已安装，待校验"
                              : "待安装"}
                        </span>
                      </div>
                      <h3>{profile.name}</h3>
                      <p>{profile.description}</p>
                      <div className="local-model-specs">
                        <span>建议显存 {profile.vram_gb} GiB</span>
                        <span>建议内存 {profile.ram_gb} GiB</span>
                        <span>
                          {profile.installed
                            ? "权重已在本地"
                            : "需下载 " + size(profile.download_bytes)}
                        </span>
                      </div>
                      {profile.validation?.passed && (
                        <small className="local-installed">
                          界面实测通过 · 峰值{" "}
                          {(profile.validation.peak_vram_mib / 1024).toFixed(2)}{" "}
                          GiB（L40 / 24 GiB 预算）
                        </small>
                      )}
                      <small className="local-license">
                        许可：{profile.license}
                      </small>
                      <div className="local-card-actions">
                        <button
                          className="button primary small"
                          disabled={
                            !!busy ||
                            status?.jobs.some(
                              (j) => j.kind === "install" && !terminalJob(j),
                            )
                          }
                          onClick={() => install([profile.id])}
                        >
                          <Download size={13} />
                          {profile.installed ? "校验 / 修复环境" : "一键安装"}
                        </button>
                        <button
                          className="button small"
                          onClick={() =>
                            addNode(modelType[profile.category], profile.id)
                          }
                        >
                          <Plus size={13} />
                          添加节点
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setExpanded(
                              expanded === profile.id ? "" : profile.id,
                            )
                          }
                        >
                          文件说明
                        </button>
                      </div>
                      {expanded === profile.id && (
                        <div className="local-model-files">
                          <a
                            href={profile.source}
                            target="_blank"
                            rel="noreferrer"
                          >
                            官方项目与许可 ↗
                          </a>
                          {profile.files.map((file) => (
                            <div key={file.filename}>
                              <strong>{file.filename}</strong>
                              <code>{file.local_path}</code>
                              <small>
                                {size(file.size)} ·{" "}
                                {file.verified
                                  ? "SHA-256 已校验"
                                  : file.installed
                                    ? "已存在"
                                    : "未下载"}
                              </small>
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                固定版本下载地址 ↗
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            </>
          )}
          {tab === "jobs" && (
            <div className="local-jobs">
              <p className="local-explainer">
                模型串行运行以控制显存。取消仅作用于当前任务；已下载内容与已生成文件保留在项目目录。
              </p>
              {status?.jobs.length === 0 && (
                <div className="local-empty">
                  从模型卡安装环境，或在画布中运行本地生成节点。
                </div>
              )}
              {status?.jobs.map((job) => (
                <article
                  className={"local-job-card " + job.status}
                  key={job.id}
                >
                  <div>
                    <strong>
                      {job.kind === "install"
                        ? "安装环境 / 权重"
                        : status.profiles.find((p) => p.id === job.profile_id)
                            ?.name || "ComfyUI 工作流"}
                    </strong>
                    <span>{statusLabels[job.status] || job.status}</span>
                  </div>
                  <p>{job.message}</p>
                  {!terminalJob(job) && (
                    <>
                      <progress max={100} value={job.progress || 5} />
                      <button
                        className="button small"
                        onClick={() =>
                          action(job.id, "/local-ai/jobs/" + job.id + "/cancel")
                        }
                      >
                        <Square size={12} />
                        取消此任务
                      </button>
                    </>
                  )}
                  {job.peak_vram_mib !== undefined && (
                    <small>
                      显存峰值 {(job.peak_vram_mib / 1024).toFixed(2)} GiB ·{" "}
                      {job.elapsed_seconds || 0} 秒
                    </small>
                  )}
                  {job.outputs?.length && (
                    <>
                      <Outputs outputs={job.outputs} />
                      <a
                        href={"/api/local-ai/jobs/" + job.id + "/workflow"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-button"
                      >
                        <FileCode2 size={13} />
                        查看实际 ComfyUI 工作流
                      </a>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
          {tab === "settings" && settings && (
            <div className="local-settings">
              <h3>本地运行环境</h3>
              <p>
                默认使用项目内的 ComfyUI 和独立 Python 环境。显存上限最高 24
                GiB，模型按需加载并卸载到内存。
              </p>
              <div className="form-grid">
                <label className="stacked">
                  ComfyUI 回环地址
                  <input
                    value={settings.url}
                    onChange={(event) =>
                      setSettings({ ...settings, url: event.target.value })
                    }
                  />
                </label>
                <label className="stacked">
                  GPU
                  <select
                    value={settings.gpu}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        gpu: Number(event.target.value),
                      })
                    }
                  >
                    {status?.hardware.gpus.map((g) => (
                      <option key={g.index} value={g.index}>
                        {g.index} · {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="stacked">
                  显存预算（GiB）
                  <input
                    type="number"
                    min={4}
                    max={24}
                    value={settings.vram_limit_gb}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        vram_limit_gb: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  由 TD Open 启动和管理进程
                  <input
                    type="checkbox"
                    checked={settings.managed}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        managed: event.target.checked,
                      })
                    }
                  />
                </label>
                <label className="stacked">
                  下载源
                  <select
                    value={settings.download_source || "auto"}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        download_source: event.target.value as
                          "auto" | "official",
                      })
                    }
                  >
                    <option value="auto">
                      官方文件镜像优先，失败回退官方源
                    </option>
                    <option value="official">仅官方源</option>
                  </select>
                </label>
              </div>
              <div className="local-settings-actions">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    action("settings", "/local-ai/settings", settings)
                  }
                >
                  保存设置
                </button>
                <button
                  className="button primary"
                  disabled={
                    !!busy || (!status?.environment_ready && settings.managed)
                  }
                  onClick={() => action("start", "/local-ai/start")}
                >
                  <Play size={15} />
                  启动引擎
                </button>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() => action("stop", "/local-ai/stop")}
                >
                  <Square size={15} />
                  停止引擎
                </button>
              </div>
              <code>{status?.storage}</code>
              <p>
                已有 ComfyUI
                可取消托管并连接回环端口；模型路径映射和其他操作系统的环境安装步骤见安装说明。
              </p>
              <button className="text-button" onClick={guide}>
                阅读手动安装与权重放置说明
              </button>
            </div>
          )}
          {tab === "nodes" && (
            <>
              <div className="local-node-search">
                <Search size={16} />
                <input
                  placeholder="搜索已安装的 Comfy 类名、分类…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <span>{Object.keys(objects).length} 个实际节点</span>
              </div>
              <p className="local-explainer">
                这里读取当前运行引擎的真实节点定义。可添加通用节点填写参数、连接最多四个输入；更复杂的网络可直接使用“ComfyUI
                工作流”节点导入 API JSON。
              </p>
              <div className="local-comfy-list">
                {Object.entries(objects)
                  .filter(([name, info]) =>
                    [name, info.display_name, info.category]
                      .join(" ")
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .slice(0, 250)
                  .map(([name, info]) => (
                    <div key={name}>
                      <span>
                        <strong>{info.display_name || name}</strong>
                        <code>{name}</code>
                        <small>
                          {info.category} · 输出 {info.output.join(", ")}
                        </small>
                      </span>
                      <button
                        className="button small"
                        onClick={() => addComfy(name, info)}
                      >
                        <Plus size={13} />
                        添加
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
          {tab === "logs" && (
            <div className="local-log-view">
              <div>
                <select
                  value={logName}
                  onChange={(event) => viewLog(event.target.value)}
                >
                  {[
                    "comfy-server.log",
                    "install-runtime.log",
                    "install-env.log",
                    "install-torch.log",
                    "install-comfy.log",
                    "install-extension.log",
                  ].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <button className="button small" onClick={() => viewLog()}>
                  <RefreshCw size={14} />
                  刷新日志
                </button>
              </div>
              <pre>{log || "请选择日志或等待任务启动。"}</pre>
            </div>
          )}
        </main>
        <footer>
          <span>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={14} />
                正在处理…
              </>
            ) : (
              "文件、环境、权重、任务与生成结果均保存在项目目录内。"
            )}
          </span>
          <button
            className="text-button"
            onClick={() => {
              setTab("jobs");
              void refresh();
            }}
          >
            查看下载 / 运行进度 →
          </button>
        </footer>
      </section>
    </div>
  );
}
