import type { NodeSpec, Param, Port } from "../types";

const n = (
  key: string,
  label: string,
  value: number,
  min = 0,
  max = 1,
  step = 0.01,
): Param => ({ key, label, type: "number", default: value, min, max, step });
const pick = (
  key: string,
  label: string,
  value: string,
  options: string[],
): Param => ({ key, label, type: "select", default: value, options });
const flag = (key: string, label: string, value = false): Param => ({
  key,
  label,
  type: "boolean",
  default: value,
});
const image: Port = { id: "in", kind: "TOP", label: "图像 / 前景" };
const mask: Port = { id: "in2", kind: "TOP", label: "遮罩" };
const background: Port = { id: "in3", kind: "TOP", label: "背景（可选）" };
const boundary = () =>
  pick("boundary", "图像边界", "clamp", [
    "clamp",
    "mirror",
    "wrap",
    "transparent",
  ]);
const matteParams = (): Param[] => [
  pick("channel", "遮罩通道", "alpha", [
    "alpha",
    "luminance",
    "red",
    "green",
    "blue",
    "rgb_average",
    "rgba_average",
    "rgb_max",
    "rgba_max",
  ]),
  flag("invert", "反转遮罩"),
];

type Definition = [string, string, string, Param[], Port[]?, string?];
const definitions: Definition[] = [
  [
    "rgb_key",
    "RGB Key",
    "RGB 范围抠像",
    [
      ...(["red", "green", "blue"] as const).flatMap((color, index) => [
        n(`${color}_min`, `${["红", "绿", "蓝"][index]} 最小值`, 0),
        n(`${color}_max`, `${["红", "绿", "蓝"][index]} 最大值`, 1),
        n(`${color}_soft_low`, `${["红", "绿", "蓝"][index]} 下边界柔化`, 0),
        n(`${color}_soft_high`, `${["红", "绿", "蓝"][index]} 上边界柔化`, 0),
      ]),
      flag("invert", "反转新 Alpha"),
      pick("rgb_output", "RGB 输出", "source", [
        "source",
        "multiply_alpha",
        "new_alpha",
      ]),
      pick("alpha_output", "Alpha 输出", "multiply_source", [
        "new_alpha",
        "multiply_source",
      ]),
    ],
    undefined,
    "独立 RGB 上下限及六个柔化宽度，三通道交集生成 Alpha；输出 RGB/Alpha 可分别选择。柔化采用区间外 smoothstep。",
  ],
  [
    "lens_distort",
    "Lens Distort",
    "镜头畸变",
    [
      n("k1", "径向 K1", 0, -3, 3),
      n("k2", "径向 K2", 0, -3, 3),
      n("k3", "径向 K3", 0, -3, 3),
      n("p1", "切向 P1", 0, -1, 1),
      n("p2", "切向 P2", 0, -1, 1),
      n("cx", "主点 X / 宽度", 0.5, -2, 3),
      n("cy", "主点 Y / 高度", 0.5, -2, 3),
      n("fx", "焦距 X / 宽度", 1, 0.01, 10),
      n("fy", "焦距 Y / 高度", 1, 0.01, 10),
      pick("direction", "映射方向", "undistort", ["undistort", "distort"]),
      pick("filter", "采样", "bilinear", ["bilinear", "nearest"]),
      boundary(),
    ],
    undefined,
    "Brown–Conrady K1/K2/K3/P1/P2 与主点、焦距。undistort 直接反向采样，distort 用数值求逆；无法收敛的采样透明。不含自动裁切/相机标定/3D 纹理。",
  ],
  [
    "level",
    "Level",
    "综合色阶",
    [
      n("black", "输入黑点", 0),
      n("white", "输入白点", 1),
      n("gamma", "Gamma", 1, 0.01, 8),
      n("brightness", "亮度偏移", 0, -2, 2),
      n("contrast", "对比度", 1, 0, 8),
      n("pivot", "对比度中心", 0.5),
      n("opacity", "不透明度", 1),
    ],
    undefined,
    "单次查找表：输入黑白点 → Gamma → 亮度偏移 → 围绕中心的对比度；Alpha 乘不透明度。不含 TD 多级阶梯与逐通道页。",
  ],
  [
    "reorder",
    "Reorder",
    "RGBA 通道重排",
    ["R", "G", "B", "A"].map((value) =>
      pick(value.toLowerCase(), `输出 ${value}`, value, [
        "R",
        "G",
        "B",
        "A",
        "0",
        "1",
      ]),
    ),
    undefined,
    "RGBA 每个输出通道可选择任一输入通道或常数 0/1；单输入二维图像子集。",
  ],
  [
    "hsv_adjust",
    "HSV Adjust",
    "HSV 调色",
    [
      n("hue", "色相旋转（度）", 0, -360, 360, 1),
      n("saturation", "饱和度倍率", 1, 0, 8),
      n("saturation_offset", "饱和度偏移", 0, -2, 2),
      n("value", "明度倍率", 1, 0, 8),
      n("value_offset", "明度偏移", 0, -2, 2),
      flag("clamp", "转换前限制 S/V 到 0–1", true),
    ],
    undefined,
    "RGB→HSV→调整→RGB；色相循环，S/V 可选预先 clamp。最终 RGBA8 始终裁切到 0–255；无浮点 HDR 输出。",
  ],
  [
    "matte",
    "Matte",
    "遮罩合成",
    matteParams(),
    [image, mask, background],
    "输入 2 遮罩混合输入 1 前景与可选输入 3 背景；支持 Alpha、亮度和独立颜色通道以及反转。直通 Alpha 图像按预乘颜色加权再还原；接口顺序与 TD 不同。",
  ],
  [
    "inside",
    "Inside",
    "遮罩内部",
    [
      ...matteParams(),
      pick("affect", "乘遮罩的通道", "rgba", ["rgba", "alpha"]),
    ],
    [image, mask],
    "输入 1 的 RGBA 乘输入 2 所选遮罩；alpha 模式只改变透明度，适合浏览器直通 Alpha。支持反转与亮度遮罩。",
  ],
  [
    "blur",
    "Blur",
    "可控模糊",
    [
      pick("method", "核类型", "gaussian", ["gaussian", "box", "custom"]),
      n("radius", "核半径（像素）", 3, 0, 32, 1),
      n("sigma", "高斯 Sigma", 1.5, 0.05, 32),
      {
        key: "kernel",
        label: "自定义非负核 JSON（奇数阶，最大 15）",
        type: "text",
        default: "[[1,2,1],[2,4,2],[1,2,1]]",
      },
      boundary(),
      flag("premultiply", "预乘 Alpha 滤波，避免黑边", true),
    ],
    undefined,
    "归一化 Gaussian/Box 可分离卷积及自定义非负奇数核；边界 clamp/mirror/wrap/transparent，透明边界不重归一化。不含运动向量与深度模糊。",
  ],
];

/** Exact reference names identify the implemented, explicitly bounded RGBA8 subset. */
export const compatibilityTopCatalog: NodeSpec[] = definitions.map(
  ([id, english, label, params, inputs = [image], note = ""]) => ({
    type: `compat_${id}`,
    english,
    label,
    family: "TOP",
    params,
    inputs,
    outputs: [{ id: "out", kind: "TOP", label: "图像" }],
    description: `${note} 当前为 CPU RGBA8 二维图像子集。`,
    reference: {
      family: "TOP",
      name: english,
      level: "subset",
      note: `CPU RGBA8 2D. ${note}`,
    },
  }),
);

export const compatibilityTopCoverage = compatibilityTopCatalog.map(
  ({ type, reference, params }) => ({
    type,
    ...reference,
    parameters: params.map(({ key }) => key),
  }),
);
