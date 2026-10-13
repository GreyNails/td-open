import type { NodeSpec, Param, Port } from "../types";

const n = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
): Param => ({ key, label, type: "number", default: value, min, max, step });
const c = (key: string, label: string, value: string): Param => ({
  key,
  label,
  type: "color",
  default: value,
});
const s = (
  key: string,
  label: string,
  value: string,
  options: string[],
): Param => ({ key, label, type: "select", default: value, options });
const input: Port = { id: "in", kind: "TOP", label: "画面" };
const second: Port = { id: "in2", kind: "TOP", label: "第二画面" };
const mod: Port = { id: "mod", kind: "CHOP", label: "调制" };
const colors = () => [
  c("color", "亮部颜色", "#c8a4ff"),
  c("background", "暗部颜色", "#10263e"),
];
const speed = (value = 0.15) => n("speed", "流动速度", value, -2, 2);
const center = () => [n("x", "中心 X", 0.5, 0, 1), n("y", "中心 Y", 0.5, 0, 1)];
const angle = (value = 0) => n("angle", "角度", value, -360, 360, 1);
const amount = (value = 1) => n("amount", "强度", value, 0, 1);
const spec = (
  type: string,
  label: string,
  english: string,
  description: string,
  params: Param[],
  inputs: Port[] = [input],
): NodeSpec => ({
  type,
  label,
  english,
  family: "TOP",
  description,
  params,
  inputs,
  outputs: [{ id: "out", kind: "TOP", label: "画面" }],
});
const generator = (
  type: string,
  label: string,
  english: string,
  description: string,
  params: Param[],
): NodeSpec =>
  spec(type, label, english, description, [...params, ...colors()], [mod]);

