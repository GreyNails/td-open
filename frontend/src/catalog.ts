import type { GraphNode, NodeSpec, Param, Port, Project } from "./types";
import { decorateReferenceProject } from "./referenceTemplates";
import { mediaCatalog } from "./nodes/mediaCatalog";
import { referenceTopCatalog } from "./nodes/referenceTopCatalog";
import { compatibilityTopCatalog } from "./nodes/compatibilityTopCatalog";
import { browserOutputCatalog } from "./nodes/browserOutputCatalog";
import { pythonCatalog } from "./nodes/pythonCatalog";
import { channelDataCatalog } from "./nodes/channelDataCatalog";
import {
  geometryV2Catalog,
  materialCatalog,
  sceneCatalog,
} from "./nodes/geometryV2Catalog";
import { ioCatalog } from "./nodes/ioCatalog";
import { browserCatalog } from "./nodes/browserCatalog";
import { componentCatalog } from "./nodes/componentCatalog";
import { networkTypes, emptyNetwork } from "./networks";
import { uid } from "./types";
import { visualCatalog } from "./nodes/visualCatalog";
import { dataCatalog } from "./nodes/dataCatalog";
import { advancedVisualCatalog } from "./nodes/advancedVisualCatalog";
import { advancedDataCatalog } from "./nodes/advancedDataCatalog";
import { templateById } from "./templates";
const port = (id: string, kind = "TOP", label = "画面"): Port => ({
  id,
  kind,
  label,
});
const num = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step = 0.01,
  hint = "",
): Param => ({
  key,
  label,
  type: "number",
  default: def,
  min,
  max,
  step,
  hint,
});
const color = (key: string, label: string, def: string): Param => ({
  key,
  label,
  type: "color",
  default: def,
});
const txt = (key: string, label: string, def = ""): Param => ({
  key,
  label,
  type: "text",
  default: def,
});
const select = (
  key: string,
  label: string,
  def: string,
  options: string[],
): Param => ({ key, label, type: "select", default: def, options });
const input = port("in"),
  mod = port("mod", "CHOP", "调制"),
  out = port("out");
