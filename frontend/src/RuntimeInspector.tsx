import type { GraphNode, Params } from "./types";
import { isChannelBuffer, isTableData } from "./runtimeValues";
export function RuntimeInspector({
  node,
  value,
  onChange,
  onCapture,
}: {
  node: GraphNode;
  value: unknown;
  onChange: (p: Params) => void;
  onCapture: () => void;
}) {
  return (
    <div className="runtime-inspector">
      {node.type.startsWith("browser_") &&
        [
          "video_device_in",
          "screen_grab",
          "midi_in",
          "midi_event",
          "midi_out",
          "audio_device_in",
          "midi_dat",
          "midi_map",
          "audio_devices",
          "video_devices",
        ].some((t) => node.type === "browser_" + t) && (
          <button className="button primary" onClick={onCapture}>
            {node.type.includes("devices")
              ? "刷新设备列表"
              : "启用 " +
                (node.type.includes("midi")
                  ? "MIDI"
                  : node.type.includes("audio")
                    ? "麦克风"
                    : "采集")}
          </button>
        )}
      {node.type === "button_comp" && (
        <button
          className="button primary"
          aria-label="面板按钮"
          onClick={() =>
            onChange({ value: Number(node.data.params.value) ? 0 : 1 })
          }
        >
          {String(node.data.params.text)} ·{" "}
          {Number(node.data.params.value) ? "ON" : "OFF"}
        </button>
      )}
      {node.type === "slider_comp" && (
        <input
          aria-label="面板滑杆"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={Number(node.data.params.value) || 0}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
        />
      )}
      {node.type === "field_comp" && (
        <input
          aria-label="面板输入框"
          value={String(node.data.params.text || "")}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      )}
      {node.type === "list_comp" && (
        <select
          aria-label="面板列表"
          value={Number(node.data.params.value) || 0}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
        >
          {String(node.data.params.items || "")
            .split("\n")
            .map((x, i, all) => (
              <option key={i} value={i / Math.max(1, all.length - 1)}>
                {x}
              </option>
            ))}
        </select>
      )}
      {isChannelBuffer(value) && (
        <div className="runtime-values">
          <strong>
            {value.channels.length} 通道 ·{" "}
            {value.channels[0]?.samples.length || 0} 样本 · {value.sampleRate}{" "}
            Hz
          </strong>
          {value.channels.slice(0, 12).map((ch, i) => (
            <div key={ch.name}>
              <code>{ch.name}</code>
              <svg viewBox="0 0 220 42" aria-label={ch.name + "波形"}>
                <polyline
                  fill="none"
                  stroke={["#73cda8", "#b29af7", "#e5bb6f"][i % 3]}
                  strokeWidth="1.5"
                  points={ch.samples
                    .filter(
                      (_, j) =>
                        j % Math.max(1, Math.ceil(ch.samples.length / 180)) ===
                        0,
                    )
                    .map(
                      (v, j, a) =>
                        `${(j * 220) / Math.max(1, a.length - 1)},${21 - Math.max(-1, Math.min(1, v)) * 19}`,
                    )
                    .join(" ")}
                />
              </svg>
              <small>{ch.samples.at(-1)?.toFixed(5)}</small>
            </div>
          ))}
        </div>
      )}
      {isTableData(value) && (
        <div className="runtime-table">
          <strong>
            {value.rows.length} 行 ×{" "}
            {Math.max(0, ...value.rows.map((r) => r.length))} 列
          </strong>
          <table>
            <tbody>
              {value.rows.slice(0, 24).map((r, i) => (
                <tr key={i}>
                  {r.slice(0, 8).map((v, j) => (
                    <td key={j}>{v.slice(0, 120)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
