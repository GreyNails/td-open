import PerformancePanel from "./PerformancePanel";
import {
  generatePerformance,
  type PerformanceProgress,
} from "./performanceWorkflow";
import { comfyDefaults } from "./comfySchema";
import { TemplateGallery } from "./TemplateGallery";
import { templateById } from "./templates";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import type {
  Node,
  Edge,
  NodeProps,
  NodeChange,
  EdgeChange,
  Connection,
} from "@xyflow/react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  Download,
  Expand,
  FilePlus2,
  FolderOpen,
  Grid2X2,
  HelpCircle,
  Image,
  Layers,
  LoaderCircle,
  Maximize2,
  Mic,
  MousePointer2,
  Network,
  PanelLeftClose,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
  Zap,
  Plug,
  Film,
} from "lucide-react";
import type { GraphNode, Project, Params, Command, Provider } from "./types";
import { api, uid } from "./types";
import {
  byType,
  catalog,
  connectionError,
  familyColors,
  makeNode,
  preset,
} from "./catalog";
import { graphAt, updateGraph } from "./networks";
import { isChannelBuffer, isTableData } from "./runtimeValues";
import { mediaCatalog } from "./nodes/mediaCatalog";
import { RuntimeInspector } from "./RuntimeInspector";
import { StudioEngine } from "./engine";
import Settings from "./Settings";
import LocalAI, { LocalNodePanel, localResult, terminalJob } from "./LocalAI";
import type { LocalJob } from "./LocalAI";
import { localNodeProfile } from "./nodes/localAICatalog";
import { encodeWAV } from "./nodes/mediaRuntime";
import { pendingLocalJobs, patchLocalResult } from "./localAIResults";
import { guideFromHash } from "./guideRoute";
import type { GuidePage } from "./guideRoute";
import Workbench from "./Workbench";
import NodeSearch from "./NodeSearch";
import type { WorkspaceLayout } from "./workspaceLayout";

const DocsCenter = lazy(() => import("./DocsCenter"));
const EngineContext =
  createContext<React.MutableRefObject<StudioEngine | null> | null>(null);
type FlowNode = Node<{ node: GraphNode }, "studio">;
function NodeThumbnail({ id, type }: { id: string; type: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useContext(EngineContext);
  useEffect(() => {
    let timer = 0;
    const draw = () => {
      const el = canvas.current,
        ctx = el?.getContext("2d"),
        e = engine?.current;
      if (ctx && el && e) {
        const value = e.values.get(e.resolveId(id));
        const frame =
          value instanceof HTMLCanvasElement
            ? value
            : e.frames.get(e.resolveId(id));
        if (frame) {
          ctx.clearRect(0, 0, 192, 78);
          ctx.drawImage(frame, 0, 0, 192, 78);
        } else {
          ctx.fillStyle = "#181a22";
          ctx.fillRect(0, 0, 192, 78);
          if (isChannelBuffer(value)) {
            value.channels.slice(0, 3).forEach((channel, index) => {
              ctx.strokeStyle = ["#73cda8", "#b29af7", "#e5bb6f"][index];
              ctx.beginPath();
              const samples = channel.samples,
                step = Math.max(1, Math.ceil(samples.length / 192));
              for (let i = 0; i < samples.length; i += step) {
                const x = (i * 192) / Math.max(1, samples.length - 1),
                  y = 39 - Math.max(-1, Math.min(1, samples[i])) * 32;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
            });
            ctx.fillStyle = "#a8b3b8";
            ctx.font = "10px monospace";
            ctx.fillText(
              `${value.channels.length} CH · ${value.channels[0]?.samples.length || 0} samples`,
              8,
              73,
            );
          } else if (typeof value === "number") {
            ctx.strokeStyle = familyColors.CHOP;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let x = 0; x < 192; x++)
              ctx.lineTo(x, 39 + Math.sin(x * 0.055 + value) * 20);
            ctx.stroke();
          } else {
            ctx.fillStyle = familyColors[byType[type]?.family] || "#aaa";
            ctx.font = "12px monospace";
            ctx.textAlign = "center";
            ctx.fillText(
              typeof value === "string"
                ? value.slice(0, 22) || "等待运行"
                : isTableData(value)
                  ? `${value.rows.length} ROWS × ${value.rows[0]?.length || 0} COLS`
                  : byType[type]?.family === "COMP"
                    ? "▣  COMPONENT"
                    : byType[type]?.family === "MAT"
                      ? "◉  MATERIAL"
                      : byType[type]?.outputs.some(
                            (port) => port.kind === "SOP",
                          )
                        ? "◇  3D GEOMETRY"
                        : "✦  AI GENERATION",
              96,
              44,
            );
          }
        }
      }
      timer = window.setTimeout(draw, 160);
    };
    draw();
    return () => clearTimeout(timer);
  }, [id, type, engine]);
  return (
    <canvas className="node-thumbnail" ref={canvas} width={192} height={78} />
  );
}
function StudioNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node,
    s = byType[n.type];
  if (!s) return <div>未知节点 {n.type}</div>;
  const c = familyColors[s.family];
  return (
    <div
      className={`studio-node ${selected ? "selected" : ""}`}
      style={{ "--node-color": c } as React.CSSProperties}
    >
      <div className="node-heading">
        <span className="family-dot" />
        <strong>{n.data.label}</strong>
        <span className="node-family">{s.family}</span>
      </div>
      <NodeThumbnail id={n.id} type={n.type} />
      <div className="node-footer">
        <span>{s.english}</span>
        <span className="node-state">
          {s.reference?.level === "bridge"
            ? "需适配器"
            : s.family === "AI" || n.type.startsWith("python_script_")
              ? "手动运行"
              : "●"}
        </span>
      </div>
      {s.inputs.map((p, i) => (
        <Handle
          key={p.id}
          type="target"
          position={Position.Left}
          id={p.id}
          title={`${p.label} · ${p.kind}`}
          style={{ top: 48 + i * 29, background: familyColors[p.kind] || c }}
        >
          <span className="port-label">
            {p.id === "mod" ? "↝" : i === 1 ? "B" : ""}
          </span>
        </Handle>
      ))}
      {s.outputs.map((p, i) => (
        <Handle
          key={p.id}
          type="source"
          position={Position.Right}
          id={p.id}
          title={`${p.label} · ${p.kind}`}
          style={{ top: 75 + i * 25, background: familyColors[p.kind] || c }}
        />
      ))}
    </div>
  );
}
const nodeTypes = { studio: StudioNode };
const iconFor = (type: string) =>
  type === "output"
    ? Expand
    : type === "audio" || type === "spectrum"
      ? AudioLines
      : type === "particles"
        ? Sparkles
        : byType[type]?.outputs.some((port) => port.kind === "SOP") ||
            type === "render"
          ? Box
          : type.startsWith("ai_")
            ? Sparkles
            : type === "mcp_tool"
              ? Plug
              : type === "noise"
                ? Activity
                : type === "lfo" || type === "math" || type === "constant"
                  ? Activity
                  : Image;
