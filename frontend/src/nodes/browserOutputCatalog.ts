import type { NodeSpec, Param } from "../types";
const p = (
  key: string,
  label: string,
  value: string | number | boolean,
): Param => ({
  key,
  label,
  type:
    typeof value === "number"
      ? "number"
      : typeof value === "boolean"
        ? "boolean"
        : "text",
  default: value,
});
export const browserOutputCatalog: NodeSpec[] = [
  {
    type: "web_render_top",
    label: "网页渲染",
    english: "Web Render",
    family: "TOP",
    description:
      "使用独立 Chromium 真正加载网页或 HTML，显式点击捕获截图。支持 CSS 选择器 click/fill/scroll 操作列表；不共享浏览器登录状态。需安装 Node.js、Playwright Chromium。",
    inputs: [],
    outputs: [{ id: "out", kind: "TOP", label: "网页图像" }],
    params: [
      p("url", "网页 URL", "https://example.com"),
      p("html", "HTML（非空时使用）", ""),
      p("actions", "浏览器操作 JSON", "[]"),
      p("width", "宽度", 640),
      p("height", "高度", 360),
    ],
    reference: {
      family: "TOP",
      name: "Web Render",
      level: "subset",
      note: "真实 Chromium 页面截取和输入动作；显式刷新，非持续纹理共享。",
    },
  },
  {
    type: "movie_file_out_top",
    label: "视频文件输出",
    english: "Movie File Out",
    family: "TOP",
    description:
      "通过 MediaRecorder 录制输入画面为 WebM，停止录制后自动保存到本项目 data/exports。支持浏览器的 VP8/VP9，不包含专业硬件视频编解码器。",
    inputs: [{ id: "in", kind: "TOP", label: "画面" }],
    outputs: [{ id: "out", kind: "TOP", label: "画面" }],
    params: [p("fps", "帧率", 30)],
    reference: {
      family: "TOP",
      name: "Movie File Out",
      level: "subset",
      note: "真实 WebM 文件录制，手动开始/停止。",
    },
  },
];