/** Independent, executable Canvas operators; names describe behavior, not .toe compatibility. */
export const advancedVisualCatalog: NodeSpec[] = [
  generator(
    "cellular",
    "细胞纹理",
    "Cellular / Voronoi",
    "按最近随机种子点生成细胞距离纹理，可用于水面、石材和分区遮罩。",
    [
      n("scale", "细胞密度", 7, 1, 30),
      n("seed", "随机种子", 3, 0, 1000, 1),
      speed(),
    ],
  ),
  generator(
    "fbm_noise",
    "分形云噪声",
    "Fractal Brownian Noise",
    "叠加多层平滑值噪声，生成连续流动的云雾和地形高度场。",
    [
      n("scale", "空间尺度", 4, 0.5, 24),
      n("octaves", "噪声层数", 4, 1, 7, 1),
      n("roughness", "粗糙度", 0.5, 0.1, 0.9),
      n("seed", "随机种子", 8, 0, 1000, 1),
      speed(),
    ],
  ),
  generator(
    "mandelbrot",
    "曼德勃罗分形",
    "Mandelbrot",
    "计算复平面迭代逃逸次数，可平移、缩放和改变迭代精度。",
    [
      n("zoom", "放大倍数", 1, 0.2, 60),
      n("x", "实部中心", -0.5, -2, 2),
      n("y", "虚部中心", 0, -2, 2),
      n("iterations", "迭代上限", 60, 12, 160, 1),
      speed(0.05),
    ],
  ),
  generator(
    "julia",
    "茱莉亚分形",
    "Julia Set",
    "调整复数常量，探索不同的分形连通结构。",
    [
      n("real", "常量实部", -0.7, -1.5, 1.5),
      n("imaginary", "常量虚部", 0.27, -1.5, 1.5),
      n("zoom", "放大倍数", 1, 0.2, 40),
      n("iterations", "迭代上限", 60, 12, 160, 1),
      speed(0.05),
    ],
  ),
  generator(
    "moire",
    "摩尔干涉纹",
    "Moire Interference",
    "叠加两个略微旋转的波场，生成干涉拍频图案。",
    [
      n("frequency", "条纹密度", 24, 2, 100),
      angle(12),
      n("offset", "波场偏移", 0.15, 0, 1),
      speed(),
    ],
  ),
  generator(
    "spiral",
    "螺旋纹理",
    "Spiral",
    "把极角与半径组合成连续螺旋，可控制臂数、扭转和运动。",
    [
      n("arms", "螺旋臂数", 5, 1, 24, 1),
      n("twist", "径向扭转", 8, -30, 30),
      ...center(),
      speed(),
    ],
  ),
  generator(
    "hex_grid",
    "蜂窝网格",
    "Hexagonal Grid",
    "生成等距六边形蜂窝，独立调节网格大小、边线厚度和旋转。",
    [
      n("scale", "网格密度", 10, 2, 40),
      n("thickness", "边线占比", 0.12, 0.02, 0.5),
      angle(),
      speed(0.05),
    ],
  ),
  generator(
    "metaballs",
    "融合液滴",
    "Metaballs",
    "多个运动点的势场相互融合，生成具有柔和边缘的液态图形。",
    [
      n("count", "液滴数量", 6, 1, 16, 1),
      n("size", "液滴大小", 0.07, 0.01, 0.25),
      n("softness", "边缘柔度", 0.25, 0.01, 1),
      speed(0.25),
    ],
  ),
  generator(
    "conic_gradient",
    "角向渐变",
    "Conic Gradient",
    "围绕中心按极角渐变，可制作旋转色带和角度遮罩。",
    [...center(), angle(), n("cycles", "循环次数", 1, 1, 12, 1), speed(0.1)],
  ),
  generator(
    "linear_gradient",
    "线性渐变",
    "Linear Gradient",
    "沿任意角度生成可移动的重复线性渐变。",
    [
      angle(25),
      n("cycles", "循环次数", 1, 0.2, 12),
      n("offset", "位置偏移", 0, -1, 1),
      speed(0.1),
    ],
  ),
  generator(
    "plasma",
    "等离子场",
    "Plasma",
    "混合横向、纵向、径向与对角波场，生成流动的有机色块。",
    [
      n("scale", "图案尺度", 4, 0.5, 20),
      n("complexity", "混合比例", 0.65, 0, 1),
      speed(0.3),
    ],
  ),
  spec(
    "hue_shift",
    "色相旋转",
    "Hue Shift",
    "在 HSV 空间旋转色相，保留饱和度、明度和透明度。",
    [angle(90)],
  ),
  spec(
    "saturation",
    "色彩饱和度",
    "Saturation",
    "以感知亮度为中心增加或减少颜色饱和度。",
    [n("amount", "饱和度", 1.5, 0, 4)],
  ),
  spec(
    "brightness",
    "亮度偏移",
    "Brightness",
    "给 RGB 通道添加一致亮度偏移。",
    [n("amount", "亮度偏移", 0.15, -1, 1)],
  ),
  spec(
    "exposure",
    "曝光",
    "Exposure",
    "以摄影曝光档数调整颜色增益，每增加一档亮度翻倍。",
    [n("stops", "曝光档数", 1, -6, 6)],
  ),
  spec(
    "sepia",
    "复古棕调",
    "Sepia",
    "以经典棕褐色矩阵处理画面，可混合原始颜色。",
    [amount(0.85)],
  ),
  spec(
    "duotone",
    "双色映射",
    "Duotone",
    "按感知亮度在暗部和亮部两种颜色之间映射。",
    [...colors(), n("gamma", "明暗分布", 1, 0.1, 4)],
  ),
  spec(
    "solarize",
    "日晒负片",
    "Solarize",
    "把超过阈值的通道反相，形成模拟胶片日晒效果。",
    [n("threshold", "反相阈值", 0.5, 0, 1), amount()],
  ),
  spec(
    "color_balance",
    "通道色彩平衡",
    "Color Balance",
    "分别调整红、绿、蓝通道增益，用于校色或风格化。",
    [
      n("red", "红色增益", 1.2, 0, 3),
      n("green", "绿色增益", 1, 0, 3),
      n("blue", "蓝色增益", 0.8, 0, 3),
    ],
  ),
  spec(
    "channel_extract",
    "通道提取",
    "Channel Extract",
    "把单个颜色通道、透明度或亮度转换为灰度画面。",
    [
      s("channel", "提取通道", "red", [
        "red",
        "green",
        "blue",
        "alpha",
        "luma",
      ]),
    ],
  ),
  spec(
    "channel_shuffle",
    "通道重排",
    "Channel Shuffle",
    "交换 RGB 通道位置，可独立选择每一个输出通道的来源。",
    [
      s("red", "红色来源", "blue", [
        "red",
        "green",
        "blue",
        "alpha",
        "zero",
        "one",
      ]),
      s("green", "绿色来源", "red", [
        "red",
        "green",
        "blue",
        "alpha",
        "zero",
        "one",
      ]),
      s("blue", "蓝色来源", "green", [
        "red",
        "green",
        "blue",
        "alpha",
        "zero",
        "one",
      ]),
    ],
  ),
  spec(
    "luma_key",
    "亮度抠像",
    "Luma Key",
    "按亮度生成透明度，可保留亮部或暗部，并控制过渡范围。",
    [
      n("threshold", "亮度阈值", 0.45, 0, 1),
      n("softness", "过渡柔度", 0.15, 0, 1),
      s("keep", "保留区域", "bright", ["bright", "dark"]),
    ],
  ),
  spec(
    "color_curve",
    "三点色调曲线",
    "Tonal Curve",
    "用暗部、中间调、亮部三个控制点构建连续的颜色映射曲线。",
    [
      n("shadows", "暗部输出", 0.1, 0, 1),
      n("midtones", "中间调输出", 0.6, 0, 1),
      n("highlights", "亮部输出", 0.95, 0, 1),
    ],
  ),
  spec(
    "color_quantize",
    "色板量化",
    "Palette Quantize",
    "把每个像素映射到色板中距离最近的颜色，用于像素艺术。",
    [
      s("palette", "色板", "neon", ["neon", "pastel", "thermal", "mono"]),
      amount(),
    ],
  ),
  spec(
    "barrel",
    "桶形畸变",
    "Barrel Distortion",
    "按半径改变采样位置，模拟广角镜头桶形或枕形畸变。",
    [n("amount", "畸变强度", 0.35, -0.75, 1.5), ...center()],
  ),
  spec(
    "swirl",
    "漩涡扭曲",
    "Swirl",
    "围绕中心旋转像素，旋转角度随距离逐渐衰减。",
    [
      n("amount", "扭转圈数", 0.7, -3, 3),
      n("radius", "作用半径", 0.75, 0.05, 1.5),
      ...center(),
    ],
  ),
  spec(
    "polar",
    "极坐标变换",
    "Polar Coordinates",
    "在直角纹理和环形极坐标纹理之间转换。",
    [
      s("direction", "转换方向", "to_polar", ["to_polar", "to_rectangular"]),
      angle(),
      n("radius", "径向缩放", 1, 0.2, 3),
    ],
  ),
  spec(
    "bulge",
    "球面凸起",
    "Bulge / Pinch",
    "在指定半径内对像素进行球面挤压或膨胀。",
    [
      n("amount", "凸起强度", 0.55, -0.9, 0.9),
      n("radius", "作用半径", 0.65, 0.05, 1.5),
      ...center(),
    ],
  ),
  spec(
    "sine_warp",
    "正弦波扭曲",
    "Sine Warp",
    "使用互相垂直的正弦波偏移画面，形成可动画的水波扭曲。",
    [
      n("amplitude", "扭曲幅度", 0.05, 0, 0.3),
      n("frequency", "波数", 5, 0.1, 30),
      speed(0.3),
    ],
    [input, mod],
  ),
  spec(
    "glitch",
    "数字故障",
    "Digital Glitch",
    "对水平条带进行确定性的随机偏移，并分离红蓝通道。",
    [
      n("amount", "故障强度", 0.2, 0, 1),
      n("bands", "条带数量", 24, 2, 100, 1),
      n("seed", "随机种子", 2, 0, 1000, 1),
      speed(0.4),
    ],
    [input, mod],
  ),
  spec(
    "scanlines",
    "扫描线",
    "Scanlines",
    "模拟屏幕扫描条纹，可调节间距、强度和滚动速度。",
    [n("spacing", "扫描间距", 4, 2, 30, 1), amount(0.55), speed(0.1)],
    [input, mod],
  ),
  spec(
    "halftone",
    "半调网点",
    "Halftone",
    "按局部亮度绘制大小不同的圆形印刷网点。",
    [
      n("size", "网点间距", 9, 3, 40, 1),
      c("color", "网点颜色", "#f4d6ff"),
      c("background", "纸张颜色", "#151529"),
    ],
  ),
  spec(
    "bayer_dither",
    "有序抖色",
    "Bayer Dither",
    "使用 4×4 Bayer 阈值矩阵将画面转换为有限灰阶。",
    [n("levels", "灰阶数", 2, 2, 16, 1), n("scale", "像素尺寸", 2, 1, 8, 1)],
  ),
  spec(
    "directional_blur",
    "方向模糊",
    "Directional Blur",
    "沿选定角度平均多个采样，模拟单方向运动拖影。",
    [
      n("distance", "模糊距离", 22, 0, 100),
      angle(30),
      n("samples", "采样数", 12, 2, 32, 1),
    ],
  ),
  spec(
    "radial_blur",
    "旋转模糊",
    "Radial Blur",
    "围绕画面中心平均不同旋转角度的采样。",
    [
      n("angle", "角度范围", 18, 0, 120),
      n("samples", "采样数", 12, 2, 32, 1),
      ...center(),
    ],
  ),
  spec(
    "zoom_blur",
    "径向拉伸模糊",
    "Zoom Blur",
    "围绕中心叠加多个缩放画面，形成向外扩散的速度感。",
    [
      n("amount", "拉伸比例", 0.25, 0, 1),
      n("samples", "采样数", 12, 2, 32, 1),
      ...center(),
    ],
  ),
  spec(
    "median_filter",
    "中值去噪",
    "Median Filter",
    "以邻域中值替换 RGB，去除孤立亮点并保留边缘；在半分辨率执行。",
    [n("radius", "邻域半径", 1, 1, 3, 1)],
  ),
  spec(
    "dilate",
    "亮部膨胀",
    "Dilate",
    "取邻域各通道最大值，让亮部区域向外扩张；在半分辨率执行。",
    [n("radius", "膨胀半径", 2, 1, 5, 1)],
  ),
  spec(
    "erode",
    "亮部侵蚀",
    "Erode",
    "取邻域各通道最小值，让亮部区域收缩；在半分辨率执行。",
    [n("radius", "侵蚀半径", 2, 1, 5, 1)],
  ),
  ...(
    [
      [
        "over",
        "透明叠加",
        "Alpha Over",
        "依据第二画面的透明度叠加到第一画面上。",
      ],
      [
        "add",
        "加色合成",
        "Add Composite",
        "相加两个画面的颜色，适合光线与粒子叠加。",
      ],
      [
        "multiply",
        "正片叠底",
        "Multiply Composite",
        "逐通道相乘两个画面，适合阴影和纹理着色。",
      ],
      [
        "screen",
        "滤色合成",
        "Screen Composite",
        "相乘两个画面的反色，得到柔和的增亮效果。",
      ],
      [
        "overlay",
        "叠加合成",
        "Overlay Composite",
        "根据底图亮度切换正片叠底与滤色，增强局部对比。",
      ],
      [
        "lighten",
        "变亮合成",
        "Lighten Composite",
        "逐通道保留两张图中更亮的颜色。",
      ],
      [
        "darken",
        "变暗合成",
        "Darken Composite",
        "逐通道保留两张图中更暗的颜色。",
      ],
      [
        "xor",
        "透明异或",
        "Alpha XOR",
        "仅保留两个画面不透明区域不重叠的部分。",
      ],
    ] as const
  ).map(([type, label, english, description]) =>
    spec(
      `composite_${type}`,
      label,
      english,
      description,
      [n("opacity", "第二画面不透明度", 0.7, 0, 1)],
      [input, second],
    ),
  ),
];