type Chat = {
  role: "user" | "assistant";
  text: string;
  commands?: Command[];
  applied?: boolean;
};
const friendly = (e: unknown) => (e instanceof Error ? e.message : String(e));
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function Studio() {
  const [quickAdd, setQuickAdd] = useState<{
    position?: { x: number; y: number };
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [panMode, setPanMode] = useState(true);
  const [rootProject, setRootProject] = useState<Project>(() => preset()),
    [ready, setReady] = useState(false),
    [selected, setSelected] = useState(""),
    [category, setCategory] = useState("推荐"),
    [search, setSearch] = useState(""),
    [playing, setPlaying] = useState(true),
    [saveState, setSaveState] = useState("正在连接"),
    [backend, setBackend] = useState(false),
    [modal, setModal] = useState(""),
    [tab, setTab] = useState("params"),
    [toast, setToast] = useState(""),
    [fps, setFps] = useState(0),
    [time, setTime] = useState(0),
    [previewId, setPreviewId] = useState(""),
    [mic, setMic] = useState(false),
    [providers, setProviders] = useState<Provider[]>([]),
    [chatProvider, setChatProvider] = useState(""),
    [chats, setChats] = useState<Chat[]>([]),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(""),
    [projects, setProjects] = useState<
      { id: string; name: string; updated_at?: string }[]
    >([]),
    [guide, setGuide] = useState(true),
    [errors, setErrors] = useState<string[]>([]),
    [recording, setRecording] = useState(false),
    [historyVersion, setHistoryVersion] = useState(0),
    [mediaSDP, setMediaSDP] = useState("");
  const [performanceProgress, setPerformanceProgress] =
    useState<PerformanceProgress>({ busy: false, message: "" });
  const [networkPath, setNetworkPath] = useState<string[]>([]);
  const [docsPage, setDocsPage] = useState<GuidePage | null>(() =>
    guideFromHash(),
  );
  const previousGuideHash = useRef(guideFromHash() ? "" : window.location.hash);
  const openDocs = useCallback((page: GuidePage) => {
    if (!guideFromHash()) previousGuideHash.current = window.location.hash;
    window.history.replaceState(null, "", `#guide/${page}`);
    setDocsPage(page);
  }, []);
  const closeDocs = useCallback(() => {
    window.history.replaceState(
      null,
      "",
      window.location.pathname +
        window.location.search +
        previousGuideHash.current,
    );
    setDocsPage(null);
  }, []);
  useEffect(() => {
    const syncGuide = () => setDocsPage(guideFromHash());
    window.addEventListener("hashchange", syncGuide);
    return () => window.removeEventListener("hashchange", syncGuide);
  }, []);
  let project: Project;
  try {
    project = graphAt(rootProject, networkPath);
  } catch {
    project = rootProject;
  }
  const rootProjectRef = useRef(rootProject);
  rootProjectRef.current = rootProject;
  const appliedLocalJobs = useRef(new Set<string>());
  useEffect(() => {
    let disposed = false,
      timer = 0;
    const poll = async () => {
      const jobs = pendingLocalJobs(rootProjectRef.current).filter(
        (job) =>
          !appliedLocalJobs.current.has(
            `${job.rootId}/${job.path.join("/")}/${job.nodeId}/${job.jobId}`,
          ),
      );
      await Promise.all(
        jobs.map(async (job) => {
          try {
            const result = await api<LocalJob>("/local-ai/jobs/" + job.jobId);
            if (
              disposed ||
              !terminalJob(result) ||
              rootProjectRef.current.id !== job.rootId
            )
              return;
            appliedLocalJobs.current.add(
              `${job.rootId}/${job.path.join("/")}/${job.nodeId}/${job.jobId}`,
            );
            setRootProject((current) =>
              patchLocalResult(current, job, localResult(result)),
            );
          } catch {}
        }),
      );
      if (!disposed) timer = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  const networkPathRef = useRef(networkPath);
  networkPathRef.current = networkPath;
  const setProject = (action: React.SetStateAction<Project>) => {
    let current: Project;
    try {
      current = graphAt(rootProjectRef.current, networkPathRef.current);
    } catch {
      current = rootProjectRef.current;
      networkPathRef.current = [];
      setNetworkPath([]);
    }
    if (typeof action !== "function" && action.id !== current.id) {
      setNetworkPath([]);
      setRootProject(action);
    } else
      setRootProject((root) =>
        updateGraph(root, networkPathRef.current, (p) =>
          typeof action === "function" ? action(p) : action,
        ),
      );
  };
  useEffect(() => {
    try {
      graphAt(rootProject, networkPath);
    } catch {
      setNetworkPath([]);
    }
  }, [rootProject, networkPath]);
  const openNetwork = (path: string[]) => {
    setNetworkPath(path);
    setSelected("");
    setSelectedIds(new Set());
    setPreviewId("");
    requestAnimationFrame(() => flow.fitView({ padding: 0.2, duration: 200 }));
  };
  const renderDirty = useRef(true);
  const projectRef = useRef(project),
    engine = useRef<StudioEngine | null>(null),
    preview = useRef<HTMLCanvasElement>(null),
    previewWrap = useRef<HTMLDivElement>(null),
    playingRef = useRef(playing),
    previewRef = useRef(previewId),
    timeRef = useRef(0),
    history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    fileInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null),
    toastTimer = useRef(0),
    chatBottom = useRef<HTMLDivElement>(null),
    recorder = useRef<MediaRecorder | null>(null);
  const flow = useReactFlow<FlowNode>();
  projectRef.current = project;
  playingRef.current = playing;
  previewRef.current = previewId;
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 6500);
  }, []);
  const checkpoint = () => {
    history.current.push(structuredClone(rootProjectRef.current));
    if (history.current.length > 60) history.current.shift();
    future.current = [];
    setHistoryVersion((v) => v + 1);
  };
  const lastPersisted = useRef("");
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const persist = (p: Project) => {
    const task = saveQueue.current
      .catch(() => {})
      .then(() => api<Project>("/projects", p))
      .then((result) => {
        if (rootProjectRef.current.id === p.id)
          lastPersisted.current = JSON.stringify(p);
        return result;
      });
    saveQueue.current = task;
    return task;
  };
  const replace = (p: Project, keepHistory = true) => {
    if (p.id !== projectRef.current.id && ready && backend)
      void persist(rootProjectRef.current).catch((e) =>
        notify("上一份作品保存失败：" + friendly(e)),
      );
    if (keepHistory) checkpoint();
    setProject(p);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev) {
      future.current.push(rootProjectRef.current);
      setRootProject(prev);
      setHistoryVersion((v) => v + 1);
    }
  };
  const redo = () => {
    const next = future.current.pop();
    if (next) {
      history.current.push(rootProjectRef.current);
      setRootProject(next);
      setHistoryVersion((v) => v + 1);
    }
  };
  useEffect(() => {
    setSelectedIds((previous) => {
      const valid = new Set(
        [...previous].filter((id) => project.nodes.some((n) => n.id === id)),
      );
      return valid.size === previous.size ? previous : valid;
    });
  }, [project.nodes]);
  const active = project.nodes.find(
      (n) =>
        n.id === (selectedIds.has(selected) ? selected : [...selectedIds][0]),
    ),
    spec = active ? byType[active.type] : undefined;
  const fetchProviders = () =>
    api<Provider[] | { providers: Provider[] }>("/providers")
      .then((r) => setProviders(Array.isArray(r) ? r : r.providers))
      .catch(() => {});
  useEffect(() => {
    let cancelled = false;
    api<{ status: string }>("/health")
      .then(() => {
        if (cancelled) return;
        setBackend(true);
        return api<
          | { id: string; name: string }[]
          | { projects: { id: string; name: string }[] }
        >("/projects");
      })
      .then(async (r) => {
        if (cancelled) return;
        const list = r ? (Array.isArray(r) ? r : r.projects) : [];
        if (list.length) {
          const p = await api<Project>("/projects/" + list[0].id);
          if (!cancelled) {
            lastPersisted.current = JSON.stringify(p);
            setProject(p);
            setSelected(p.nodes[0]?.id || "");
            setSelectedIds(new Set(p.nodes[0] ? [p.nodes[0].id] : []));
          }
        }
        if (!list.length) {
          setSelected(projectRef.current.nodes[0]?.id || "");
          setSelectedIds(
            new Set(
              projectRef.current.nodes[0]
                ? [projectRef.current.nodes[0].id]
                : [],
            ),
          );
        }
        setSaveState("已连接");
      })
      .catch(() => {
        if (!cancelled) {
          setSaveState("后端未连接");
          notify("无法连接 Python 后端；当前编辑尚未保存。请先运行启动脚本。");
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    fetchProviders();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready || !backend) return;
    setSaveState("待保存");
    const timer = window.setTimeout(() => {
      const p = rootProjectRef.current;
      persist(p)
        .then(() => {
          if (rootProjectRef.current === p) setSaveState("已自动保存");
        })
        .catch((e) => {
          setSaveState("保存失败");
          notify(friendly(e));
        });
    }, 1200);
    return () => clearTimeout(timer);
  }, [rootProject, ready, backend]);
  useEffect(() => {
    const e = new StudioEngine(rootProjectRef.current);
    engine.current = e;
    let raf = 0,
      last = performance.now(),
      since = last,
      count = 0,
      lastRenderRevision = -1;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (playingRef.current) timeRef.current += dt;
      if (
        playingRef.current ||
        renderDirty.current ||
        lastRenderRevision !== e.revision
      ) {
        lastRenderRevision = e.revision;
        const frame = e.render(
          timeRef.current,
          previewRef.current || undefined,
        );
        const ctx = preview.current?.getContext("2d");
        if (ctx) {
          if (
            ctx.canvas.width !== frame.width ||
            ctx.canvas.height !== frame.height
          ) {
            ctx.canvas.width = frame.width;
            ctx.canvas.height = frame.height;
          }
          ctx.clearRect(0, 0, frame.width, frame.height);
          ctx.drawImage(frame, 0, 0);
        }
        renderDirty.current = false;
        count++;
      }
      if (now - since > 600) {
        setFps(Math.round((count * 1000) / (now - since)));
        setTime(timeRef.current);
        setErrors([...e.errors.values()]);
        since = now;
        count = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      e.dispose();
      engine.current = null;
      recorder.current?.state === "recording" && recorder.current.stop();
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    engine.current?.setProject(rootProject);
    if (engine.current) engine.current.viewPath = networkPath;
    renderDirty.current = true;
    setMic(engine.current?.hasAudio || false);
  }, [rootProject, networkPath]);
  useEffect(() => {
    engine.current?.setPlaying(playing);
    renderDirty.current = true;
  }, [playing]);
  useEffect(() => {
    renderDirty.current = true;
  }, [previewId]);
  useEffect(() => {
    if (!ready || !backend) return;
    const timer = window.setInterval(async () => {
      const snapshot = rootProjectRef.current;
      if (JSON.stringify(snapshot) !== lastPersisted.current) return;
      try {
        const remote = await api<Project>("/projects/" + snapshot.id);
        if (rootProjectRef.current !== snapshot) return;
        if (JSON.stringify(remote) !== lastPersisted.current) {
          lastPersisted.current = JSON.stringify(remote);
          setRootProject(remote);
          notify("已同步外部 AI / MCP 对作品的修改");
        }
      } catch {}
    }, 4000);
    return () => clearInterval(timer);
  }, [ready, backend]);
  useEffect(() => {
    const flush = () => {
      const current = rootProjectRef.current;
      const serialized = JSON.stringify(current);
      if (serialized !== lastPersisted.current && serialized.length < 60000)
        navigator.sendBeacon(
          "/api/projects",
          new Blob([serialized], { type: "application/json" }),
        );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
  useEffect(() => {
    chatBottom.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [chats, busy]);
  const save = async () => {
    try {
      await persist(rootProjectRef.current);
      setBackend(true);
      setSaveState("已保存");
      notify("作品已保存到 data/projects");
    } catch (e) {
      notify(friendly(e));
      setSaveState("保存失败");
    }
  };
  const addNode = (type: string, connect = false) => {
    const canvas = document
      .querySelector(".flow-container")
      ?.getBoundingClientRect();
    const position =
      quickAdd?.position ||
      flow.screenToFlowPosition({
        x: canvas ? canvas.left + canvas.width / 2 : 500,
        y: canvas ? canvas.top + canvas.height / 2 : 400,
      });
    const current = projectRef.current;
    const source = current.nodes.find((n) => n.id === active?.id);
    const n = makeNode(type, position.x - 96, position.y - 70);
    const compatible =
      connect && source
        ? byType[source.type].outputs.flatMap((out) =>
            byType[type].inputs
              .filter((port) => port.kind === out.kind)
              .map((port) => ({ out, port })),
          )[0]
        : undefined;
    if (compatible && source) {
      n.position = { x: source.position.x + 260, y: source.position.y };
    }
    while (
      current.nodes.some(
        (other) =>
          Math.abs(other.position.x - n.position.x) < 205 &&
          Math.abs(other.position.y - n.position.y) < 145,
      )
    ) {
      n.position.x += 48;
      n.position.y += 48;
    }
    replace({
      ...current,
      nodes: [...current.nodes, n],
      edges:
        compatible && source
          ? [
              ...current.edges,
              {
                id: uid("edge"),
                source: source.id,
                target: n.id,
                sourceHandle: compatible.out.id,
                targetHandle: compatible.port.id,
              },
            ]
          : current.edges,
    });
    setSelected(n.id);
    setSelectedIds(new Set([n.id]));
    setQuickAdd(null);
    if (canvas) {
      const screen = flow.flowToScreenPosition({
        x: n.position.x + 96,
        y: n.position.y + 70,
      });
      if (
        screen.x < canvas.left ||
        screen.x > canvas.right ||
        screen.y < canvas.top ||
        screen.y > canvas.bottom
      )
        window.setTimeout(
          () =>
            flow.setCenter(n.position.x + 96, n.position.y + 70, {
              zoom: flow.getZoom(),
              duration: 250,
            }),
          20,
        );
    }
    notify(`已添加「${n.data.label}」${compatible ? "并连接到选中节点" : ""}`);
  };
  const updateParam = (
    key: string,
    value: Params[string],
    snapshot = false,
  ) => {
    if (!active) return;
    if (snapshot) checkpoint();
    setProject((p) => ({
      ...p,
      nodes: p.nodes.map((n) =>
        n.id === active.id
          ? {
              ...n,
              data: { ...n.data, params: { ...n.data.params, [key]: value } },
            }
          : n,
      ),
    }));
  };
  const removeNode = () => {
    if (!active) return;
    const targetId = active.id;
    replace({
      ...projectRef.current,
      nodes: projectRef.current.nodes.filter((n) => n.id !== targetId),
      edges: projectRef.current.edges.filter(
        (e) => e.source !== targetId && e.target !== targetId,
      ),
    });
    setSelected("");
    setSelectedIds(new Set());
    setPreviewId("");
  };
  const duplicate = () => {
    const current = projectRef.current;
    const originals = current.nodes.filter((n) => selectedIds.has(n.id));
    if (!originals.length) return;
    const mapping = new Map(originals.map((n) => [n.id, uid(n.type)]));
    const copies = originals.map((n) => ({
      ...structuredClone(n),
      id: mapping.get(n.id)!,
      position: { x: n.position.x + 48, y: n.position.y + 180 },
      data: { ...structuredClone(n.data), label: n.data.label + " 副本" },
    }));
    const copiedEdges = current.edges
      .filter((e) => mapping.has(e.source) && mapping.has(e.target))
      .map((e) => ({
        ...e,
        id: uid("edge"),
        source: mapping.get(e.source)!,
        target: mapping.get(e.target)!,
      }));
    replace({
      ...current,
      nodes: [...current.nodes, ...copies],
      edges: [...current.edges, ...copiedEdges],
    });
    setSelected(copies[0].id);
    setSelectedIds(new Set(copies.map((n) => n.id)));
    notify(
      `已复制 ${copies.length} 个节点${copiedEdges.length ? "及内部连线" : ""}`,
    );
  };
  const usePreset = (kind: string) => {
    const p = preset(kind);
    replace(p);
    setSelected(p.nodes[0]?.id || "");
    setSelectedIds(new Set(p.nodes[0] ? [p.nodes[0].id] : []));
    setPreviewId("");
    timeRef.current = 0;
    setModal("");
    setTimeout(() => flow.fitView({ padding: 0.25, duration: 500 }), 100);
    notify("示例已载入，修改会保存为独立作品");
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector(".docs-center, .local-ai-center")) return;
      const el = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
        el.isContentEditable
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        duplicate();
      }
      const inCanvas =
        el === document.body || Boolean(el.closest(".flow-container"));
      if (e.code === "Space" && inCanvas) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (
        (e.key === "Tab" && inCanvas) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        setQuickAdd({});
      }
      if (e.key === "Escape") {
        setQuickAdd(null);
        setModal("");
        setPreviewId("");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, selected, selectedIds]);
  const nodes: FlowNode[] = useMemo(
    () =>
      project.nodes.map((n) => ({
        id: n.id,
        type: "studio",
        position: n.position,
        data: { node: n },
        selected: selectedIds.has(n.id),
        measured: flow.getInternalNode(n.id)?.measured,
      })),
    [project.nodes, selectedIds, flow],
  );
  const edges: Edge[] = project.edges.map((e) => ({
    ...e,
    animated: playing,
    style: {
      stroke:
        familyColors[
          byType[
            project.nodes.find((n) => n.id === e.source)?.type || ""
          ]?.outputs.find((p) => p.id === (e.sourceHandle || "out"))?.kind ||
            "TOP"
        ],
      strokeWidth: 1.6,
    },
  }));
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const selections = changes.filter((c) => c.type === "select");
    if (selections.length) {
      setSelectedIds((previous) => {
        const next = new Set(previous);
        for (const c of selections) {
          if (c.type === "select") {
            if (c.selected) next.add(c.id);
            else next.delete(c.id);
          }
        }
        return next;
      });
      const last = selections
        .filter((c) => c.type === "select" && c.selected)
        .at(-1);
      if (last) setSelected(last.id);
    }

    const changed = changes.filter(
      (c) => c.type === "position" || c.type === "remove",
    );
    if (!changed.length) return;
    if (changed.some((c) => c.type === "remove")) checkpoint();
    const next = applyNodeChanges(changed, nodes);
    const ids = new Set(next.map((n) => n.id));
    setProject((p) => ({
      ...p,
      nodes: next.map((n) => ({ ...n.data.node, position: n.position })),
      edges: p.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    }));
    if (!ids.has(selected)) setSelected("");
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    if (!changes.some((c) => c.type === "remove")) return;
    checkpoint();
    setProject((p) => ({
      ...p,
      edges: applyEdgeChanges(changes, edges).map(
        ({ id, source, target, sourceHandle, targetHandle }) => ({
          id,
          source,
          target,
          sourceHandle,
          targetHandle,
        }),
      ),
    }));
  };
  const onConnect = (c: Connection) => {
    const err = connectionError(
      project,
      c.source,
      c.target,
      c.sourceHandle || "out",
      c.targetHandle || "in",
    );
    if (err) {
      notify(err);
      return;
    }
    replace({
      ...project,
      edges: [
        ...project.edges.filter(
          (e) =>
            !(
              e.target === c.target &&
              (e.targetHandle || "in") === (c.targetHandle || "in")
            ),
        ),
        { ...c, id: uid("edge") },
      ],
    });
  };
  const send = async (message = prompt) => {
    if (!message.trim() || busy) return;
    setPrompt("");
    setChats((c) => [...c, { role: "user", text: message }]);
    setBusy("chat");
    try {
      const r = await api<{ reply: string; commands: Command[]; mode: string }>(
        "/chat",
        {
          message,
          project: projectRef.current,
          selected_node: selected || undefined,
          provider_id: chatProvider || undefined,
        },
      );
      setChats((c) => [
        ...c,
        { role: "assistant", text: r.reply, commands: r.commands },
      ]);
    } catch (e) {
      setChats((c) => [
        ...c,
        { role: "assistant", text: "请求失败：" + friendly(e) },
      ]);
    } finally {
      setBusy("");
    }
  };
  const applyChat = async (index: number) => {
    try {
      const snapshot = projectRef.current;
      const r = await api<{ project: Project }>("/commands", {
        project: snapshot,
        commands: chats[index].commands,
      });
      if (projectRef.current !== snapshot)
        throw new Error("作品在请求期间发生了变化，请重新应用修改");
      replace(r.project);
      setChats((c) =>
        c.map((m, i) => (i === index ? { ...m, applied: true } : m)),
      );
      notify("修改已应用，可按 Ctrl+Z 撤销");
    } catch (e) {
      notify(friendly(e));
    }
  };
  const runNode = async () => {
    if (!active) return;
    const n = active;
    setBusy(n.id);
    try {
      let r: Record<string, unknown>;
      if (n.type === "mcp_tool")
        r = await api("/mcp/call", {
          server_id: n.data.params.server_id,
          name: n.data.params.tool,
          arguments: JSON.parse(String(n.data.params.arguments || "{}")),
        });
      else
        r = await api("/ai/generate", {
          provider_id: n.data.params.provider_id,
          capability: n.type.replace("ai_", ""),
          prompt: n.data.params.prompt,
        });
      if (r.isError)
        throw new Error(
          "MCP 工具执行失败：" + JSON.stringify(r.content || []).slice(0, 1000),
        );
      const data = (r.data || {}) as Record<string, unknown>;
      const url = String(r.url || data.url || "");
      const text = String(
        r.text || r.result_text || (r.content ? JSON.stringify(r.content) : ""),
      );
      checkpoint();
      setProject((p) => ({
        ...p,
        nodes: p.nodes.map((node) =>
          node.id === n.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  params: {
                    ...node.data.params,
                    result_url: url,
                    result_text: (text || (url ? "" : JSON.stringify(r))).slice(
                      0,
                      20000,
                    ),
                  },
                },
              }
            : node,
        ),
      }));
      notify(
        url || text
          ? "运行完成，结果已写入节点"
          : "服务已返回，响应保存在节点结果中；如为异步任务，请查询任务状态",
      );
    } catch (e) {
      notify(friendly(e));
    } finally {
      setBusy("");
    }
  };
  const runPerformanceWorkflow = async () => {
    if (!active || busy) return;
    const snapshot = projectRef.current,
      rootId = rootProjectRef.current.id,
      path = [...networkPathRef.current],
      stageId = active.id;
    checkpoint();
    setBusy("performance");
    engine.current?.performance.release();
    const patch = (
      id: string,
      params: Record<string, string | number | boolean>,
    ) =>
      setRootProject((current) =>
        current.id !== rootId
          ? current
          : updateGraph(current, path, (graph) => ({
              ...graph,
              nodes: graph.nodes.map((node) =>
                node.id === id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        params: { ...node.data.params, ...params },
                      },
                    }
                  : node,
              ),
            })),
      );
    try {
      await generatePerformance(
        snapshot,
        stageId,
        rootId,
        path,
        patch,
        setPerformanceProgress,
        () =>
          rootProjectRef.current.id === rootId &&
          JSON.stringify(networkPathRef.current) === JSON.stringify(path),
      );
      notify("整件作品素材已生成，点击启用音频并演出");
    } catch (error) {
      setPerformanceProgress({
        busy: false,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      setBusy("");
    }
  };
  const runLocalNode = async () => {
    if (!active) return;
    const node = active,
      snapshot = projectRef.current,
      rootId = rootProjectRef.current.id,
      path = [...networkPathRef.current];
    const inputs: Record<string, string> = {};
    const profile = localNodeProfile(node.type, node.data.params);
    const audioTask = ["local_music", "local_stems"].includes(node.type);
    const explicit = String(node.data.params.input_url || "");
    if (explicit) inputs[audioTask ? "audio" : "image"] = explicit;
    if (node.data.params.reference_url)
      inputs.image2 = String(node.data.params.reference_url);
    if (node.data.params.mask_url)
      inputs.mask = String(node.data.params.mask_url);
    const saveInput = async (blob: Blob, name: string) => {
      const form = new FormData();
      form.append("file", blob, name);
      const response = await fetch("/api/artifacts", {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("输入快照保存失败");
      return (await response.json()).url as string;
    };
    const capture = async (sourceId: string, kind: string) => {
      const source = snapshot.nodes.find((n) => n.id === sourceId)!;
      if (
        (source.type.startsWith("local_") ||
          source.type === "ai_image" ||
          source.type === "media") &&
        !String(
          source.data.params.result_url || source.data.params.url || "",
        ).trim()
      )
        throw new Error("请先运行或导入上游生成素材，再把结果传给当前模型");
      const value = engine.current?.values.get(
        engine.current.resolveId(sourceId),
      );
      if (kind === "CHOP") {
        const url = String(
          source.data.params.result_url || source.data.params.url || "",
        );
        if (url.startsWith("/api/assets/") || url.startsWith("/api/exports/"))
          return url;
        if (isChannelBuffer(value))
          return saveInput(
            new Blob([encodeWAV(value)], { type: "audio/wav" }),
            "local-input.wav",
          );
        throw new Error("音频输入需要本地文件 URL 或已启用的 PCM 采样节点");
      }
      if (!(value instanceof HTMLCanvasElement))
        throw new Error("输入画面尚未就绪，请上传素材或先运行上游画面");
      const blob = await new Promise<Blob>((resolve, reject) =>
        value.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("画面快照失败")),
          "image/png",
        ),
      );
      return saveInput(blob, "local-input.png");
    };
    setBusy(node.id);
    try {
      let workflow: Record<string, unknown> | undefined;
      let graph: Project | undefined;
      if (node.type === "comfy_workflow")
        workflow = JSON.parse(String(node.data.params.workflow_json || "{}"));
      else if (node.type.startsWith("comfy_")) {
        graph = snapshot;
        const visit = async (id: string, seen = new Set<string>()) => {
          if (seen.has(id)) return;
          seen.add(id);
          const n = snapshot.nodes.find((n) => n.id === id)!;
          if (n.type === "comfy_image" || n.type === "comfy_audio") {
            const url = String(n.data.params.input_url || "");
            if (!url) throw new Error("请先填写 Comfy 读取节点的素材地址");
            inputs[id] = url;
          }
          for (const edge of snapshot.edges.filter((e) => e.target === id)) {
            const src = snapshot.nodes.find((n) => n.id === edge.source)!;
            if (src.type.startsWith("comfy_")) await visit(src.id, seen);
            else
              inputs[src.id] = await capture(
                src.id,
                byType[src.type].outputs.find((p) => p.id === edge.sourceHandle)
                  ?.kind || "TOP",
              );
          }
        };
        await visit(node.id);
      } else {
        for (const edge of snapshot.edges.filter((e) => e.target === node.id)) {
          const handle = edge.targetHandle || byType[node.type].inputs[0]?.id;
          if (!handle) throw new Error("连线没有对应输入端口");
          const kind =
            byType[node.type].inputs.find((p) => p.id === handle)?.kind ||
            "TOP";
          inputs[handle] = await capture(edge.source, kind);
        }
      }
      if (
        rootProjectRef.current.id !== rootId ||
        JSON.stringify(networkPathRef.current) !== JSON.stringify(path)
      )
        throw new Error(
          "输入已保存，但作品或子网络已切换，请返回目标画布重新运行",
        );
      const parameters: Record<string, unknown> = { ...node.data.params };
      if (parameters.resolution)
        parameters.resolution = Number(parameters.resolution);
      const modes: Record<string, string> = {
        local_image: "text-to-image",
        local_image_edit: "image-edit",
        local_image_to_image: "image-to-image",
        local_inpaint: "inpaint",
      };
      if (modes[node.type]) parameters.mode = modes[node.type];
      const result = await api<LocalJob>("/local-ai/generate", {
        profile_id: profile || undefined,
        parameters,
        inputs,
        workflow,
        project: graph,
        node_id: graph ? node.id : undefined,
        metadata: { root_project_id: rootId, path, node_id: node.id },
      });
      checkpoint();
      setRootProject((current) =>
        current.id !== rootId
          ? current
          : updateGraph(current, path, (p) => ({
              ...p,
              nodes: p.nodes.map((n) =>
                n.id === node.id
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        params: {
                          ...n.data.params,
                          job_id: result.id,
                          job_status: "queued",
                          result_text: "本地任务已提交",
                        },
                      },
                    }
                  : n,
              ),
            })),
      );
      notify("本地任务已加入队列；可在节点参数或模型中心查看进度");
    } finally {
      setBusy("");
    }
  };
  const patchLocalNode = (params: Params) => {
    if (!active) return;
    checkpoint();
    setProject((current) => ({
      ...current,
      nodes: current.nodes.map((n) =>
        n.id === active.id
          ? {
              ...n,
              data: { ...n.data, params: { ...n.data.params, ...params } },
            }
          : n,
      ),
    }));
  };
  const addLocalModel = (type: string, model: string) => {
    const node = makeNode(type, 160, 140);
    if (type === "local_image" || type === "local_stems")
      node.data.params.model_id = model;
    if (type === "local_image" && model === "z-image-turbo")
      node.data.params.steps = 9;
    replace({
      ...projectRef.current,
      nodes: [...projectRef.current.nodes, node],
    });
    setSelected(node.id);
    setSelectedIds(new Set([node.id]));
    setModal("");
    notify("已添加本地生成节点，在右侧填写参数并手动运行");
  };
  const addComfyClass = (
    classType: string,
    info: {
      display_name?: string;
      input: {
        required?: Record<
          string,
          [string | string[], Record<string, unknown>?]
        >;
      };
      output_node: boolean;
    },
  ) => {
    const node = makeNode("comfy_custom", 160, 140);
    const { values, names } = comfyDefaults(info.input.required || {});
    node.data.label = info.display_name || classType;
    Object.assign(node.data.params, {
      class_type: classType,
      inputs_json: JSON.stringify(values, null, 2),
      input_names: names.slice(0, 4).join(","),
      is_output: info.output_node,
    });
    replace({
      ...projectRef.current,
      nodes: [...projectRef.current.nodes, node],
    });
    setSelected(node.id);
    setSelectedIds(new Set([node.id]));
    setModal("");
  };
  const upload = async (file: File) => {
    const uploadProjectId = projectRef.current.id;
    const uploadRootId = rootProjectRef.current.id;
    const uploadPath = [...networkPathRef.current];
    const sameUploadScope = () =>
      rootProjectRef.current.id === uploadRootId &&
      projectRef.current.id === uploadProjectId &&
      JSON.stringify(networkPathRef.current) === JSON.stringify(uploadPath);
    const form = new FormData();
    form.append("file", file);
    setBusy("upload");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("素材上传失败：" + (await res.text()));
      const r = await res.json();
      if (!sameUploadScope()) {
        notify(
          "素材已保存在 data/assets，作品或子网络已切换，本次没有添加节点",
        );
        return;
      }
      if (r.kind === "audio" || file.type.startsWith("audio/")) {
        const n = makeNode("audio", 120, 220);
        n.data.label = file.name;
        n.data.params.url = r.url;
        const next = {
          ...projectRef.current,
          nodes: [...projectRef.current.nodes, n],
        };
        replace(next);
        setSelected(n.id);
        setSelectedIds(new Set([n.id]));
        notify("音频已导入；如未自动播放，可在节点参数中点击播放");
        // Saving an uploaded asset must not depend on autoplay permission or
        // the operating system opening an audio output device successfully.
        const player = engine.current;
        // Register the asset before playback so subsequent graph updates see
        // its URL as owned by this project rather than a removed audio source.
        player?.setProject(
          updateGraph(rootProjectRef.current, uploadPath, () => next),
        );
        void player
          ?.playAudio(r.url)
          .then(() => {
            if (
              sameUploadScope() &&
              engine.current === player &&
              projectRef.current.nodes.some((node) => node.id === n.id)
            ) {
              setMic(true);
              notify("音频已导入并播放，可将音频节点连接到粒子调制端口");
            }
          })
          .catch((error) => {
            if (
              sameUploadScope() &&
              engine.current === player &&
              projectRef.current.nodes.some((node) => node.id === n.id)
            )
              notify(
                "音频已保存，播放暂未开始；可在节点参数中重试。" +
                  friendly(error),
              );
          });
      } else {
        const n = makeNode("media", 80, 200);
        n.data.label = file.name;
        n.data.params.url = r.url;
        replace({
          ...projectRef.current,
          nodes: [...projectRef.current.nodes, n],
        });
        setSelected(n.id);
        setSelectedIds(new Set([n.id]));
        setPreviewId(n.id);
        notify("素材已导入，连接输出节点即可加入作品");
      }
    } catch (e) {
      notify(friendly(e));
    } finally {
      setBusy("");
    }
  };
  const openProjects = async () => {
    setModal("projects");
    try {
      const r = await api<typeof projects | { projects: typeof projects }>(
        "/projects",
      );
      setProjects(Array.isArray(r) ? r : r.projects);
    } catch (e) {
      notify(friendly(e));
    }
  };
  const importProject = async (file: File) => {
    try {
      let p = JSON.parse(await file.text()) as Project;
      const result = await api<{
        valid: boolean;
        errors: unknown[];
        project?: Project;
      }>("/validate", p);
      if (!result.valid) throw new Error(JSON.stringify(result.errors));
      p = result.project || p;
      p.id = uid("project");
      replace(p);
      setSelected("");
      setSelectedIds(new Set());
      setPreviewId("");
      setTimeout(() => flow.fitView({ padding: 0.25 }), 100);
      notify("作品已导入并创建独立副本");
    } catch (e) {
      notify("导入失败：" + friendly(e));
    }
  };
  const saveArtifact = async (blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", blob, name);
    const response = await fetch("/api/artifacts", {
      method: "POST",
      body: form,
    });
    if (!response.ok)
      throw new Error("保存导出文件失败：" + (await response.text()));
    const result = await response.json();
    notify("已保存到 data/exports/" + result.url.split("/").pop());
    return result;
  };
  const screenshot = () => {
    try {
      preview.current?.toBlob((blob) => {
        if (blob)
          void saveArtifact(blob, "td-open-frame.png").catch((e) =>
            notify(friendly(e)),
          );
      }, "image/png");
    } catch (e) {
      notify("无法导出：素材服务需要允许跨域访问");
    }
  };
  const record = () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = preview.current!.captureStream(30);
      engine.current?.performance
        .stream()
        ?.getAudioTracks()
        .forEach((track) => stream.addTrack(track.clone()));
      const mime = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) throw new Error("浏览器不支持 WebM 录制");
      const r = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        void saveArtifact(
          new Blob(chunks, { type: "video/webm" }),
          "td-open-recording.webm",
        ).catch((e) => notify(friendly(e)));
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      r.start();
      recorder.current = r;
      setRecording(true);
      notify(
        stream.getAudioTracks().length
          ? "正在录制画面与演出声音，再次点击停止并保存"
          : "正在录制画面，再次点击停止并保存",
      );
    } catch (e) {
      notify(friendly(e));
    }
  };
  const favorites = Array.isArray(project.settings?.favoriteNodes)
    ? project.settings.favoriteNodes.filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  const toggleFavorite = (type: string) =>
    setProject((p) => {
      const list = Array.isArray(p.settings?.favoriteNodes)
        ? p.settings.favoriteNodes
        : [];
      return {
        ...p,
        settings: {
          ...p.settings,
          favoriteNodes: list.includes(type)
            ? list.filter((n) => n !== type)
            : [...list, type],
        },
      };
    });
  const filtered = catalog.filter(
    (s) =>
      (category === "全部" ||
        (category === "推荐" &&
          [
            "noise",
            "color",
            "blur",
            "particles",
            "lfo",
            "geometry",
            "output",
            "ai_image",
          ].includes(s.type)) ||
        (category === "图像" && s.family === "TOP") ||
        (category === "信号" && s.family === "CHOP") ||
        (category === "3D" && (s.family === "SOP" || s.type === "render")) ||
        (category === "数据" && s.family === "DAT") ||
        (category === "COMP" && s.family === "COMP") ||
        (category === "MAT" && s.family === "MAT") ||
        (category === "收藏" && favorites.includes(s.type)) ||
        (category === "AI" && s.family === "AI")) &&
      `${s.label} ${s.english} ${s.type}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const ptime = new Date(time * 1000).toISOString().slice(14, 22);
  const workbenchPanels = {
    library: (
      <aside className="library">
        <div className="panel-heading">
          <h2>节点资源</h2>
          <span>{catalog.length}</span>
        </div>
        <div className="search-box">
          <Search size={15} />
          <input
            id="node-search"
            placeholder="搜索节点…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value) setCategory("全部");
            }}
          />
          <kbd>Tab</kbd>
        </div>
        <div className="categories">
          {[
            "推荐",
            "图像",
            "信号",
            "3D",
            "COMP",
            "MAT",
            "数据",
            "AI",
            "收藏",
            "全部",
          ].map((c) => (
            <button
              key={c}
              className={category === c ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="library-section-label">
          {category === "推荐" ? "从这些节点开始" : category + "节点"}
          <span>点击添加</span>
        </div>
        <div className="node-list">
          {filtered.map((s) => {
            const Icon = iconFor(s.type);
            return (
              <button
                key={s.type}
                className="library-node"
                title={s.description}
                onClick={() => addNode(s.type)}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/td-node", s.type)
                }
              >
                <span
                  className="library-icon"
                  style={{
                    color: familyColors[s.family],
                    background: familyColors[s.family] + "14",
                  }}
                >
                  <Icon size={18} />
                </span>
                <span className="library-node-text">
                  <strong>{s.label}</strong>
                  <small>{s.english}</small>
                </span>
                <Plus size={14} className="add-icon" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-note">没有找到节点，试试英文名称。</div>
          )}
        </div>
        <button
          className="import-asset"
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={17} />
          <span>
            导入素材<small>图片、视频或音频</small>
          </span>
          <Plus size={14} />
        </button>
        <div className="library-tip example-guide">
          <div>
            <Zap size={14} />
            {templateById[String(project.settings?.preset)]?.name ??
              "小连接，大创意"}
          </div>
          <p>
            {templateById[String(project.settings?.preset)]?.learn ??
              "把一个节点的输出拖到另一个节点的输入，看看会发生什么。"}
          </p>
          <button onClick={() => setModal("help")}>
            认识节点与连线 <ArrowRight size={13} />
          </button>
        </div>
        <div className="library-bottom">
          <span className="dot" />
          本地优先 · 开源创作
        </div>
      </aside>
    ),
    preview: (
      <section className="preview-panel" ref={previewWrap}>
        <div className="preview-toolbar">
          <div className="preview-title">
            <span className="live-dot" />
            实时预览
            <span className="mini-divider" />{" "}
            <span className="muted">
              {previewId
                ? project.nodes.find((n) => n.id === previewId)?.data.label ||
                  "选中节点"
                : "最终输出"}
            </span>
          </div>
          <div className="preview-actions">
            <span className="resolution">
              {preview.current?.width || 640} × {preview.current?.height || 360}
            </span>
            <button
              className={`icon-button ${mic ? "on" : ""}`}
              aria-label={mic ? "关闭音频" : "启用麦克风"}
              title={mic ? "关闭音频" : "启用麦克风"}
              onClick={async () => {
                if (mic) {
                  engine.current?.stopAudio();
                  engine.current?.performance.stop();
                  setMic(false);
                } else
                  try {
                    await engine.current?.microphone();
                    setMic(true);
                    notify("麦克风已启用，可添加音频节点驱动画面");
                  } catch (e) {
                    notify("无法启用麦克风：" + friendly(e));
                  }
              }}
            >
              <Mic size={15} />
            </button>
            <button
              className="icon-button"
              title="导出 PNG"
              onClick={screenshot}
            >
              <ArrowDownToLine size={15} />
            </button>
            <button
              className={`icon-button ${recording ? "recording" : ""}`}
              title={recording ? "停止录制" : "录制画面 WebM"}
              onClick={record}
            >
              <Film size={15} />
            </button>
            <button
              className="icon-button"
              title="全屏预览"
              onClick={() =>
                previewWrap.current
                  ?.requestFullscreen()
                  .catch((e) => notify(friendly(e)))
              }
            >
              <Maximize2 size={15} />
            </button>
          </div>
        </div>
        <div className="preview-stage">
          <canvas
            ref={preview}
            width={640}
            height={360}
            aria-label="节点实时渲染画面"
          />
          <div className="preview-badge">
            <span className="dot" />
            {playing ? "LIVE" : "PAUSED"}
            <span>/{previewId || "output"}</span>
          </div>
          {previewId && (
            <button className="back-output" onClick={() => setPreviewId("")}>
              返回最终输出 <ArrowRight size={13} />
            </button>
          )}
        </div>
        <div className="transport">
          <button
            className="play-button"
            onClick={() => setPlaying((p) => !p)}
            title={playing ? "暂停（空格）" : "播放（空格）"}
          >
            {playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            title="回到起点"
            onClick={() => {
              timeRef.current = 0;
              engine.current?.performance.rewind();
              setTime(0);
              renderDirty.current = true;
            }}
          >
            <RotateCcw size={14} />
          </button>
          <span className="timecode">{ptime}</span>
          <div className="timeline-ruler">
            <div
              className="timeline-playhead"
              style={{ left: `${((time % 60) / 60) * 100}%` }}
            />
            {[0, 10, 20, 30, 40, 50, 60].map((n) => (
              <span key={n}>{String(n).padStart(2, "0")}</span>
            ))}
          </div>
          <span className="fps">
            <i /> {fps} FPS
          </span>
        </div>
      </section>
    ),
    graph: (
      <section className="graph-panel">
        <div className="graph-toolbar">
          <div className="graph-title">
            <Network size={15} />
            <strong>节点工作区</strong>
            <span className="graph-breadcrumb">
              <button onClick={() => openNetwork([])}>project</button>
              {networkPath.map((id, index) => (
                <span key={id}>
                  <ChevronRight size={12} />
                  <button
                    onClick={() => openNetwork(networkPath.slice(0, index + 1))}
                  >
                    {graphAt(
                      rootProject,
                      networkPath.slice(0, index),
                    ).nodes.find((n) => n.id === id)?.data.label || id}
                  </button>
                </span>
              ))}
              {!networkPath.length && (
                <>
                  {" "}
                  <ChevronRight size={12} /> main
                </>
              )}
            </span>
          </div>
          <div className="graph-actions">
            <button
              className={`icon-button ${!panMode ? "on" : ""}`}
              title={panMode ? "切换到框选模式" : "切换到平移模式"}
              onClick={() => setPanMode((v) => !v)}
            >
              <MousePointer2 size={14} />
            </button>
            <button
              className="icon-button"
              title="在画布添加节点 Tab"
              onClick={() => setQuickAdd({})}
            >
              <Plus size={15} />
            </button>
            <button
              className="icon-button"
              disabled={!history.current.length}
              onClick={undo}
              title="撤销 Ctrl+Z"
            >
              <Undo2 size={15} />
            </button>
            <button
              className="icon-button"
              disabled={!future.current.length}
              onClick={redo}
              title="重做 Ctrl+Shift+Z"
            >
              <Redo2 size={15} />
            </button>
            <span className="mini-divider" />
            <button
              className="button small subtle"
              onClick={() => {
                checkpoint();
                setProject((p) => ({
                  ...p,
                  nodes: p.nodes.map((n, i) => ({
                    ...n,
                    position: {
                      x: (i % 4) * 245,
                      y: Math.floor(i / 4) * 215,
                    },
                  })),
                }));
                setTimeout(
                  () => flow.fitView({ padding: 0.2, duration: 350 }),
                  80,
                );
              }}
            >
              <Grid2X2 size={13} />
              整理
            </button>
            <button
              className="icon-button"
              title="适应全部节点"
              onClick={() => flow.fitView({ padding: 0.2, duration: 400 })}
            >
              <Expand size={15} />
            </button>
          </div>
        </div>
        <div
          className="flow-container"
          tabIndex={0}
          aria-label="无限节点画布操作区"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData("application/td-node");
            if (!byType[type]) return;
            const n = makeNode(type);
            n.position = flow.screenToFlowPosition({
              x: e.clientX,
              y: e.clientY,
            });
            replace({
              ...projectRef.current,
              nodes: [...projectRef.current.nodes, n],
            });
            setSelected(n.id);
            setSelectedIds(new Set([n.id]));
          }}
        >
          <ReactFlow<FlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={checkpoint}
            onNodeClick={(event, n) => {
              setSelected(n.id);
              if (!event.ctrlKey && !event.metaKey)
                setSelectedIds(new Set([n.id]));
            }}
            onNodeDoubleClick={(_, n) =>
              n.data.node.data.graph
                ? openNetwork([...networkPath, n.id])
                : setPreviewId(n.id)
            }
            onPaneClick={(e) => {
              setSelected("");
              setSelectedIds(new Set());
              if (e.detail === 2)
                setQuickAdd({
                  position: flow.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                });
            }}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              setQuickAdd({
                position: flow.screenToFlowPosition({
                  x: e.clientX,
                  y: e.clientY,
                }),
              });
            }}
            panOnDrag={panMode ? [0, 1] : [1]}
            selectionOnDrag={!panMode}
            zoomOnDoubleClick={false}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Control", "Meta"]}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.08}
            maxZoom={3}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="dark"
            defaultEdgeOptions={{ type: "default" }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1}
              color="#32343c"
            />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) =>
                familyColors[
                  byType[(n.data as FlowNode["data"]).node.type]?.family
                ]
              }
              maskColor="#15161bbe"
              pannable
              zoomable
            />
          </ReactFlow>
          <div className="graph-hint">
            <MousePointer2 size={12} />
            滚轮缩放 · Shift 多选 · 右键添加 · 双击节点预览
          </div>
        </div>
      </section>
    ),
    inspector: (
      <aside className="inspector">
        <div className="inspector-tabs">
          <button
            className={tab === "params" ? "active" : ""}
            onClick={() => setTab("params")}
          >
            <SlidersHorizontal size={15} />
            参数
          </button>
          <button
            className={tab === "info" ? "active" : ""}
            onClick={() => setTab("info")}
          >
            <BookOpen size={15} />
            节点说明
          </button>
        </div>
        <div className="inspector-content">
          {active && spec ? (
            <>
              <div className="inspector-node">
                <span
                  className="family-tag"
                  style={{
                    color: familyColors[spec.family],
                    background: familyColors[spec.family] + "15",
                  }}
                >
                  {spec.family}
                </span>
                <div>
                  <h3>{active.data.label}</h3>
                  <small>
                    {spec.english} / {active.id.split("_").pop()}
                  </small>
                </div>
                <button
                  className="icon-button"
                  title="预览选中节点"
                  onClick={() => setPreviewId(active.id)}
                >
                  <Expand size={15} />
                </button>
              </div>
              {mediaCatalog.some((n) => n.type === active.type) && (
                <>
                  <button
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => {
                      if (!engine.current) return;
                      setBusy("媒体");
                      void engine.current
                        .activateMedia(active.id)
                        .then(async (result) => {
                          if (result.download) {
                            const blob = await fetch(result.download.url).then(
                              (r) => r.blob(),
                            );
                            await saveArtifact(blob, result.download.name);
                          }
                          if (result.localDescription)
                            setMediaSDP(result.localDescription);
                          notify(result.status);
                        })
                        .catch((e) => notify(friendly(e)))
                        .finally(() => setBusy(""));
                    }}
                  >
                    启用媒体节点 / 导出文件
                  </button>
                  {mediaSDP && (
                    <label className="stacked">
                      WebRTC 本机 SDP（复制到另一端）
                      <textarea rows={4} readOnly value={mediaSDP} />
                    </label>
                  )}
                </>
              )}
              {active.type === "web_render_top" && (
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => {
                    if (!engine.current) return;
                    setBusy("网页渲染");
                    void engine.current
                      .captureWeb(active.id)
                      .then(() => notify("网页已捕获"))
                      .catch((e) => notify(friendly(e)))
                      .finally(() => setBusy(""));
                  }}
                >
                  捕获网页
                </button>
              )}
              {active.type === "movie_file_out_top" && (
                <button
                  className="button primary"
                  onClick={() => {
                    try {
                      const running = engine.current?.toggleMovie(active.id);
                      notify(
                        running
                          ? "正在录制该节点，点击按钮停止"
                          : "录制已停止，视频正在保存到本项目",
                      );
                    } catch (e) {
                      notify(friendly(e));
                    }
                  }}
                >
                  开始 / 停止视频录制
                </button>
              )}
              {active.type.startsWith("python_script_") && (
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => {
                    if (!engine.current) return;
                    setBusy("Python");
                    void engine.current
                      .runPython(active.id, timeRef.current)
                      .then((log) =>
                        notify(
                          "Python 已运行" +
                            (log ? " · " + log.slice(0, 300) : ""),
                        ),
                      )
                      .catch((error) => notify(friendly(error)))
                      .finally(() => setBusy(""));
                  }}
                >
                  运行 Python（本机权限）
                </button>
              )}
              {active.data.graph && (
                <button
                  className="button primary"
                  onClick={() => openNetwork([...networkPath, active.id])}
                >
                  进入内部网络 →
                </button>
              )}
              {spec.reference && (
                <p className="capability-note">
                  {spec.reference.level === "bridge"
                    ? "需要外部适配器"
                    : spec.reference.level === "subset"
                      ? "已实现核心子集"
                      : "本地实现"}
                  {spec.reference.note ? " · " + spec.reference.note : ""}
                </p>
              )}
              <RuntimeInspector
                node={active}
                value={engine.current?.values.get(
                  engine.current.resolveId(active.id),
                )}
                onChange={(params) => {
                  checkpoint();
                  setProject((p) => ({
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === active.id
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              params: { ...n.data.params, ...params },
                            },
                          }
                        : n,
                    ),
                  }));
                }}
                onCapture={() => {
                  const e = engine.current;
                  if (!e) return;
                  const task = active.type.includes("devices")
                    ? e.browserInputs.refreshDevices()
                    : active.type.includes("midi")
                      ? e.browserInputs.enableMIDI()
                      : active.type.includes("audio")
                        ? e.microphone()
                        : e.browserInputs.capture(
                            e.resolveId(active.id),
                            active.type === "browser_screen_grab",
                            Number(active.data.params.device) || 0,
                          );
                  void task
                    .then(() => {
                      renderDirty.current = true;
                      notify("采集已启用");
                    })
                    .catch((error) => notify(friendly(error)));
                }}
              />
              {tab === "info" ? (
                <div className="node-info">
                  <p>{spec.description}</p>
                  <h4>输入接口</h4>
                  {spec.inputs.length ? (
                    spec.inputs.map((p) => (
                      <p key={p.id}>
                        {p.label}{" "}
                        <code>
                          {p.kind} / {p.id}
                        </code>
                      </p>
                    ))
                  ) : (
                    <p>这是源节点，不需要输入。</p>
                  )}
                  <h4>输出接口</h4>
                  {spec.outputs.map((p) => (
                    <p key={p.id}>
                      {p.label} <code>{p.kind}</code>
                    </p>
                  ))}
                  <p className="muted">
                    双击节点可以单独预览。更改参数后无需重新运行视觉节点。
                  </p>
                </div>
              ) : (
                <>
                  <p className="param-description">{spec.description}</p>
                  <div className="param-section-label">
                    基础参数
                    <button
                      className="reset-params"
                      title="重置参数"
                      onClick={() => {
                        checkpoint();
                        setProject((p) => ({
                          ...p,
                          nodes: p.nodes.map((n) =>
                            n.id === active.id
                              ? {
                                  ...n,
                                  data: {
                                    ...n.data,
                                    params: Object.fromEntries(
                                      spec.params.map((x) => [
                                        x.key,
                                        x.default,
                                      ]),
                                    ),
                                  },
                                }
                              : n,
                          ),
                        }));
                      }}
                    >
                      <RotateCcw size={11} />
                      重置
                    </button>
                  </div>
                  {spec.params
                    .filter(
                      (p) =>
                        ![
                          "result_url",
                          "result_text",
                          "outputs_json",
                          "job_id",
                          "job_status",
                          "result_kind",
                        ].includes(p.key),
                    )
                    .map((p) => (
                      <div className="param" key={active.id + p.key}>
                        {p.type === "number" ? (
                          <>
                            <label htmlFor={"param-" + p.key}>
                              {p.label}
                              <input
                                aria-label={p.label + "数值"}
                                type="number"
                                min={p.min}
                                max={p.max}
                                step={p.step || 0.01}
                                value={Number(
                                  active.data.params[p.key] ?? p.default,
                                )}
                                onFocus={checkpoint}
                                onChange={(e) => {
                                  if (e.target.value !== "")
                                    updateParam(
                                      p.key,
                                      Math.min(
                                        p.max ?? Infinity,
                                        Math.max(
                                          p.min ?? -Infinity,
                                          Number(e.target.value),
                                        ),
                                      ),
                                    );
                                }}
                              />
                            </label>
                            <input
                              id={"param-" + p.key}
                              className="slider"
                              type="range"
                              min={p.min}
                              max={p.max}
                              step={p.step || 0.01}
                              value={Number(
                                active.data.params[p.key] ?? p.default,
                              )}
                              onPointerDown={checkpoint}
                              onChange={(e) =>
                                updateParam(p.key, Number(e.target.value))
                              }
                            />
                            <div className="range-labels">
                              <span>{p.min}</span>
                              <span>{p.max}</span>
                            </div>
                          </>
                        ) : p.type === "color" ? (
                          <label>
                            {p.label}
                            <div className="color-control">
                              <input
                                type="color"
                                value={String(
                                  active.data.params[p.key] ?? p.default,
                                )}
                                onFocus={checkpoint}
                                onChange={(e) =>
                                  updateParam(p.key, e.target.value)
                                }
                              />
                              <span>
                                {String(
                                  active.data.params[p.key] ?? p.default,
                                ).toUpperCase()}
                              </span>
                            </div>
                          </label>
                        ) : p.type === "boolean" ? (
                          <label>
                            {p.label}
                            <input
                              className="toggle"
                              type="checkbox"
                              checked={Boolean(
                                active.data.params[p.key] ?? p.default,
                              )}
                              onChange={(e) =>
                                updateParam(p.key, e.target.checked, true)
                              }
                            />
                          </label>
                        ) : p.type === "select" ? (
                          <label className="stacked">
                            {p.label}
                            <select
                              value={String(
                                active.data.params[p.key] ?? p.default,
                              )}
                              onChange={(e) =>
                                updateParam(p.key, e.target.value, true)
                              }
                            >
                              {p.options?.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                        ) : p.key === "provider_id" ? (
                          <label className="stacked">
                            AI 服务
                            <select
                              aria-label="节点 AI 服务"
                              value={String(active.data.params[p.key] || "")}
                              onChange={(e) =>
                                updateParam(p.key, e.target.value, true)
                              }
                            >
                              <option value="">选择已连接的服务</option>
                              {providers
                                .filter(
                                  (v) =>
                                    v.capability ===
                                    active.type.replace("ai_", ""),
                                )
                                .map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name}
                                  </option>
                                ))}
                            </select>
                            <button
                              className="text-button"
                              onClick={() => setModal("settings")}
                            >
                              <Plus size={12} />
                              添加 AI 服务
                            </button>
                          </label>
                        ) : (
                          <label className="stacked">
                            {p.label}
                            {[
                              "prompt",
                              "text",
                              "text2",
                              "arguments",
                              "csv",
                              "workflow_json",
                              "inputs_json",
                              "lyrics",
                            ].includes(p.key) ||
                            String(
                              active.data.params[p.key] ?? p.default,
                            ).includes("\n") ? (
                              <textarea
                                rows={3}
                                aria-label={p.label}
                                value={String(
                                  active.data.params[p.key] ?? p.default,
                                )}
                                onFocus={checkpoint}
                                onChange={(e) =>
                                  updateParam(p.key, e.target.value)
                                }
                              />
                            ) : (
                              <input
                                aria-label={p.label}
                                value={String(
                                  active.data.params[p.key] ?? p.default,
                                )}
                                onFocus={checkpoint}
                                onChange={(e) =>
                                  updateParam(p.key, e.target.value)
                                }
                              />
                            )}
                          </label>
                        )}
                      </div>
                    ))}
                  {active.type === "pointcloud_stage_top" && (
                    <PerformancePanel
                      engine={engine.current}
                      nodeId={active.id}
                      progress={performanceProgress}
                      generate={runPerformanceWorkflow}
                      notify={notify}
                      onPlay={() => {
                        setPlaying(true);
                        setMic(true);
                      }}
                    />
                  )}
                  {(active.type.startsWith("local_") ||
                    active.type.startsWith("comfy_")) && (
                    <LocalNodePanel
                      node={active}
                      onRun={runLocalNode}
                      onPatch={patchLocalNode}
                      openManager={() => setModal("local-ai")}
                      openGuide={() => openDocs("local")}
                      notify={notify}
                      play={(url) => {
                        void engine.current
                          ?.playAudio(url)
                          .then(() => setMic(true))
                          .catch((error) => notify(friendly(error)));
                      }}
                      decode={() => {
                        void engine.current
                          ?.activateMedia(active.id)
                          .then(() =>
                            notify("完整音频已解码为 PCM，可连接信号处理节点"),
                          )
                          .catch((error) => notify(friendly(error)));
                      }}
                    />
                  )}
                  {spec.family === "AI" &&
                    !active.type.startsWith("local_") &&
                    !active.type.startsWith("comfy_") && (
                      <>
                        <button
                          className="button primary full"
                          disabled={!!busy}
                          onClick={runNode}
                        >
                          {busy === active.id ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                          运行{active.type === "mcp_tool" ? "工具" : "生成"}
                          {active.type !== "mcp_tool" && (
                            <small>按服务商计费</small>
                          )}
                        </button>
                        {(active.data.params.result_url ||
                          active.data.params.result_text) && (
                          <div className="generation-result">
                            <strong>运行结果</strong>
                            {active.data.params.result_url && (
                              <>
                                <a
                                  href={String(active.data.params.result_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  打开资源 ↗
                                </a>
                                {active.type === "ai_music" && (
                                  <button
                                    className="button small"
                                    onClick={() =>
                                      engine.current
                                        ?.playAudio(
                                          String(active.data.params.result_url),
                                        )
                                        .then(() => {
                                          setMic(true);
                                          notify("生成音频正在播放");
                                        })
                                        .catch((e) => notify(friendly(e)))
                                    }
                                  >
                                    <Play size={12} />
                                    播放并驱动画面
                                  </button>
                                )}
                              </>
                            )}
                            {active.data.params.result_text && (
                              <pre>
                                {String(active.data.params.result_text)}
                              </pre>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  {active.type === "audio" && active.data.params.url && (
                    <button
                      className="button full"
                      onClick={() =>
                        engine.current
                          ?.playAudio(String(active.data.params.url))
                          .then(() => {
                            setMic(true);
                            notify("音频开始播放");
                          })
                          .catch((e) => notify(friendly(e)))
                      }
                    >
                      <Play size={14} />
                      播放已导入音频
                    </button>
                  )}
                  {active.type === "media" && (
                    <button
                      className="button full"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload size={14} />
                      导入素材
                    </button>
                  )}
                  {spec.params.length === 0 && (
                    <div className="output-info">
                      <Check size={20} />
                      <strong>你的作品出口</strong>
                      <p>
                        连接一个画面节点到左侧输入。通过预览工具栏导出 PNG
                        或录制视频。
                      </p>
                    </div>
                  )}
                </>
              )}
              <div className="node-actions">
                <button onClick={duplicate}>
                  <Copy size={13} />
                  复制节点
                </button>
                <button onClick={removeNode}>
                  <Trash2 size={13} />
                  删除
                </button>
              </div>
            </>
          ) : (
            <div className="inspector-empty">
              <MousePointer2 size={28} />
              <h3>选中一个节点</h3>
              <p>
                点击工作区中的节点，
                <br />
                在这里探索它的参数。
              </p>
              <button
                className="button small"
                onClick={() => {
                  setSelected(project.nodes[0]?.id || "");
                  setSelectedIds(
                    new Set(project.nodes[0] ? [project.nodes[0].id] : []),
                  );
                }}
              >
                选择第一个节点
                <ArrowRight size={12} />
              </button>
            </div>
          )}
        </div>
      </aside>
    ),
    assistant: (
      <section className="assistant-panel">
        <div className="assistant-heading">
          <div>
            <Sparkles size={16} />
            <strong>创作助手</strong>
          </div>
          <span className="assistant-mode">
            {chatProvider ? "AI 已连接" : "本地指令"}
          </span>
        </div>
        <div className="chat-messages">
          {chats.length === 0 ? (
            <div className="chat-welcome">
              <div className="assistant-orb">
                <Sparkles size={22} />
              </div>
              <h3>从一个想法开始。</h3>
              <p>
                用一句话添加节点、调整参数。
                <br />
                连接语言模型，探索更多可能。
              </p>
              <button
                className="prompt-chip"
                onClick={() => send("添加粒子节点")}
              >
                ✧ 添加一组流动粒子 <ArrowRight size={12} />
              </button>
              <button
                className="prompt-chip"
                onClick={() => send("速度调为 0.5")}
              >
                ↝ 把画面的速度调慢 <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            chats.map((m, i) => (
              <div key={i} className={"chat-message " + m.role}>
                <span>
                  {m.role === "assistant" ? <Sparkles size={13} /> : null}
                </span>
                <p>{m.text}</p>
                {!!m.commands?.length && (
                  <div className="command-preview">
                    <details>
                      <summary>{m.commands.length} 项修改</summary>
                      <pre>{JSON.stringify(m.commands, null, 2)}</pre>
                    </details>
                    <button
                      className="button primary small"
                      disabled={m.applied}
                      onClick={() => applyChat(i)}
                    >
                      {m.applied ? <Check size={12} /> : <Play size={12} />}{" "}
                      {m.applied ? "已应用" : "应用修改"}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
          {busy === "chat" && (
            <div className="thinking">
              <LoaderCircle size={13} className="spin" />
              正在理解你的想法…
            </div>
          )}
          <div ref={chatBottom} />
        </div>
        <div className="chat-compose">
          <textarea
            aria-label="对话指令"
            placeholder="描述你想创作的画面…"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <select
              aria-label="对话模型"
              value={chatProvider}
              onChange={(e) => setChatProvider(e.target.value)}
            >
              <option value="">⌘ 本地指令模式</option>
              {providers
                .filter((p) => p.capability === "text")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <button
              className="send-button"
              disabled={!prompt.trim() || !!busy}
              onClick={() => send()}
              aria-label="发送对话"
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
        <div className="assistant-footnote">修改前可预览 · 支持撤销</div>
      </section>
    ),
  };
  return (
    <EngineContext.Provider value={engine}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-symbol">
              <Network size={22} />
            </div>
            <strong>
              TD<span>Open</span>
            </strong>
            <span className="alpha">ALPHA 0.5</span>
          </div>
          <span className="header-divider" />
          <div className="project-title">
            <input
              aria-label="作品名称"
              value={rootProject.name}
              onFocus={checkpoint}
              onChange={(e) =>
                setRootProject((p) => ({ ...p, name: e.target.value }))
              }
            />
            <ChevronDown size={13} />
          </div>
          <div className="save-state">
            <span
              className={
                saveState.includes("失败") || !backend ? "dot warning" : "dot"
              }
            />
            {saveState}
          </div>
          <div className="topbar-actions">
            <button
              className="button subtle"
              onClick={() => setModal("templates")}
            >
              <Grid2X2 size={15} />
              示例作品
            </button>
            <button
              className="icon-button"
              title="连接 AI 与 MCP"
              onClick={() => setModal("settings")}
            >
              <Plug size={18} />
            </button>
            <button className="button primary" onClick={save}>
              <Save size={15} />
              保存作品
            </button>
          </div>
        </header>
        <div className="body-layout free-body">
          <nav className="rail" aria-label="主导航">
            <button
              className="rail-button"
              title="本地生成与模型"
              onClick={() => setModal("local-ai")}
            >
              <Download size={20} />
              <span>本地 AI</span>
            </button>
            <button
              className="rail-button active"
              title="节点编辑器"
              onClick={() => setModal("")}
            >
              <Network size={21} />
              <span>创作</span>
            </button>
            <button
              className="rail-button"
              title="我的作品"
              onClick={openProjects}
            >
              <FolderOpen size={21} />
              <span>作品</span>
            </button>
            <button
              className="rail-button"
              title="AI 连接"
              onClick={() => setModal("settings")}
            >
              <Plug size={21} />
              <span>连接</span>
            </button>
            <div className="rail-spacer" />
            <button
              className="rail-button"
              title="入门指南"
              onClick={() => setModal("help")}
            >
              <BookOpen size={20} />
              <span>学习</span>
            </button>
            <button
              className="rail-button"
              title="使用帮助"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={21} />
            </button>
            <div className="avatar">YOU</div>
          </nav>
          <Workbench
            key={rootProject.id}
            saved={rootProject.settings?.workspace}
            nodeCount={catalog.length}
            onAdd={() => setQuickAdd({})}
            onChange={(layout: WorkspaceLayout) =>
              setRootProject((p) => ({
                ...p,
                settings: { ...p.settings, workspace: layout },
              }))
            }
            panels={workbenchPanels}
          />
        </div>
        <footer className="statusbar">
          <div>
            <span className={backend ? "dot" : "dot warning"} />
            {backend ? "Python 引擎已连接" : "后端未连接"}
            <span className="status-divider" />
            {engine.current?.gpu || "初始化渲染器"}
            <span className="status-divider" />
            {project.nodes.length} 个节点 · {project.edges.length} 条连接
          </div>
          <div>
            {errors.length > 0 ? (
              <button
                className="error-status"
                onClick={() => notify(errors.join("；"))}
              >
                {errors.length} 条运行提示
              </button>
            ) : (
              <span>所有系统就绪</span>
            )}
            <span className="status-divider" />
            <span>TD OPEN / MAKE SOMETHING NEW</span>
          </div>
        </footer>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept="image/*,video/*,audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <input
          hidden
          ref={importInput}
          type="file"
          accept=".json,.tdopen"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importProject(file);
            e.target.value = "";
          }}
        />
        {toast && (
          <div className="toast" role="status">
            <span>
              <Activity size={16} />
              {toast}
            </span>
            <button className="icon-button" onClick={() => setToast("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {quickAdd && (
          <NodeSearch
            close={() => setQuickAdd(null)}
            add={addNode}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            canConnect={Boolean(active && byType[active.type]?.outputs.length)}
          />
        )}
        {modal === "settings" && (
          <Settings
            close={() => {
              setModal("");
              void fetchProviders();
            }}
            notify={notify}
            openGuide={openDocs}
          />
        )}
        {["templates", "projects", "help"].includes(modal) && (
          <div
            className="modal-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setModal("")}
          >
            <section
              className={`modal ${modal === "templates" ? "examples-modal" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={
                modal === "templates"
                  ? "示例作品"
                  : modal === "projects"
                    ? "我的作品"
                    : "入门指南"
              }
            >
              <div className="modal-head">
                <div>
                  <span className="eyebrow">
                    {modal === "templates"
                      ? "A LITTLE SPARK"
                      : modal === "projects"
                        ? "YOUR CREATIVE SPACE"
                        : "START EXPLORING"}
                  </span>
                  <h2>
                    {modal === "templates"
                      ? "不用从空白开始。"
                      : modal === "projects"
                        ? "你的创作空间"
                        : "第一个作品，从连接开始。"}
                  </h2>
                  <p>
                    {modal === "templates"
                      ? "挑一个起点，改成自己的样子。"
                      : modal === "projects"
                        ? "作品以可读的 JSON 文件保存在本机。"
                        : "用四个简单步骤，认识你的新工作台。"}
                  </p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setModal("")}
                  aria-label="关闭窗口"
                >
                  <X size={20} />
                </button>
              </div>
              {modal === "templates" ? (
                <>
                  <TemplateGallery open={usePreset} />
                  <button
                    className="button subtle"
                    onClick={() => usePreset("empty")}
                  >
                    <FilePlus2 size={16} />
                    创建空白作品
                  </button>
                </>
              ) : modal === "projects" ? (
                <>
                  <div className="project-tools">
                    <button
                      className="button primary"
                      onClick={() => usePreset("empty")}
                    >
                      <Plus size={15} />
                      新建作品
                    </button>
                    <button
                      className="button"
                      onClick={() => importInput.current?.click()}
                    >
                      <Upload size={15} />
                      导入 JSON
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        void saveArtifact(
                          new Blob([JSON.stringify(rootProject, null, 2)], {
                            type: "application/json",
                          }),
                          rootProject.id + ".tdopen.json",
                        ).catch((e) => notify(friendly(e)))
                      }
                    >
                      <Download size={15} />
                      导出当前作品
                    </button>
                  </div>
                  <div className="project-list">
                    {projects.length === 0 && (
                      <div className="empty-note">
                        还没有保存的作品。回到工作区点击“保存作品”。
                      </div>
                    )}
                    {projects.map((p) => (
                      <button
                        className="project-row"
                        key={p.id}
                        onClick={async () => {
                          try {
                            const result = await api<Project>(
                              "/projects/" + p.id,
                            );
                            replace(result);
                            setModal("");
                            setSelected("");
                            setSelectedIds(new Set());
                            setPreviewId("");
                            setTimeout(
                              () => flow.fitView({ padding: 0.2 }),
                              150,
                            );
                          } catch (e) {
                            notify(friendly(e));
                          }
                        }}
                      >
                        <span className="project-icon">
                          <Network size={22} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.id}</small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="help-steps">
                    {[
                      [
                        "01",
                        "先选一个示例",
                        "流光实验无需 API 即可运行。点击“示例作品”选择起点。",
                      ],
                      [
                        "02",
                        "连接节点",
                        "从节点右侧圆点拖到另一个节点左侧圆点。接口类型需匹配：图像连图像，信号连调制。",
                      ],
                      [
                        "03",
                        "调节参数，立即看到变化",
                        "选中节点，在右侧调整参数。双击节点查看中间结果；空格暂停，Ctrl+Z 撤销。",
                      ],
                      [
                        "04",
                        "让 AI 加入创作",
                        "在“连接”中添加服务。本地指令可添加节点和修改速度；选择语言模型后可生成更多工作流修改。",
                      ],
                    ].map(([n, title, desc]) => (
                      <div key={n}>
                        <span>{n}</span>
                        <section>
                          <h3>{title}</h3>
                          <p>{desc}</p>
                        </section>
                      </div>
                    ))}
                  </div>
                  <div className="help-note">
                    <strong>这是一个独立开源项目的早期版本。</strong>
                    <p>
                      当前支持基础视觉节点、3D 渲染、AI API 和 MCP 接入。完整
                      TouchDesigner 功能、.toe/.tox
                      文件、硬件协议、组件嵌套和专业 GPU
                      管线尚未实现。完整范围请查看项目 docs/FEATURE_MATRIX.md。
                    </p>
                  </div>
                  <div className="help-actions">
                    <button
                      className="button"
                      onClick={() => openDocs("start")}
                    >
                      <BookOpen size={16} /> API 接入文档
                    </button>
                    <button
                      className="button primary"
                      onClick={() => {
                        setModal("templates");
                      }}
                    >
                      打开示例作品
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
        {docsPage && (
          <Suspense
            fallback={
              <div className="modal-backdrop" role="status">
                正在载入 API 接入文档…
              </div>
            }
          >
            <DocsCenter page={docsPage} navigate={openDocs} close={closeDocs} />
          </Suspense>
        )}
        {modal === "local-ai" && (
          <LocalAI
            close={() => setModal("")}
            guide={() => openDocs("local")}
            addNode={addLocalModel}
            addComfy={addComfyClass}
            notify={notify}
          />
        )}
      </div>
    </EngineContext.Provider>
  );
}
export default function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}
