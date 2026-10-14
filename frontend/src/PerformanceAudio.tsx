import { useEffect, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import type { StudioEngine } from "./engine";
import "./performance.css";
export default function PerformanceAudio({
  engine,
  musicUrl,
  volume,
  starting,
  disabled,
  toggle,
  setVolume,
}: {
  engine: StudioEngine | null;
  musicUrl: string;
  volume: number;
  starting: boolean;
  disabled: boolean;
  toggle: () => void;
  setVolume: (volume: number) => void;
}) {
  const [status, setStatus] = useState(engine?.performance.status);
  useEffect(() => {
    const poll = () => setStatus(engine?.performance.status);
    poll();
    const timer = setInterval(poll, 200);
    return () => clearInterval(timer);
  }, [engine]);
  const needsUnlock = status?.ready && status.audioState !== "running";
  const label = starting
    ? "正在启用音乐…"
    : !status?.ready
      ? "播放生成音乐"
      : needsUnlock
        ? "启用浏览器声音"
        : status.playing
          ? "暂停音乐"
          : "继续音乐";
  const message =
    status?.error ||
    (!musicUrl
      ? "请先生成音乐"
      : !status?.ready
        ? "音乐未启用，点击播放"
        : volume === 0
          ? "音乐已静音"
          : needsUnlock
            ? "浏览器声音尚未启用"
            : status.playing
              ? "音乐与点云同步播放"
              : "音乐已暂停");
  return (
    <section className="performance-audio" aria-label="案例音乐控制">
      <button
        className="button"
        disabled={starting || disabled || !musicUrl}
        onClick={toggle}
      >
        {status?.playing ? <Pause size={14} /> : <Play size={14} />} {label}
      </button>
      <button
        className="icon-button"
        aria-label={volume === 0 ? "取消音乐静音" : "静音音乐"}
        title={volume === 0 ? "取消音乐静音" : "静音音乐"}
        onClick={() => setVolume(volume === 0 ? 0.65 : 0)}
      >
        {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <label className="performance-volume">
        <input
          aria-label="音乐音量"
          type="range"
          min="0"
          max="1"
          step=".05"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
        <span>{Math.round(volume * 100)}%</span>
      </label>
      <meter
        aria-label="音乐输出电平"
        min={0}
        max={0.25}
        value={status?.level || 0}
        title="来自音量控制之后的真实音频输出"
      />
      <span className="performance-audio-status" role="status">
        {message}
      </span>
      {musicUrl && (
        <a href={musicUrl} target="_blank" rel="noopener noreferrer">
          试听原始音乐
        </a>
      )}
    </section>
  );
}
