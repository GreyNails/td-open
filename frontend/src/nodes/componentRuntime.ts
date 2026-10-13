import type { GraphNode } from "../types";
import { makeChannels } from "../runtimeValues";
import { cookChannelDataNode } from "./channelDataRuntime";
import { networkTypes } from "../networks";
export function cookComponentNode(
  n: GraphNode,
  time: number,
  input: (handle?: string) => unknown,
  state: Map<string, unknown>,
): { handled: false } | { handled: true; value: unknown } {
  if (n.type === "replica_index_chop")
    return {
      handled: true,
      value: makeChannels({ index: [Number(n.data.params.__td_replica) || 0] }),
    };
  if (n.type === "animation_comp")
    return cookChannelDataNode(
      { ...n, type: "channel_keyframe" },
      time,
      input,
      state,
    );
  if (n.type === "replicator_comp") {
    let canvas = state.get("replica_canvas") as HTMLCanvasElement | undefined;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      state.set("replica_canvas", canvas);
    }
    const ctx = canvas.getContext("2d")!,
      count = Math.max(
        1,
        Math.min(16, Math.floor(Number(n.data.params.count) || 4)),
      ),
      cols = Math.ceil(Math.sqrt(count)),
      rows = Math.ceil(count / cols);
    ctx.clearRect(0, 0, 640, 360);
    for (let i = 0; i < count; i++) {
      const source = input("copy_" + i);
      if (source instanceof HTMLCanvasElement)
        ctx.drawImage(
          source,
          ((i % cols) * 640) / cols,
          (Math.floor(i / cols) * 360) / rows,
          640 / cols,
          360 / rows,
        );
    }
    return { handled: true, value: canvas };
  }
  if (networkTypes.has(n.type))
    return { handled: true, value: input("internal") ?? input() ?? 0 };
  if (/^network_(in|out)_|^operator_select_/.test(n.type))
    return { handled: true, value: input() ?? 0 };
  const type = n.type.replace(/_comp$/, "");
  if (
    ![
      "button",
      "field",
      "list",
      "op_viewer",
      "parameter",
      "slider",
      "table",
      "text",
      "time",
      "animation",
      "annotate",
      "window",
      "select",
      "replicator",
    ].includes(type) ||
    !n.type.endsWith("_comp")
  )
    return { handled: false };
  const p = n.data.params;
  let canvas = state.get("panel") as HTMLCanvasElement | undefined;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    state.set("panel", canvas);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 640, 360);
  ctx.fillStyle = "#171a25";
  ctx.fillRect(0, 0, 640, 360);
  const src = input();
  if (src instanceof HTMLCanvasElement) {
    if (type === "replicator") {
      const count = Math.max(1, Math.min(100, Number(p.count) || 4)),
        cols = Math.ceil(Math.sqrt(count)),
        rows = Math.ceil(count / cols);
      for (let i = 0; i < count; i++)
        ctx.drawImage(
          src,
          ((i % cols) * 640) / cols,
          (Math.floor(i / cols) * 360) / rows,
          640 / cols,
          360 / rows,
        );
    } else ctx.drawImage(src, 0, 0, 640, 360);
  }
  ctx.fillStyle = String(p.color || "#a995fa");
  ctx.font = "28px sans-serif";
  ctx.textAlign = "center";
  const value = Math.max(0, Math.min(1, Number(p.value) || 0));
  if (type === "slider" || type === "time" || type === "animation") {
    ctx.fillStyle = "#34374c";
    ctx.fillRect(60, 180, 520, 8);
    ctx.fillStyle = String(p.color || "#a995fa");
    ctx.fillRect(
      60,
      180,
      520 * (type === "time" ? (time % 10) / 10 : value),
      8,
    );
    ctx.beginPath();
    ctx.arc(60 + 520 * value, 184, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(
      type === "time" ? time.toFixed(2) + " s" : value.toFixed(3),
      320,
      130,
    );
  } else if (["list", "table", "parameter"].includes(type)) {
    const rows = String(p.items || "")
      .split("\n")
      .slice(0, 10);
    ctx.textAlign = "left";
    ctx.font = "20px sans-serif";
    rows.forEach((row, i) => {
      ctx.fillStyle =
        i === Math.round(value * (rows.length - 1)) ? "#534473" : "#262937";
      ctx.fillRect(35, 25 + i * 30, 570, 28);
      ctx.fillStyle = "#ebe8f5";
      ctx.fillText(row.replaceAll(",", "    "), 50, 47 + i * 30);
    });
  } else if (type === "button") {
    ctx.fillStyle = value ? "#745bc9" : "#343044";
    ctx.fillRect(140, 120, 360, 100);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(p.text || "Button"), 320, 180);
  } else if (!["op_viewer", "window", "select", "replicator"].includes(type)) {
    String(p.text || "")
      .split("\n")
      .slice(0, 9)
      .forEach((line, i) => ctx.fillText(line, 320, 100 + i * 32));
  }
  return { handled: true, value: canvas };
}
