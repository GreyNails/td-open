import { useEffect, useState } from "react";
import { Play, Square, Download, Sparkles, Music2 } from "lucide-react";
import { api } from "./types";
import type { StudioEngine } from "./engine";
import type { PerformanceProgress } from "./performanceWorkflow";
import "./performance.css";
export default function PerformancePanel({
  engine,
  nodeId,
  progress,
  generate,
  notify,
  onPlay,
}: {
  engine: StudioEngine | null;
  nodeId: string;
  progress: PerformanceProgress;
  generate: () => Promise<void>;
  notify: (message: string) => void;
  onPlay: () => void;
}) {
  const [preparing, setPreparing] = useState(false),
    [status, setStatus] = useState(engine?.performance.status);
  useEffect(() => {
    const timer = setInterval(() => setStatus(engine?.performance.status), 400);
    return () => clearInterval(timer);
  }, [engine]);
  return (
    <section className="performance-panel">
      <strong>
        <Music2 size={16} />
        潮汐声景 · 完整工作流
      </strong>
      <p>
        图像 → 三维 → 表面点云
        <br />
        音乐 → 四轨 → 色彩 / 冲击 / 呼吸 / 波纹
      </p>
      <button
        className="button full"
        disabled={progress.busy || preparing}
        onClick={() => void generate().catch((error) => notify(error.message))}
      >
        <Sparkles size={15} />
        生成整件作品
      </button>
      {progress.message && <p role="status">{progress.message}</p>}
      {progress.busy && progress.jobId && (
        <button
          className="button small"
          onClick={() =>
            void api("/local-ai/jobs/" + progress.jobId + "/cancel", {}).catch(
              (e) => notify(e.message),
            )
          }
        >
          <Square size={13} />
          取消当前生成
        </button>
      )}
      <button
        className="button primary full"
        disabled={progress.busy || preparing}
        onClick={async () => {
          if (!engine) return;
          setPreparing(true);
          try {
            await engine.startPerformance(nodeId);
            onPlay();
            notify("音乐与四个真实声部已同步启用");
          } catch (error) {
            notify((error as Error).message);
          } finally {
            setPreparing(false);
          }
        }}
      >
        <Play size={15} />
        {preparing ? "正在读取完整音乐与四轨…" : "启用音频并演出"}
      </button>
      {status?.ready && (
        <>
          <small>
            {status.tracks} 个声部 · {status.duration.toFixed(1)} 秒 ·{" "}
            {status.playing ? "同步播放" : "已暂停"} · {status.time.toFixed(1)}{" "}
            s
          </small>
          <button
            className="button small"
            onClick={() => {
              engine?.performance.stop();
              notify("演出声音已停止");
            }}
          >
            <Square size={13} />
            停止声音
          </button>
        </>
      )}
      <button
        className="button small"
        onClick={() => {
          try {
            const text = engine?.exportPerformancePoints(nodeId);
            if (!text) return;
            const url = URL.createObjectURL(
                new Blob([text], { type: "application/octet-stream" }),
              ),
              link = document.createElement("a");
            link.href = url;
            link.download = "tidal-muse-points.ply";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) {
            notify((error as Error).message);
          }
        }}
      >
        <Download size={13} />
        导出当前点云 PLY
      </button>
      <p className="performance-note">
        播放后由同一个音频时钟驱动画面。暂停按钮会同时暂停音乐；再次启用演出从头播放。点云来自真实生成模型。
      </p>
    </section>
  );
}
