import type { NodeSpec, Param, Port } from "../types";
const n = (
  key: string,
  label: string,
  value: number,
  min = 0,
  max = 1,
  step = 0.01,
): Param => ({ key, label, type: "number", default: value, min, max, step });
const t = (key: string, label: string, value = ""): Param => ({
  key,
  label,
  type: "text",
  default: value,
});
const b = (key: string, label: string, value = false): Param => ({
  key,
  label,
  type: "boolean",
  default: value,
});
const select = (
  key: string,
  label: string,
  value: string,
  options: string[],
): Param => ({ key, label, type: "select", default: value, options });
const a: Port = { id: "in", kind: "CHOP", label: "PCM 多通道" };
const volume = () => n("volume", "音量", 0.7, 0, 2),
  samples = () => n("samples", "每次采样数", 1024, 32, 16384, 1),
  url = () => t("url", "音频 / 视频 URL"),
  loop = () => b("loop", "循环");
const spec = (
  type: string,
  label: string,
  english: string,
  description: string,
  params: Param[],
  inputs: Port[] = [],
  family = "CHOP",
): NodeSpec => ({
  type,
  label,
  english,
  family,
  description,
  params,
  inputs,
  outputs: [
    {
      id: "out",
      kind: family,
      label: family === "DAT" ? "媒体信息" : "PCM 多通道",
    },
  ],
});
export const mediaCatalog: NodeSpec[] = [
  spec(
    "media_audio_file_in",
    "音频文件采样",
    "Audio File In",
    "点击启用后解码音频文件为真实 PCM 多通道；根据时间线读出采样块，不自动播放。",
    [
      url(),
      samples(),
      loop(),
      n("offset", "偏移秒数", 0, 0, 3600),
      n("speed", "播放倍率", 1, 0.1, 4),
    ],
  ),
  spec(
    "media_audio_file_out",
    "导出音频 WAV",
    "Audio File Out",
    "点击启用将输入采样段编码为 PCM16 WAV 文件供下载；完整保留通道和采样率。",
    [t("filename", "文件名称", "td-open-audio.wav")],
    [a],
  ),
  spec(
    "media_audio_play",
    "播放音频采样",
    "Audio Play",
    "点击启用播放输入 PCM 或音频 URL，支持循环、音量和停止。",
    [url(), volume(), loop(), n("speed", "播放倍率", 1, 0.1, 4)],
    [a],
  ),
  spec(
    "media_audio_device_out",
    "音频设备输出",
    "Audio Device Out",
    "显式启用后按采样率将输入时间片送至浏览器音频输出设备；支持可用设备 sink ID。",
    [volume(), t("device_id", "输出设备 ID（空为默认）")],
    [a],
  ),
  spec(
    "media_audio_movie",
    "视频音轨采样",
    "Audio Movie",
    "绑定视频节点 ID 或视频 URL，同步读取其播放时钟与立体声音轨 PCM。",
    [t("movie_node", "视频节点 ID"), url(), volume(), samples(), loop()],
  ),
  spec(
    "media_audio_stream_in",
    "音频流输入",
    "Audio Stream In",
    "显式启用后读取浏览器可播放 HTTP 音频流，或建立 WebRTC 音频接收；不包含 RTSP 解码。",
    [
      select("mode", "流类型", "url", ["url", "webrtc"]),
      url(),
      t("remote_sdp", "远端 SDP JSON"),
      volume(),
      samples(),
    ],
  ),
  spec(
    "media_audio_stream_out",
    "WebRTC 音频流输出",
    "Audio Stream Out",
    "将 PCM 通道编码为 WebRTC 音频轨道；点击启用交换 SDP，连接后连续发送时间片。不提供 RTSP 服务器。",
    [t("remote_sdp", "远端 SDP JSON"), volume()],
    [a],
  ),
  spec(
    "media_file_info",
    "媒体文件信息",
    "Media File Info",
    "点击启用读取音频元信息，输出时长、采样率、通道数、样本数和解码状态。",
    [url()],
    [],
    "DAT",
  ),
];
export const mediaReferenceKeys = mediaCatalog.map(
  (spec) => `${spec.family}:${spec.english}`,
);
export const mediaReferenceCoverage = mediaCatalog.map((spec) => ({
  family: spec.family,
  reference: spec.english,
  type: spec.type,
  status: "implemented",
  limitations: spec.description,
}));