function spec(
  type: string,
  label: string,
  english: string,
  family: string,
  description: string,
  params: Param[],
  inputs: Port[] = [],
  outputs: Port[] = [out],
): NodeSpec {
  return { type, label, english, family, description, params, inputs, outputs };
}
export const catalog: NodeSpec[] = [
  spec(
    "noise",
    "流动噪声",
    "Noise",
    "TOP",
    "生成有机流动的纹理。调节尺度改变纹理大小，速度控制流动。",
    [
      num("scale", "纹理尺度", 3, 0.2, 12),
      num("speed", "流动速度", 0.25, 0, 2),
      num("detail", "细节层次", 4, 1, 6, 1),
      num("seed", "随机种子", 1, 0, 100, 1),
    ],
    [mod],
  ),
  spec(
    "ramp",
    "渐变",
    "Ramp",
    "TOP",
    "用两种颜色生成平滑渐变，是很多视觉效果的起点。",
    [
      color("color1", "起始颜色", "#9c6dff"),
      color("color2", "结束颜色", "#ff9055"),
      num("angle", "渐变角度", 45, 0, 360, 1),
    ],
  ),
  spec(
    "shape",
    "形状",
    "Shape",
    "TOP",
    "生成圆形或方形，用于制作图案和遮罩。",
    [
      select("shape", "形状", "circle", ["circle", "rectangle"]),
      num("size", "大小", 0.35, 0.05, 1),
      color("color", "颜色", "#b696ff"),
    ],
  ),
  spec(
    "media",
    "图片 / 视频",
    "Media",
    "TOP",
    "从本地导入素材，或使用可访问的素材地址。",
    [
      txt("url", "素材地址"),
      select("fit", "缩放方式", "cover", ["cover", "contain"]),
    ],
  ),
  spec(
    "color",
    "色彩调整",
    "Color",
    "TOP",
    "调整输入画面的色相、饱和度和亮度。",
    [
      num("hue", "色相偏移", 0, -180, 180, 1),
      num("saturation", "饱和度", 1.2, 0, 3),
      num("brightness", "亮度", 1.1, 0, 3),
    ],
    [input],
  ),
  spec(
    "blur",
    "柔光",
    "Bloom",
    "TOP",
    "为输入画面增加模糊和柔和的光晕。",
    [
      num("radius", "模糊半径", 8, 0, 40, 1),
      num("glow", "光晕强度", 0.5, 0, 2),
    ],
    [input],
  ),
  spec(
    "transform",
    "变换",
    "Transform",
    "TOP",
    "旋转、缩放、移动输入画面。调制信号会影响旋转。",
    [
      num("rotate", "旋转", 0, -180, 180, 1),
      num("scale", "缩放", 1, 0.1, 3),
      num("x", "水平位移", 0, -1, 1),
      num("y", "垂直位移", 0, -1, 1),
    ],
    [input, mod],
  ),
  spec(
    "composite",
    "画面合成",
    "Composite",
    "TOP",
    "把两个输入画面以指定方式混合。",
    [
      select("mode", "混合模式", "screen", [
        "screen",
        "source-over",
        "multiply",
        "difference",
        "lighter",
      ]),
      num("opacity", "第二层透明度", 0.7, 0, 1),
    ],
    [input, port("in2", "TOP", "第二层")],
  ),
  spec(
    "text",
    "文字画面",
    "Text",
    "TOP",
    "将文字绘制成画面，可与纹理和视频合成。",
    [
      txt("text", "文字内容", "HELLO, FLOW"),
      num("size", "文字大小", 64, 12, 180, 1),
      color("color", "文字颜色", "#ffffff"),
    ],
    [port("in", "DAT", "文字")],
  ),
  spec(
    "lfo",
    "波形信号",
    "LFO",
    "CHOP",
    "生成周期变化的数值。连接到调制端口，让画面随时间变化。",
    [
      select("wave", "波形", "sine", ["sine", "triangle", "square", "saw"]),
      num("phase", "相位", 0, -1, 1),
      num("frequency", "频率", 0.3, 0.01, 5),
      num("amplitude", "振幅", 1, 0, 5),
      num("offset", "偏移", 0, -5, 5),
    ],
    [],
    [port("out", "CHOP", "数值")],
  ),
  spec(
    "constant",
    "常量",
    "Constant",
    "CHOP",
    "输出一个固定数值，用于参数控制。",
    [num("value", "数值", 1, -10, 10)],
    [],
    [port("out", "CHOP", "数值")],
  ),
  spec(
    "math",
    "数值运算",
    "Math",
    "CHOP",
    "两路信号执行四则运算、极值或范围限制；第二路未连接时使用运算值。",
    [
      select("operation", "运算", "multiply", [
        "multiply",
        "add",
        "subtract",
        "divide",
        "min",
        "max",
        "clamp",
      ]),
      num("value", "运算值", 1, -10, 10),
    ],
    [port("in", "CHOP", "数值"), port("in2", "CHOP", "第二路")],
    [port("out", "CHOP", "数值")],
  ),
  spec(
    "audio",
    "音频输入",
    "Audio In",
    "CHOP",
    "读取麦克风音量与频谱。点击工具栏麦克风按钮授权后生效。",
    [num("gain", "增益", 1, 0, 5), txt("url", "音频素材地址")],
    [],
    [port("out", "CHOP", "音量")],
  ),
  spec(
    "spectrum",
    "频谱画面",
    "Spectrum",
    "TOP",
    "将音频信号绘制成可视化频谱。",
    [num("bars", "频段数量", 64, 8, 128, 1)],
    [port("in", "CHOP", "音频")],
  ),
  spec(
    "particles",
    "粒子星环",
    "Particles",
    "TOP",
    "生成旋转的空间粒子环。输入音频或波形可驱动环的起伏。",
    [
      num("count", "粒子数量", 1600, 100, 6000, 100),
      num("speed", "旋转速度", 0.3, 0, 2),
      num("size", "粒子大小", 2, 0.5, 6, 0.1),
      color("color", "粒子颜色", "#c1a2ff"),
      num("spread", "空间范围", 1, 0.2, 2),
    ],
    [mod],
  ),
  spec(
    "geometry",
    "几何体",
    "Geometry",
    "SOP",
    "创建真正的三维网格。连接到 3D 渲染节点得到画面。",
    [
      select("shape", "几何形状", "torus", ["torus", "sphere", "box", "knot"]),
      num("detail", "细分精度", 32, 8, 80, 1),
    ],
    [],
    [port("out", "SOP", "几何体")],
  ),
  spec(
    "render",
    "3D 渲染",
    "Render 3D",
    "TOP",
    "用 WebGL 渲染几何体。支持线框、灯光和自动旋转。",
    [
      color("color", "材质颜色", "#a888ff"),
      { key: "wireframe", label: "线框模式", type: "boolean", default: true },
      num("speed", "旋转速度", 0.3, 0, 2),
    ],
    [port("in", "SOP", "几何体"), mod],
  ),
  ...(["image", "music", "3d", "text"] as const).map((kind) =>
    spec(
      "ai_" + kind,
      { image: "AI 图片", music: "AI 音乐", "3d": "AI 三维", text: "AI 文本" }[
        kind
      ],
      "AI " + kind.toUpperCase(),
      "AI",
      "选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。",
      [
        txt("prompt", "提示词"),
        txt("provider_id", "服务 ID"),
        txt("result_url", "生成资源地址"),
        txt("result_text", "生成文字"),
      ],
      [],
      [
        port(
          "out",
          { image: "TOP", music: "CHOP", "3d": "SOP", text: "DAT" }[kind],
          "生成结果",
        ),
      ],
    ),
  ),
  spec(
    "mcp_tool",
    "MCP 工具",
    "MCP Tool",
    "AI",
    "调用已连接 MCP 服务器提供的工具。执行前请确认工具用途。",
    [
      txt("server_id", "服务器 ID"),
      txt("tool", "工具名称"),
      txt("arguments", "参数 JSON", "{}"),
    ],
    [],
    [port("out", "DAT", "结果")],
  ),
  spec(
    "output",
    "画面输出",
    "Output",
    "OUT",
    "最终画面输出。实时预览和导出使用此节点的结果。",
    [],
    [input],
    [],
  ),
];
catalog.push(
  ...componentCatalog,
  ...browserCatalog,
  ...pythonCatalog,
  ...referenceTopCatalog,
  ...compatibilityTopCatalog,
  ...browserOutputCatalog,
  ...mediaCatalog,
  ...channelDataCatalog,
  ...geometryV2Catalog,
  ...materialCatalog,
  ...sceneCatalog,
  ...ioCatalog,
  ...visualCatalog,
  ...dataCatalog,
  ...advancedVisualCatalog,
  ...advancedDataCatalog,
);
for (const item of [
  ...channelDataCatalog,
  ...geometryV2Catalog,
  ...materialCatalog,
  ...sceneCatalog,
  ...referenceTopCatalog,
])
  item.reference ??= {
    family: item.family,
    name: item.english.replace(/ (TOP|SOP|CHOP|DAT|COMP|MAT)$/, ""),
    level: "subset",
    note: item.description,
  };
