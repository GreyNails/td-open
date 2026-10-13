import type { NodeSpec, Param, Port } from "../types";
const port = (id: string, kind = "any"): Port => ({ id, kind, label: id });
const text = (key: string, label: string, value = ""): Param => ({
  key,
  label,
  type: "text",
  default: value,
});
const number = (
  key: string,
  label: string,
  value = 0,
  min = -10000,
  max = 10000,
): Param => ({
  key,
  label,
  type: "number",
  default: value,
  min,
  max,
  step: 0.01,
});
const common = [
  text("text", "文字", "Hello TD Open"),
  number("value", "值", 0, 0, 1),
  text("items", "列表内容（每行一项）", "One\nTwo\nThree"),
  { key: "color", label: "颜色", type: "color", default: "#a995fa" } as Param,
];
const uiNames = [
  ["button", "Button", "按钮"],
  ["field", "Field", "输入框"],
  ["list", "List", "列表"],
  ["op_viewer", "OP Viewer", "节点查看器"],
  ["parameter", "Parameter", "参数面板"],
  ["slider", "Slider", "滑杆"],
  ["table", "Table", "表格面板"],
  ["text", "Text", "文本面板"],
  ["time", "Time", "时间控制"],
  ["animation", "Animation", "动画曲线"],
  ["annotate", "Annotate", "注释"],
  ["window", "Window", "输出窗口"],
  ["select", "Select", "选择面板"],
  ["replicator", "Replicator", "复制布局"],
];
export const componentCatalog: NodeSpec[] = [
  ...[
    ["base", "Base", "基础组件"],
    ["engine", "Engine", "嵌套引擎"],
    ["container", "Container", "容器"],
    ["widget", "Widget", "控件组件"],
  ].map(([id, name, label]): NodeSpec => ({
    type: id + "_comp",
    label,
    english: name + " COMP",
    family: "COMP",
    description:
      "包含独立的内部节点网络。双击进入；使用 In / Out 节点按编号连接父网络，支持嵌套、保存和撤销。Engine 在当前进程执行，不等同于 TouchEngine 进程隔离。",
    inputs: [1, 2, 3, 4].map((i) => port(i === 1 ? "in" : "in" + i)),
    outputs: [1, 2, 3, 4].map((i) => port(i === 1 ? "out" : "out" + i)),
    params: [],
    reference: {
      family: "COMP",
      name,
      level: "subset",
      note: "嵌套网络；目前每个组件最多四个外部输入/输出，单进程执行。",
    },
  })),
  ...uiNames.map(([id, name, label]): NodeSpec => ({
    type: id + "_comp",
    label,
    english: name + " COMP",
    family: "COMP",
    description:
      "可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。",
    inputs: [port("in")],
    outputs: [port("out", "TOP")],
    params: [
      ...common,
      number("count", "副本数", 4, 1, 100),
      text("path", "引用节点路径"),
    ],
    reference: {
      family: "COMP",
      name,
      level: "subset",
      note: "浏览器控件与 Canvas 面板；不包含原生桌面窗口或 TD 扩展对象。",
    },
  })),
  ...["TOP", "CHOP", "SOP", "DAT"].flatMap((f) => [
    {
      type: "network_in_" + f.toLowerCase(),
      label: f + " 组件输入",
      english: "In " + f,
      family: f,
      description:
        "从所属组件的指定编号输入端口读取数据。根网络无输入时返回空值。",
      inputs: [],
      outputs: [port("out", f)],
      params: [number("index", "端口编号", 1, 1, 4)],
      reference: { family: f, name: "In", level: "native" as const },
    },
    {
      type: "network_out_" + f.toLowerCase(),
      label: f + " 组件输出",
      english: "Out " + f,
      family: f,
      description: "将内部网络结果输出到组件外部的指定端口。",
      inputs: [port("in", f)],
      outputs: [port("out", f)],
      params: [number("index", "端口编号", 1, 1, 4)],
      reference: { family: f, name: "Out", level: "native" as const },
    },
    {
      type: "operator_select_" + f.toLowerCase(),
      label: f + " 路径引用",
      english: "Select " + f,
      family: f,
      description:
        "通过节点 ID 路径读取算子输出。支持 / 根路径、../ 父级路径以及组件内部路径。循环引用会显示运行错误。",
      inputs: [],
      outputs: [port("out", f)],
      params: [text("path", "节点路径")],
      reference: {
        family: f,
        name: "Select",
        level: "subset" as const,
        note: "算子路径引用；不同于通道或表格内部筛选。",
      },
    },
  ]),
];

const clockSpec = componentCatalog.find((s) => s.type === "time_comp")!;
Object.assign(clockSpec, {
  description:
    "为内部节点网络提供独立时间域，支持速率、偏移和循环。双击进入，内部 In/Out 与 Base 相同。",
  inputs: [port("in")],
  outputs: [port("out")],
  params: [
    number("rate", "播放速率", 1, -16, 16),
    number("offset", "起始偏移秒", 0),
    number("duration", "循环时长秒", 10, 0.001, 36000),
    { key: "loop", label: "循环", type: "boolean", default: false },
  ],
  reference: {
    family: "COMP",
    name: "Time",
    level: "subset",
    note: "嵌套本地时间域；未实现TD完整时间码同步界面。",
  },
});
const animation = componentCatalog.find((s) => s.type === "animation_comp")!;
Object.assign(animation, {
  description:
    "真正的命名关键帧动画曲线。JSON格式为通道名到 [秒,值] 序列，支持线性、平滑和保持插值。输出CHOP采样数据。",
  inputs: [],
  outputs: [port("out", "CHOP")],
  params: [
    text(
      "keys",
      "通道关键帧 JSON",
      '{"x":[[0,0],[1,1],[2,0]],"y":[[0,1],[1,0],[2,1]]}',
    ),
    {
      key: "mode",
      label: "插值",
      type: "select",
      default: "linear",
      options: ["linear", "smooth", "hold"],
    },
    number("samples", "样本数量", 128, 1, 4096),
    number("sample_rate", "采样率", 60, 1, 192000),
    { key: "loop", label: "循环", type: "boolean", default: true },
  ],
  reference: {
    family: "COMP",
    name: "Animation",
    level: "subset",
    note: "可执行关键帧通道；尚无TD拖拽关键帧曲线编辑器。",
  },
});
const replica = componentCatalog.find((s) => s.type === "replicator_comp")!;
Object.assign(replica, {
  description:
    "按数量真正实例化内部TOP网络，独立执行每份副本并平铺输出。双击编辑模板，用 Replica Index CHOP 驱动每份副本差异。",
  inputs: [port("in")],
  params: [number("count", "副本数", 4, 1, 16)],
  reference: {
    family: "COMP",
    name: "Replicator",
    level: "subset",
    note: "独立TOP子网络实例与编号；未实现DAT行模板回调。",
  },
});
componentCatalog.push({
  type: "replica_index_chop",
  label: "副本编号",
  english: "Replica Index",
  family: "CHOP",
  description: "读取所属Replicator实例的编号，从0开始，可连接GLSL的mod输入。",
  inputs: [],
  outputs: [port("out", "CHOP")],
  params: [],
});
