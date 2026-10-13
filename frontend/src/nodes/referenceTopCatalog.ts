import type { NodeSpec, Param, Port } from "../types";
const n = (
  key: string,
  label: string,
  value: number,
  min = -10,
  max = 10,
  step = 0.01,
): Param => ({ key, label, type: "number", default: value, min, max, step });
const t = (key: string, label: string, value: string): Param => ({
  key,
  label,
  type: "text",
  default: value,
});
const c = (
  key: string,
  label: string,
  value: string,
  options: string[],
): Param => ({ key, label, type: "select", default: value, options });
const flag = (key: string, label: string, value: boolean): Param => ({
  key,
  label,
  type: "boolean",
  default: value,
});
const image: Port = { id: "in", kind: "TOP", label: "图像" },
  second: Port = { id: "in2", kind: "TOP", label: "第二张图像 / 控制图" };
const shader = `#version 300 es
precision highp float;
uniform sampler2D uInput0;
uniform sampler2D uInput1;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMod;
in vec2 vUV;
out vec4 fragColor;
void main(){
  vec4 source=texture(uInput0,vUV);
  vec3 waves=0.5+0.5*cos(uTime+vUV.xyx*6.283+vec3(0,2,4));
  fragColor=vec4(mix(waves,source.rgb,source.a*0.65),1.0);
}`;
const defs: [string, string, Param[], boolean?][] = [
  [
    "Analyze",
    "统计所有像素，输出平均/最大/最小/RMS颜色的单色结果。",
    [
      c("operation", "统计", "average", [
        "average",
        "maximum",
        "minimum",
        "rms",
      ]),
    ],
  ],
  [
    "Anti Alias",
    "通过实际3×3边缘自适应滤波缓和锯齿；不是硬件MSAA。",
    [n("strength", "强度", 0.7, 0, 1)],
  ],
  [
    "Blob Track",
    "按亮度阈值查找连通像素区域，绘制包围框、重心和编号。",
    [
      n("threshold", "阈值", 0.5, 0, 1),
      n("min_area", "最小区域像素", 12, 1, 10000, 1),
    ],
  ],
  [
    "Bloom",
    "提取高亮、模糊并叠加辉光。",
    [
      n("threshold", "亮部阈值", 0.5, 0, 1),
      n("radius", "模糊像素", 10, 0, 80),
      n("strength", "辉光强度", 1, 0, 5),
    ],
  ],
  [
    "Cache",
    "保存有界的真实图像帧历史；连接Cache Select选择过去的帧。",
    [
      n("frames", "缓存帧数", 30, 1, 120, 1),
      n("offset", "向前偏移帧", 0, 0, 119, 1),
      flag("freeze", "冻结缓存", false),
    ],
  ],
  [
    "Cache Select",
    "从连接的Cache/Time Machine缓冲中选择历史帧。",
    [n("offset", "向前偏移帧", 10, 0, 119, 1)],
  ],
  [
    "Channel Mix",
    "使用4×4颜色矩阵混合RGBA通道。",
    [t("matrix", "RGBA矩阵JSON", "[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]")],
  ],
  [
    "Convolve",
    "对图像执行可编辑的3×3或5×5卷积核。",
    [
      t("kernel", "卷积核JSON", "[[0,-1,0],[-1,5,-1],[0,-1,0]]"),
      n("divisor", "除数", 1, -100, 100),
      n("bias", "偏置", 0, -1, 1),
    ],
  ],
  [
    "Corner Pin",
    "通过四角控制计算真实投影单应矩阵。坐标归一化为0–1。",
    [
      t(
        "corners",
        "左上/右上/右下/左下 JSON",
        "[[0.1,0.15],[0.9,0],[1,1],[0,0.9]]",
      ),
    ],
  ],
  [
    "Function",
    "逐颜色通道计算数学函数。",
    [
      c("operation", "函数", "sin", [
        "sin",
        "cos",
        "abs",
        "sqrt",
        "square",
        "exp",
        "log",
        "invert",
      ]),
      n("scale", "输入倍率", 1, -10, 10),
      n("offset", "输入偏移", 0, -1, 1),
    ],
  ],
  [
    "GLSL",
    "实际编译并执行WebGL2 GLSL ES 3.00片段着色器，暴露uInput0/uInput1/uTime/uResolution/uMod；不是TD完整shader ABI。",
    [t("code", "片段着色器", shader)],
  ],
  [
    "GLSL Multi",
    "实际双输入WebGL2着色器；共享GLSL节点uniform约定，可从两张图采样。",
    [
      t(
        "code",
        "片段着色器",
        shader.replace(
          "mix(waves,source.rgb,source.a*0.65)",
          "mix(source.rgb,texture(uInput1,vUV).rgb,0.5)",
        ),
      ),
    ],
    true,
  ],
  ["HSV to RGB", "按H/S/V图像通道转换为RGB。", []],
  ["RGB to HSV", "将RGB图像编码为H/S/V通道。", []],
  [
    "Layout",
    "把两张图排列为水平、垂直或画中画。",
    [
      c("mode", "排列", "horizontal", ["horizontal", "vertical", "inset"]),
      n("gap", "间距像素", 8, 0, 80),
    ],
    true,
  ],
  [
    "Limit",
    "对归一化颜色执行Clamp、Wrap或Mirror区间限制。",
    [
      c("mode", "限制", "clamp", ["clamp", "wrap", "mirror"]),
      n("min", "下界", 0.15, 0, 1),
      n("max", "上界", 0.85, 0, 1),
    ],
  ],
  [
    "Lookup",
    "将源亮度作为第二张图的横坐标，查找渐变颜色。",
    [n("row", "查找行", 0.5, 0, 1)],
    true,
  ],
  [
    "Luma Blur",
    "用第二张图亮度控制局部模糊半径，采用积分图计算可变方框滤波。",
    [n("radius", "最大半径", 12, 0, 40, 1)],
    true,
  ],
  [
    "Luma Level",
    "只调整亮度并尽量保持色相，支持亮度增益和偏移。",
    [n("gain", "亮度倍率", 1.5, 0, 5), n("offset", "亮度偏移", 0, -1, 1)],
  ],
  [
    "Math",
    "对两张图像执行逐RGB通道数学运算，保留源alpha。",
    [
      c("operation", "运算", "add", [
        "add",
        "subtract",
        "multiply",
        "divide",
        "minimum",
        "maximum",
      ]),
      n("gain", "输出倍率", 1, -5, 5),
      n("offset", "输出偏移", 0, -1, 1),
    ],
    true,
  ],
  [
    "Normal Map",
    "从高度图计算有限差分法线并编码为RGB。",
    [n("strength", "高度强度", 5, 0, 30)],
  ],
  [
    "Optical Flow",
    "从前后真实图像估计局部Lucas–Kanade光流，RG编码方向、B编码幅度；CPU低分辨率子集。",
    [
      n("scale", "运动显示倍率", 0.1, 0.001, 2),
      n("window", "局部窗口半径", 2, 1, 5, 1),
    ],
  ],
  [
    "Pack",
    "把两图打包为左右、上下或RG/BA通道，保留采样结果。",
    [c("mode", "打包", "rgba", ["rgba", "horizontal", "vertical"])],
    true,
  ],
  [
    "Point Transform",
    "将RGB作为归一化XYZ点纹理做旋转、缩放和平移；8位纹理子集。",
    [
      n("angle", "Z旋转角度", 30, -180, 180),
      n("scale", "缩放", 1, -10, 10),
      n("x", "X偏移", 0, -1, 1),
      n("y", "Y偏移", 0, -1, 1),
      n("z", "Z偏移", 0, -1, 1),
    ],
  ],
  [
    "Projection",
    "在平面/球面/柱面投影之间重采样图像。",
    [
      c("mode", "投影", "sphere", ["sphere", "cylinder", "plane"]),
      n("rotation", "水平旋转", 0, -1, 1),
    ],
  ],
  [
    "Remap",
    "第二张图RG通道提供源图归一化UV坐标，实现任意图像重映射。",
    [flag("wrap", "循环边界", false)],
    true,
  ],
  [
    "Resolution",
    "实际创建指定像素尺寸的输出画布，可选最近邻或平滑重采样。",
    [
      n("width", "宽度", 320, 1, 2048, 1),
      n("height", "高度", 180, 1, 2048, 1),
      flag("smooth", "平滑采样", true),
    ],
  ],
  [
    "Slope",
    "计算图像亮度的空间X/Y差分或梯度幅度。",
    [
      c("mode", "梯度", "magnitude", ["x", "y", "magnitude"]),
      n("strength", "倍率", 3, 0, 30),
    ],
  ],
  [
    "Spectrum",
    "对图像亮度执行二维FFT（不是音频频谱）。输出幅度/相位，可连接反变换恢复图像。",
    [
      c("mode", "变换", "magnitude", ["magnitude", "phase", "inverse"]),
      c("size", "FFT尺寸", "64", ["32", "64", "128", "256"]),
      n("gain", "频谱显示倍率", 0.18, 0.001, 2),
    ],
  ],
  [
    "SSAO",
    "对深度灰度图执行屏幕空间邻域遮蔽估计；输入必须是线性深度，非完整场景G-buffer管线。",
    [
      n("radius", "采样半径", 5, 1, 30, 1),
      n("strength", "遮蔽强度", 2, 0, 10),
      n("bias", "深度偏置", 0.02, 0, 0.5),
    ],
  ],
  [
    "Subtract",
    "逐RGB通道减去第二张图，保留源alpha。",
    [n("gain", "倍率", 1, 0, 5)],
    true,
  ],
  [
    "Texture 3D",
    "缓存多个图像切片并以Z轴线性采样组成体纹理的切片视图；CPU切片容器，不是GPU sampler3D。",
    [n("slices", "切片数", 16, 1, 64, 1), n("z", "采样Z", 0.5, 0, 1)],
  ],
  [
    "Time Machine",
    "按第二张图亮度逐像素选择历史帧，形成时间位移。",
    [
      n("frames", "历史帧数", 30, 2, 120, 1),
      n("amount", "时间偏移比例", 1, 0, 1),
    ],
    true,
  ],
  ["Under", "将第一张图放在第二张图下方，使用真实alpha合成。", [], true],
  ["Outside", "保留第一张图位于第二张图alpha以外的部分。", [], true],
  [
    "Depth",
    "把输入亮度视作深度样本，按near/far线性化并显示；不伪造三维场景深度。",
    [n("near", "近裁面", 0.1, 0.001, 10), n("far", "远裁面", 100, 0.1, 1000)],
  ],
  [
    "PreFilter Map",
    "为环境图生成一排不同粗糙度的模糊预过滤层；CPU近似环境预滤波，不是GGX重要性采样。",
    [
      n("levels", "粗糙度级数", 6, 2, 12, 1),
      n("radius", "最大模糊", 20, 0, 100),
    ],
  ],
  [
    "Cube Map",
    "将经纬度环境图重采样为六面立方体横向图集；2D图集，不冒充GPU cubemap对象。",
    [n("rotation", "经度偏移", 0, -1, 1)],
  ],
  [
    "Point File In",
    "解析CSV/空格XYZ点列表并编码为RGB点纹理；文本参数可从文件DAT上游接入扩展。",
    [t("points", "XYZ点列表", "0.1,0.2,0.3\n0.5,0.8,0.4\n0.9,0.3,0.7")],
  ],
  [
    "Point File Select",
    "从点纹理中按起始索引和数量抽取点。",
    [
      n("start", "起始点", 0, 0, 65535, 1),
      n("count", "点数量", 16, 1, 65536, 1),
    ],
  ],
];
defs.push([
  "CHOP to",
  "把多通道样本写入实际图像像素：每一行对应一个通道、列对应样本。",
  [n("min", "最小值", 0, -100, 100), n("max", "最大值", 1, -100, 100)],
]);
defs.push(
  [
    "Render Pass",
    "复用已渲染场景和相机，实际重新渲染颜色/深度/法线pass；当前不支持原软件共享FBO中新几何叠加。",
    [c("pass", "渲染通道", "color", ["color", "depth", "normal"])],
  ],
  [
    "Render Select",
    "读取已渲染场景的颜色/深度/法线附件；当前单相机，不包含多视角或深度剥离层。",
    [c("pass", "附件", "depth", ["color", "depth", "normal"])],
  ],
  [
    "Import Select",
    "读取已经导入三维模型的真实材质贴图。模型格式由导入器决定，不是普通节点引用。",
    [
      t("parent", "导入节点路径", ""),
      c("texture", "材质贴图", "map", [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "emissiveMap",
        "alphaMap",
        "aoMap",
      ]),
    ],
  ],
  [
    "OP Viewer",
    "把指定节点的实际图像、通道曲线或表格文本绘制到TOP。三维预览需要渲染器提供viewer。",
    [t("source", "节点路径", ""), n("font_size", "文字大小", 14, 8, 48, 1)],
  ],
);
export const referenceTopCatalog: NodeSpec[] = defs.map(
  ([english, description, params, two]) => ({
    type: `ref_top_${english.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    label: english,
    english,
    family: "TOP",
    description,
    params,
    inputs: ["Import Select", "OP Viewer"].includes(english)
      ? []
      : english === "Point File In"
        ? [{ id: "in", kind: "DAT", label: "点列表 CSV（可选）" }]
        : english === "CHOP to"
          ? [{ id: "in", kind: "CHOP", label: "多通道样本" }]
          : [image, ...(two ? [second] : [])],
    outputs: [{ id: "out", kind: "TOP", label: "图像" }],
  }),
);
