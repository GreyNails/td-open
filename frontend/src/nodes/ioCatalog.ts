import type { NodeSpec, Param } from "../types";
import { ioDefinitions } from "./ioDefinitions";

const text = (key: string, label: string, value = ""): Param => ({
  key,
  label,
  type: "text",
  default: value,
});
const number = (
  key: string,
  label: string,
  value: number,
  min = 0,
  max = 65535,
): Param => ({ key, label, type: "number", default: value, min, max, step: 1 });
const select = (
  key: string,
  label: string,
  value: string,
  options: string[],
): Param => ({ key, label, type: "select", default: value, options });
export const ioReferenceKeys = new Set(
  ioDefinitions.map((d) => `${d.family}:${d.english}`),
);
export const ioCatalog: NodeSpec[] = ioDefinitions.map((d) => {
  const isOut = d.direction === "out",
    file = d.protocol.startsWith("file_") || d.protocol === "folder";
  const params: Param[] = [
    {
      key: "enabled",
      label: "启用连接 / 文件操作",
      type: "boolean",
      default: false,
    },
    number("interval", "更新间隔 ms", file ? 500 : 100, 30, 60000),
  ];
  let description = "";
  if (file) {
    params.push(
      text(
        "path",
        "相对 data/io 路径",
        d.protocol === "folder" ? "" : "example.json",
      ),
    );
    if (isOut)
      params.push({
        key: "append",
        label: "追加写入",
        type: "boolean",
        default: false,
      });
    description =
      d.protocol === "folder"
        ? "读取项目 data/io 内的目录、文件大小和修改时间。"
        : `在项目 data/io 内${isOut ? "写入" : "读取"} UTF-8 / JSON 数据；CHOP 使用完整多通道 JSON 格式。`;
  } else if (d.protocol === "http") {
    params.push(
      text("url", "HTTP URL", "http://127.0.0.1:8765/api/health"),
      select("method", "请求方法", "GET", [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
      ]),
      text("headers", "请求头 JSON", "{}"),
    );
    description =
      "发出真实 HTTP 请求，输出状态码、响应头与 JSON / 文本响应。启用后按间隔刷新。";
  } else if (d.protocol === "webserver") {
    params.push(text("channel", "HTTP 路径名称", "example"));
    description =
      "在当前服务 /api/io/web/{名称} 提供 JSON GET / POST 端点；收到 POST 后更新节点，输入可发布到 GET 响应。";
  } else if (["bridge", "sharedmem"].includes(d.protocol)) {
    params.push(
      text(
        "channel",
        d.protocol === "sharedmem" ? "共享内存名称" : "桥接通道",
        d.adapter || "td-open",
      ),
    );
    description =
      d.protocol === "sharedmem"
        ? "通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。"
        : "通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。";
  } else if (d.protocol === "serial") {
    params.push(
      text("device", "POSIX 串口设备", "/dev/ttyUSB0"),
      number("baud", "波特率", 115200, 50, 4000000),
    );
    description =
      "真实 POSIX 串口 8N1 读写（Linux / macOS）；需要设备权限，按接收字节块输出。";
  } else {
    params.push(
      select(
        "mode",
        "连接方式",
        isOut || d.protocol === "mqtt" ? "connect" : "listen",
        ["listen", "connect"],
      ),
    );
    params.push(
      text("host", "主机 / 监听地址", "127.0.0.1"),
      number(
        "port",
        "端口",
        d.protocol === "artnet"
          ? 6454
          : d.protocol === "mqtt"
            ? 1883
            : d.protocol === "osc"
              ? 9000
              : 9001,
      ),
    );
    if (d.protocol === "tcp")
      params.push(
        select("framing", "消息边界", "newline", ["newline", "length", "raw"]),
      );
    if (d.protocol === "websocket")
      params.push(text("url", "连接 URL", "ws://127.0.0.1:9001"));
    if (d.protocol === "mqtt")
      params.push(
        text("topic", "订阅主题", "td-open/#"),
        text("publish_topic", "发布主题", "td-open/value"),
      );
    if (d.protocol === "osc")
      params.push(
        text(
          "address",
          "OSC 地址",
          d.english === "TUIO In" ? "/tuio/2Dcur" : "/td-open",
        ),
      );
    if (d.protocol === "artnet")
      params.push(number("universe", "DMX Universe", 0, 0, 32767));
    description =
      (
        {
          udp: "真实 UDP 文本 / JSON 数据报收发。",
          osc: "真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。",
          artnet: "真实 Art-Net ArtDMX 数据报，1–512 通道，数值范围 0–255。",
          tcp: "真实 TCP 连接与监听，支持换行 / 32 位长度 / 原始流消息边界；Pipe 使用开放 TCP，不兼容私有 Pipe 协议。",
          websocket:
            "真实 RFC 6455 WebSocket 收发文本 / JSON / base64 图像。Video Stream 使用开放逐帧 JSON，不包含 RTSP / RTMP 编解码器。",
          mqtt: "真实 MQTT 3.1.1 客户端：订阅，QoS 0 发布，接收 QoS 0/1 与保留消息。",
        } as Record<string, string>
      )[d.protocol] || "";
  }
  if (d.adapter)
    description = `外部适配器（未内置原生驱动）。依赖：${d.dependency}。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。`;
  return {
    type: d.type,
    label: d.adapter ? `${d.english} · 外部桥接` : d.english,
    english: d.english,
    family: d.family,
    description,
    reference: {
      family: d.family,
      name: d.english,
      level: d.adapter ? "bridge" : "subset",
      note: description,
    },
    params,
    inputs:
      d.direction !== "in"
        ? [
            {
              id: "in",
              kind: d.family === "COMP" ? "DAT" : d.family,
              label: "发送数据",
            },
          ]
        : [],
    outputs: [
      {
        id: "out",
        kind: d.family === "COMP" ? "DAT" : d.family,
        label: d.adapter ? "适配器数据" : "接收 / 透传",
      },
    ],
  };
});
