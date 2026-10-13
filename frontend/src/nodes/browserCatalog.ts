import type { NodeSpec, Param } from "../types";
const num = (
  key: string,
  label: string,
  value = 0,
  min = 0,
  max = 127,
): Param => ({ key, label, type: "number", default: value, min, max, step: 1 });
const txt = (key: string, label: string, value = ""): Param => ({
  key,
  label,
  type: "text",
  default: value,
});
const entries = [
  ["keyboard_in", "Keyboard In", "CHOP", "键盘输入"],
  ["mouse_in", "Mouse In", "CHOP", "鼠标输入"],
  ["joystick", "Joystick", "CHOP", "游戏手柄"],
  ["multi_touch_in", "Multi Touch In", "DAT", "多点触控"],
  ["midi_in", "MIDI In", "CHOP", "MIDI 输入"],
  ["midi_event", "MIDI Event", "DAT", "MIDI 事件"],
  ["midi_out", "MIDI Out", "CHOP", "MIDI 输出"],
  ["panel", "Panel", "CHOP", "面板值"],
  ["video_device_in", "Video Device In", "TOP", "摄像头"],
  ["screen_grab", "Screen Grab", "TOP", "屏幕捕获"],
  ["audio_device_in", "Audio Device In", "CHOP", "麦克风采样"],
];
export const browserCatalog: NodeSpec[] = entries.map(
  ([id, name, family, label]) => ({
    type: "browser_" + id,
    label,
    english: name + " " + family,
    family,
    description:
      id === "video_device_in" || id === "screen_grab"
        ? "点击参数面板中的启用采集，按浏览器提示选择设备。可使用 HTTPS 或 localhost；关闭节点后自动释放设备。"
        : id.startsWith("midi")
          ? "使用 Web MIDI API。点击启用 MIDI 后选择设备索引；输出需要开启 enabled。浏览器和系统必须支持 MIDI。"
          : "真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。",
    inputs:
      id === "midi_out" ? [{ id: "in", kind: "CHOP", label: "音符" }] : [],
    outputs: [{ id: "out", kind: family, label: "输出" }],
    params: [
      txt("keys", "键码（空格分隔）", "Space ArrowLeft ArrowRight"),
      txt("path", "面板路径"),
      num("device", "设备编号", 0, 0, 32),
      num("channel", "MIDI 通道", 0, 0, 15),
      num("velocity", "MIDI 力度", 100),
      {
        key: "enabled",
        label: "启用 MIDI 输出",
        type: "boolean",
        default: false,
      },
    ],
    reference: {
      family,
      name,
      level: "subset",
      note: "浏览器权限/API；不是原生专用设备驱动。",
    },
  }),
);

const more = [
  ["midi_map", "MIDI In Map", "CHOP", "MIDI 映射"],
  ["tablet", "Tablet", "CHOP", "数位笔输入"],
  ["keyboard_dat", "Keyboard In", "DAT", "键盘事件表"],
  ["midi_dat", "MIDI In", "DAT", "MIDI 事件表"],
  ["audio_devices", "Audio Devices", "DAT", "音频设备列表"],
  ["video_devices", "Video Devices", "DAT", "视频设备列表"],
  ["monitors", "Monitors", "DAT", "屏幕信息"],
];
for (const [id, name, family, label] of more)
  browserCatalog.push({
    type: "browser_" + id,
    label,
    english: name,
    family,
    description:
      id === "tablet"
        ? "使用 PointerEvent 的真实压力、倾角、旋转及坐标；普通鼠标不产生数位笔倾角。"
        : id.includes("devices")
          ? "列举浏览器可访问的媒体设备。设备名称是否可见取决于浏览器媒体权限。"
          : "读取真实浏览器事件或当前屏幕信息；MIDI需要显式启用，Monitors目前报告当前显示器。",
    inputs: [],
    outputs: [{ id: "out", kind: family, label: "输出" }],
    params: [
      txt("mapping", "MIDI 映射 JSON", '{"volume":[176,7],"note":[144,60]}'),
    ],
    reference: {
      family,
      name,
      level: "subset",
      note: "Web MIDI / PointerEvent / enumerateDevices / Screen API；不等于原生系统所有设备能力。",
    },
  });