for (const shader of referenceTopCatalog.filter((n) =>
  ["ref_top_glsl", "ref_top_glsl_multi"].includes(n.type),
))
  if (!shader.inputs.some((p) => p.id === "mod"))
    shader.inputs.push({ id: "mod", kind: "CHOP", label: "调制信号" });
const glslPanel = referenceTopCatalog.find((n) => n.type === "ref_top_glsl");
if (glslPanel)
  catalog.push({
    ...glslPanel,
    type: "glsl_comp",
    label: "GLSL 面板",
    english: "GLSL",
    family: "COMP",
    reference: {
      family: "COMP",
      name: "GLSL",
      level: "subset",
      note: "WebGL2片元着色器面板；不实现TD整个面板绘制ABI。",
    },
  });
const renderSpec = catalog.find((n) => n.type === "render");
if (renderSpec) {
  renderSpec.inputs[0].kind = "any";
  renderSpec.reference = {
    family: "TOP",
    name: "Render",
    level: "subset",
    note: "Three.js WebGL 场景、可编辑相机/灯光/MAT 与颜色/深度/法线通道；不兼容原软件 GPU 管线、全部渲染参数或文件格式。",
  };
}
export const byType = Object.fromEntries(catalog.map((n) => [n.type, n]));
export const familyColors: Record<string, string> = {
  COMP: "#e59676",
  MAT: "#68cbd1",
  TOP: "#b29af7",
  CHOP: "#73cda8",
  SOP: "#74b9e8",
  DAT: "#e5bb6f",
  AI: "#e3a3de",
  OUT: "#b9ec8c",
};
export function makeNode(type: string, x = 0, y = 0): GraphNode {
  const s = byType[type];
  const id = uid(type);
  return {
    id,
    type,
    position: { x, y },
    data: {
      ...(networkTypes.has(type) ? { graph: emptyNetwork(id) } : {}),
      label: s.label,
      params: Object.fromEntries(s.params.map((p) => [p.key, p.default])),
    },
  };
}
export function preset(kind = "flow"): Project {
  const ns: GraphNode[] = [];
  const es: Project["edges"] = [];
  const add = (type: string, x: number, y: number, p = {}) => {
    const n = makeNode(type, x, y);
    n.data.params = { ...n.data.params, ...p };
    ns.push(n);
    return n;
  };
  const link = (a: GraphNode, b: GraphNode, targetHandle = "in") =>
    es.push({
      id: uid("edge"),
      source: a.id,
      target: b.id,
      sourceHandle: "out",
      targetHandle,
    });
  let name = "流光实验 · Flow study";
  const example = templateById[kind];
  if (example?.recipe) {
    name = example.name;
    const recipe = example.recipe;
    // Compute columns from graph dependencies, including branches declared later.
    const levels = recipe.nodes.map(() => 0);
    for (let pass = 0; pass < recipe.nodes.length; pass++) {
      let changed = false;
      for (const [from, to] of recipe.edges) {
        if (levels[to] < levels[from] + 1) {
          levels[to] = levels[from] + 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    const rows = new Map<number, number>();
    recipe.nodes.forEach((item, i) => {
      const [type, params] = typeof item === "string" ? [item, {}] : item;
      const row = rows.get(levels[i]) ?? 0;
      rows.set(levels[i], row + 1);
      add(type, levels[i] * 245, row * 205, params);
    });
    for (const [from, to, handle] of recipe.edges)
      link(ns[from], ns[to], handle);
  }
  if (kind === "flow") {
    const n = add("noise", 0, 25);
    const c = add("color", 245, 25);
    const b = add("blur", 490, 25, { radius: 6, glow: 0.35 });
    const o = add("output", 735, 25);
    const l = add("lfo", 0, 245, { frequency: 0.12, amplitude: 0.4 });
    link(n, c);
    link(c, b);
    link(b, o);
    link(l, n, "mod");
  }
  if (kind === "particles") {
    name = "声音的形状 · Sound orbit";
    const p = add("particles", 245, 25);
    const a = add("audio", 0, 130);
    const b = add("blur", 490, 25, { radius: 5, glow: 0.7 });
    const o = add("output", 735, 25);
    link(a, p, "mod");
    link(p, b);
    link(b, o);
  }
  if (kind === "3d") {
    name = "空间练习 · Wire sculpture";
    const g = add("geometry", 0, 25, { shape: "knot" });
    const r = add("render", 245, 25);
    const b = add("blur", 490, 25, { radius: 4, glow: 0.35 });
    const o = add("output", 735, 25);
    link(g, r);
    link(r, b);
    link(b, o);
  }
  if (kind === "ai") {
    name = "想象力画布 · AI canvas";
    const a = add("ai_image", 0, 25, {
      prompt:
        "A surreal lavender landscape, flowing liquid metal, soft cinematic light",
    });
    const c = add("color", 245, 25);
    const o = add("output", 490, 25);
    link(a, c);
    link(c, o);
  }
  if (kind === "kaleidoscope") {
    name = "万花筒与反馈 · Kaleidoscope trails";
    const checker = add("checkerboard", 0, 0);
    const rotate = add("rotate", 240, 0, { speed: 0.03 });
    const kaleido = add("kaleidoscope", 480, 0);
    const feedback = add("feedback", 720, 0);
    const output = add("output", 960, 0);
    link(checker, rotate);
    link(rotate, kaleido);
    link(kaleido, feedback);
    link(feedback, output);
  }
  if (kind === "geometry-lab") {
    name = "双物体空间 · Geometry lab";
    const box = add("box", 0, 0);
    const boxTransform = add("transform_sop", 240, 0, {
      x: -1,
      sx: 0.65,
      sy: 0.65,
      sz: 0.65,
      rz: 20,
    });
    const sphere = add("sphere", 0, 240);
    const sphereTransform = add("transform_sop", 240, 240, {
      x: 1,
      sx: 0.7,
      sy: 0.7,
      sz: 0.7,
    });
    const merge = add("merge_sop", 480, 120);
    const render = add("render", 720, 120, { speed: 0.15 });
    const output = add("output", 960, 120);
    link(box, boxTransform);
    link(sphere, sphereTransform);
    link(boxTransform, merge);
    link(sphereTransform, merge, "in2");
    link(merge, render);
    link(render, output);
  }
  if (kind === "data-driven") {
    name = "数据变成画面 · CSV to motion";
    const table = add("table_dat", 0, 220, {
      csv: "name,value\nangle,0.6",
      mode: "cell",
      row: 1,
      column: 1,
    });
    const number = add("dat_to_chop", 240, 220);
    const range = add("range", 480, 220, { out_max: 2 });
    const grid = add("grid", 240, 0);
    const rotate = add("rotate", 720, 0, { speed: 0 });
    const output = add("output", 960, 0);
    link(table, number);
    link(number, range);
    link(grid, rotate);
    link(range, rotate, "mod");
    link(rotate, output);
  }
  if (kind === "empty") {
    name = "未命名作品";
    add("output", 490, 25);
  }
  return decorateReferenceProject(
    {
      id: uid("project"),
      name,
      version: 1,
      nodes: ns,
      edges: es,
      settings: { preset: kind },
    },
    makeNode,
  );
}
export function connectionError(
  p: Project,
  source: string,
  target: string,
  sh = "out",
  th = "in",
): string | null {
  if (source === target) return "节点不能连接到自身";
  const s = p.nodes.find((n) => n.id === source),
    t = p.nodes.find((n) => n.id === target);
  if (!s || !t) return "节点不存在";
  const sp = byType[s.type]?.outputs.find((x) => x.id === sh),
    tp = byType[t.type]?.inputs.find((x) => x.id === th);
  if (!sp || !tp) return "接口不存在";
  if (sp.kind !== tp.kind && sp.kind !== "any" && tp.kind !== "any")
    return `${sp.kind} 无法直接连接到 ${tp.kind}，请选择对应的转换节点`;
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return p.edges.filter((e) => e.source === id).some((e) => visit(e.target));
  };
  return visit(target) ? "该连接会形成循环，当前引擎支持有向无环图" : null;
}
