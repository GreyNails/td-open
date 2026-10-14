import type { NodeSpec, Param, Port } from "../types";
const num = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
): Param => ({ key, label, type: "number", default: value, min, max, step });
const text = (key: string, label: string, value = ""): Param => ({
  key,
  label,
  type: "text",
  default: value,
});
const port = (id: string, kind: string, label: string): Port => ({
  id,
  kind,
  label,
});
const geo = port("in", "SOP", "真实网格 / 点云");
export const performanceCatalog: NodeSpec[] = [
  {
    type: "image_to_pointcloud_sop",
    label: "图片转平面点云",
    english: "Image to Planar Point Cloud",
    family: "SOP",
    description:
      "直接采样已有图片的像素，以亮度或透明度筛选前景，输出 XY 平面、Z=0 的点云；保留比例、像素颜色和 UV，不调用生成模型。",
    inputs: [port("in", "TOP", "原始图片 / 遮罩")],
    outputs: [port("out", "SOP", "平面点云")],
    params: [
      num("resolution", "最长边采样数", 160, 8, 512, 1),
      num("threshold", "前景阈值", 0.5, 0, 1),
      {
        key: "mask",
        label: "前景选择",
        type: "select",
        default: "bright",
        options: ["bright", "dark", "alpha"],
      },
      {
        key: "region",
        label: "采样区域",
        type: "select",
        default: "fill",
        options: ["fill", "outline"],
      },
      num("width", "图像平面宽度", 3, 0.1, 10, 0.1),
    ],
  },
  {
    type: "pointcloud_project_top",
    label: "平面点云正视图",
    english: "Planar Point Cloud View",
    family: "TOP",
    description:
      "正交投影真实点坐标，显示清晰的点阵轮廓。无透视旋转，不改变点云数据。",
    inputs: [geo],
    outputs: [port("out", "TOP", "点阵画面")],
    params: [
      num("view_width", "视野宽度", 4, 0.1, 20, 0.1),
      num("point_size", "点半径（像素）", 1.2, 0.3, 8, 0.1),
      {
        key: "source_color",
        label: "使用图片原色",
        type: "boolean",
        default: false,
      },
      { key: "color", label: "点颜色", type: "color", default: "#ffd598" },
      { key: "background", label: "背景", type: "color", default: "#080d1b" },
    ],
  },
  {
    type: "model_to_pointcloud_sop",
    label: "模型转表面点云",
    english: "Surface Point Cloud",
    family: "SOP",
    description:
      "读取真实 GLB / SOP 网格，按三角面面积进行确定性采样；保留法线，不使用替代几何。",
    inputs: [geo],
    outputs: [port("out", "SOP", "表面点云")],
    params: [
      num("count", "点数量", 28000, 500, 60000, 500),
      num("seed", "采样种子", 41, 0, 4294967295, 1),
      num("height", "标准化高度", 2.7, 0.1, 10, 0.1),
    ],
  },
  {
    type: "stem_track_chop",
    label: "读取独立分轨",
    english: "Stem Track PCM",
    family: "CHOP",
    description:
      "从上游本地分轨任务中解析指定声部，使用完整 WAV 的真实 PCM；在声景舞台一次启用所有轨道。",
    inputs: [port("in", "CHOP", "本地分轨结果")],
    outputs: [port("out", "CHOP", "声部 PCM")],
    params: [
      {
        key: "track",
        label: "声部",
        type: "select",
        default: "vocals",
        options: ["vocals", "drums", "bass", "other", "instrumental"],
      },
      num("samples", "分析窗口", 2048, 512, 8192, 512),
    ],
  },
  {
    type: "audio_envelope_chop",
    label: "音乐能量与瞬态",
    english: "Audio Envelope",
    family: "CHOP",
    description:
      "从真实声部 PCM 计算 RMS 与瞬态；按该声部的整体能量自适应归一化，并使用攻击 / 释放平滑。静音输出零。",
    inputs: [port("in", "CHOP", "声部 PCM")],
    outputs: [port("out", "CHOP", "energy / hit / rms")],
    params: [
      num("gain", "响应强度", 1, 0.1, 4, 0.1),
      num("attack", "攻击时间（秒）", 0.035, 0.005, 0.5, 0.005),
      num("release", "释放时间（秒）", 0.25, 0.02, 2, 0.01),
    ],
  },
  {
    type: "pointcloud_dance_sop",
    label: "四声部点云编舞",
    english: "Four Stem Choreography",
    family: "SOP",
    description:
      "人声变色、鼓点沿表面法线推进、贝斯呼吸缩放、其他声部产生流动波纹；保留真实点云，GPU 执行连续变形。",
    inputs: [
      geo,
      port("vocals", "CHOP", "人声 · 色彩"),
      port("drums", "CHOP", "鼓 · 跳动"),
      port("bass", "CHOP", "贝斯 · 缩放"),
      port("other", "CHOP", "其他 · 波纹"),
    ],
    outputs: [port("out", "SOP", "点云编舞")],
    params: [
      num("pulse", "鼓点冲击", 0.12, 0, 0.5),
      num("scale", "贝斯呼吸", 0.14, 0, 0.5),
      num("ripple", "流动波纹", 0.075, 0, 0.3),
      num("color_mix", "人声色彩", 0.75, 0, 1),
    ],
  },
  {
    type: "pointcloud_stage_top",
    label: "潮汐声景舞台",
    english: "Tidal Point Stage",
    family: "TOP",
    description:
      "为真实点云提供发光粒子、缓慢运镜、光环与声部指示。点击生成整件作品，再启用音频；音频时钟同步驱动画面。",
    inputs: [geo],
    outputs: [port("out", "TOP", "艺术画面")],
    params: [
      text("title", "作品标题", "潮汐之像"),
      text("subtitle", "副标题", "TIDAL MUSE · WHERE SOUND BECOMES FORM"),
      num("width", "画面宽度", 1280, 640, 1920, 160),
      num("height", "画面高度", 720, 360, 1080, 90),
      num("point_size", "粒子尺寸", 3.2, 0.6, 8, 0.1),
      num("glow", "光晕强度", 2.1, 0.2, 3, 0.05),
      { key: "warm", label: "暖色", type: "color", default: "#ffd089" },
      { key: "cool", label: "冷色", type: "color", default: "#4de0cc" },
      { key: "accent", label: "点缀色", type: "color", default: "#aa80ff" },
      num("volume", "音乐音量", 0.65, 0, 1, 0.05),
    ],
  },
];
export const performanceTypes = new Set(
  performanceCatalog.map((node) => node.type),
);
