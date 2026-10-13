import type { GraphNode, Project } from "../types";
import {
  asChannels,
  makeChannels,
  makeTable,
  type ChannelBuffer,
  type TableData,
} from "../runtimeValues";
import { mediaCatalog } from "./mediaCatalog";
const supported = new Set(mediaCatalog.map((spec) => spec.type));
export type MediaContext = {
  project?: Project;
  videoForNode?: (id: string) => HTMLVideoElement | undefined;
};
export type MediaActivation = {
  status: string;
  localDescription?: string;
  download?: { url: string; name: string };
};
type MediaEntry = {
  id: string;
  type: string;
  signature: string;
  active: boolean;
  error?: string;
  buffer?: AudioBuffer;
  gain?: GainNode;
  source?: AudioBufferSourceNode;
  sources?: Set<AudioBufferSourceNode>;
  dropped?: number;
  sampleEnd?: number;
  sampleStart?: number;
  sampleRate?: number;
  media?: HTMLMediaElement;
  ownsMedia?: boolean;
  mediaSource?: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
  analysers?: AnalyserNode[];
  splitter?: ChannelSplitterNode;
  silent?: GainNode;
  nextTime: number;
  lastInput?: string;
  lastCook?: number;
  peer?: RTCPeerConnection;
  destination?: MediaStreamAudioDestinationNode;
  download?: { url: string; name: string };
  capture?: MediaStream;
  abort?: AbortController;
};
const value = (node: GraphNode, key: string, fallback = 0) => {
  const n = Number(node.data.params[key] ?? fallback);
  return Number.isFinite(n) ? n : fallback;
};
const text = (node: GraphNode, key: string, fallback = "") =>
  String(node.data.params[key] ?? fallback);
const signature = (node: GraphNode) =>
  JSON.stringify([
    node.type,
    text(node, "url"),
    text(node, "movie_node"),
    text(node, "mode"),
    text(node, "device_id"),
  ]);
/** PCM16 little-endian WAV, interleaved channels. The caller chooses where to save it. */
export function encodeWAV(input: ChannelBuffer): ArrayBuffer {
  const channels = input.channels.length,
    length = input.channels[0]?.samples.length ?? 0;
  if (!channels || channels > 32 || !length)
    throw new Error("WAV 导出需要 1–32 条非空 PCM 通道");
  const bytes = length * channels * 2,
    buffer = new ArrayBuffer(44 + bytes),
    view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, input.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < length; i++)
    for (let c = 0; c < channels; c++) {
      const x = Math.max(-1, Math.min(1, input.channels[c].samples[i]));
      view.setInt16(
        44 + (i * channels + c) * 2,
        Math.round(x * (x < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}
export class MediaRuntime {
  private audio?: AudioContext;
  constructor(
    private options: { audioContextFactory?: () => AudioContext } = {},
  ) {}
  private entries = new Map<string, MediaEntry>();
  private mediaSources = new WeakMap<
    HTMLMediaElement,
    MediaElementAudioSourceNode
  >();
  private context: MediaContext = {};
  setContext(context: MediaContext) {
    this.context = context;
  }
  private async audioContext(): Promise<AudioContext> {
    this.audio ??= this.options.audioContextFactory?.() ?? new AudioContext();
    if (this.audio.state === "suspended") await this.audio.resume();
    return this.audio;
  }
  private async decode(url: string, entry: MediaEntry): Promise<AudioBuffer> {
    if (!url) throw new Error("请先填写音频文件 URL");
    const parsed = new URL(url, location.href);
    if (!["http:", "https:", "blob:", "data:"].includes(parsed.protocol))
      throw new Error("音频地址必须使用 HTTP(S)、blob 或 data URL");
    const controller = new AbortController();
    entry.abort = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(parsed.href, { signal: controller.signal });
      if (!response.ok)
        throw new Error(`音频加载失败：HTTP ${response.status}`);
      const limit = 64 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit)
        throw new Error("音频文件超过 64 MiB 解码上限");
      const reader = response.body?.getReader();
      let data: ArrayBuffer;
      if (reader) {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > limit) {
            await reader.cancel();
            throw new Error("音频文件超过 64 MiB 解码上限");
          }
          chunks.push(value);
        }
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.length;
        }
        data = joined.buffer;
      } else {
        data = await response.arrayBuffer();
        if (data.byteLength > limit)
          throw new Error("音频文件超过 64 MiB 解码上限");
      }
      const context = await this.audioContext();
      return await context.decodeAudioData(data);
    } finally {
      clearTimeout(timeout);
      entry.abort = undefined;
    }
  }
  private pcm(input: unknown, context: AudioContext): AudioBuffer {
    const channels = asChannels(input),
      length = channels.channels[0]?.samples.length ?? 0;
    if (!length || !channels.channels.length || channels.channels.length > 32)
      throw new Error("需要连接 1–32 条非空 PCM 通道");
    const buffer = context.createBuffer(
      channels.channels.length,
      length,
      channels.sampleRate,
    );
    channels.channels.forEach((ch, c) =>
      buffer.copyToChannel(Float32Array.from(ch.samples), c),
    );
    return buffer;
  }
  private analyser(
    source: AudioNode,
    entry: MediaEntry,
    context: AudioContext,
  ): void {
    const splitter = context.createChannelSplitter(2),
      silent = context.createGain();
    silent.gain.value = 0;
    source.connect(splitter);
    silent.connect(context.destination);
    entry.splitter = splitter;
    entry.silent = silent;
    entry.analysers = [0, 1].map((index) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      splitter.connect(analyser, index);
      analyser.connect(silent);
      return analyser;
    });
  }
  private async linkMedia(
    media: HTMLMediaElement,
    entry: MediaEntry,
    node: GraphNode,
  ): Promise<void> {
    const context = await this.audioContext();
    let source = this.mediaSources.get(media);
    if (!source) {
      source = context.createMediaElementSource(media);
      this.mediaSources.set(media, source);
    }
    const gain = context.createGain();
    gain.gain.value = value(node, "volume", 0.7);
    source.connect(gain);
    gain.connect(context.destination);
    entry.media = media;
    entry.mediaSource = source;
    entry.gain = gain;
    this.analyser(source, entry, context);
    await media.play();
  }
  private async settleICE(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 3000);
      function done() {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", change);
        resolve();
      }
      function change() {
        if (peer.iceGatheringState === "complete") done();
      }
      peer.addEventListener("icegatheringstatechange", change);
    });
  }
  private remote(node: GraphNode): RTCSessionDescriptionInit | undefined {
    if (!text(node, "remote_sdp")) return;
    let remote: RTCSessionDescriptionInit;
    try {
      remote = JSON.parse(text(node, "remote_sdp"));
    } catch {
      throw new Error("远端 SDP 必须为 type/sdp JSON 对象");
    }
    if (
      !remote ||
      !["offer", "answer"].includes(remote.type) ||
      typeof remote.sdp !== "string"
    )
      throw new Error("远端 SDP 必须包含 offer/answer 类型和 sdp 字符串");
    return remote;
  }
  private async webRTC(
    node: GraphNode,
    entry: MediaEntry,
    input: unknown,
  ): Promise<MediaActivation> {
    const context = await this.audioContext(),
      peer = new RTCPeerConnection({ iceServers: [] });
    entry.peer = peer;
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed")
        entry.error =
          "WebRTC 连接失败，请确认网络和 SDP；跨公网通常需要外部 TURN 信令服务";
    };
    if (node.type === "media_audio_stream_out") {
      const destination = context.createMediaStreamDestination(),
        gain = context.createGain();
      gain.gain.value = value(node, "volume", 0.7);
      gain.connect(destination);
      entry.gain = gain;
      entry.destination = destination;
      destination.stream
        .getAudioTracks()
        .forEach((track) => peer.addTrack(track, destination.stream));
      this.schedule(node, entry, asChannels(input), context);
    } else {
      peer.addTransceiver("audio", { direction: "recvonly" });
      peer.ontrack = (event) => {
        const stream = new MediaStream([event.track]),
          source = context.createMediaStreamSource(stream);
        entry.mediaSource = source;
        entry.capture = stream;
        // Chromium's remote WebRTC audio renderer also needs an attached media sink.
        // Keep it muted: audible monitoring goes through the explicit Web Audio gain.
        const receiver = new Audio();
        receiver.srcObject = stream;
        receiver.muted = true;
        entry.media = receiver;
        entry.ownsMedia = true;
        void receiver.play().catch((error) => {
          entry.error = `WebRTC 音轨播放失败：${String(error)}`;
        });
        this.analyser(source, entry, context);
        const gain = context.createGain();
        gain.gain.value = value(node, "volume", 0.7);
        source.connect(gain);
        gain.connect(context.destination);
        entry.gain = gain;
      };
    }
    const remote = this.remote(node);
    if (remote) {
      await peer.setRemoteDescription(remote);
      if (remote.type !== "offer")
        throw new Error("首次建立连接需要远端 offer，或留空生成本地 offer");
      await peer.setLocalDescription(await peer.createAnswer());
    } else await peer.setLocalDescription(await peer.createOffer());
    await this.settleICE(peer);
    if (this.entries.get(node.id) !== entry) {
      this.release(entry);
      throw new Error("媒体启用已取消");
    }
    entry.active = true;
    return {
      status: "WebRTC 信令已生成，复制本地 SDP 并在另一端交换",
      localDescription: JSON.stringify(peer.localDescription),
    };
  }
  private schedule(
    node: GraphNode,
    entry: MediaEntry,
    channels: ChannelBuffer,
    context: AudioContext,
  ): void {
    const identity = JSON.stringify([
      channels.start,
      channels.sampleRate,
      channels.channels,
    ]);
    if (identity === entry.lastInput) return;
    entry.lastInput = identity;
    if (channels.timeSlice) {
      const length = channels.channels[0]?.samples.length ?? 0;
      if (
        entry.sampleStart !== undefined &&
        channels.start < entry.sampleStart
      ) {
        for (const source of entry.sources ?? []) {
          try {
            source.stop();
          } catch {
            /* Already ended. */
          }
          source.disconnect();
        }
        entry.sources?.clear();
        entry.sampleEnd = undefined;
        entry.nextTime = context.currentTime + 0.015;
      }
      const overlap =
        entry.sampleRate === channels.sampleRate &&
        entry.sampleEnd !== undefined
          ? Math.max(0, Math.round(entry.sampleEnd - channels.start))
          : 0;
      entry.sampleStart = channels.start;
      entry.sampleRate = channels.sampleRate;
      if (overlap >= length) return;
      entry.sampleEnd = channels.start + length;
      if (overlap)
        channels = makeChannels(
          channels.channels.map((channel) => ({
            name: channel.name,
            samples: channel.samples.slice(overlap),
          })),
          channels.sampleRate,
          channels.start + overlap,
          true,
        );
    }
    if (entry.nextTime > context.currentTime + 0.5) {
      entry.dropped = (entry.dropped ?? 0) + 1;
      return;
    }
    const buffer = this.pcm(channels, context),
      source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(entry.gain!);
    const start = Math.max(context.currentTime + 0.015, entry.nextTime);
    source.start(start);
    entry.nextTime = start + buffer.duration;
    entry.source = source;
    (entry.sources ??= new Set()).add(source);
    source.onended = () => {
      source.disconnect();
      entry.sources?.delete(source);
    };
  }
  async activate(
    node: GraphNode,
    input?: unknown,
    context?: MediaContext,
  ): Promise<MediaActivation> {
    if (!supported.has(node.type)) throw new Error("该节点不是媒体节点");
    if (context) this.context = context;
    const old = this.entries.get(node.id),
      remote = this.remote(node);
    if (
      old?.peer &&
      remote?.type === "answer" &&
      old.peer.signalingState === "have-local-offer"
    ) {
      await old.peer.setRemoteDescription(remote);
      return {
        status: "WebRTC 远端答复已应用",
        localDescription: JSON.stringify(old.peer.localDescription),
      };
    }
    this.stop(node.id);
    const entry: MediaEntry = {
      id: node.id,
      type: node.type,
      signature: signature(node),
      active: false,
      nextTime: 0,
    };
    this.entries.set(node.id, entry);
    try {
      if (node.type === "media_audio_file_out") {
        const blob = new Blob([encodeWAV(asChannels(input))], {
            type: "audio/wav",
          }),
          name = text(node, "filename", "td-open-audio.wav").replace(
            /[\\/]/g,
            "_",
          );
        entry.download = {
          url: URL.createObjectURL(blob),
          name: /\.wav$/i.test(name) ? name : name + ".wav",
        };
        entry.active = true;
        return { status: "WAV 已编码，可下载", download: entry.download };
      }
      const audio = await this.audioContext();
      if (
        node.type === "media_audio_stream_out" ||
        (node.type === "media_audio_stream_in" &&
          text(node, "mode") === "webrtc")
      )
        return await this.webRTC(node, entry, input);
      if (
        node.type === "media_audio_file_in" ||
        node.type === "media_file_info"
      )
        entry.buffer = await this.decode(text(node, "url"), entry);
      else if (node.type === "media_audio_play") {
        entry.buffer =
          input !== undefined
            ? this.pcm(input, audio)
            : await this.decode(text(node, "url"), entry);
        const gain = audio.createGain(),
          source = audio.createBufferSource();
        gain.gain.value = value(node, "volume", 0.7);
        gain.connect(audio.destination);
        source.buffer = entry.buffer;
        source.loop = Boolean(node.data.params.loop);
        source.playbackRate.value = value(node, "speed", 1);
        source.connect(gain);
        entry.gain = gain;
        entry.source = source;
        source.start();
      } else if (node.type === "media_audio_device_out") {
        const device = text(node, "device_id");
        if (device) {
          const setter = (
            audio as AudioContext & {
              setSinkId?: (id: string) => Promise<void>;
            }
          ).setSinkId;
          if (!setter) throw new Error("当前浏览器不支持选择音频输出设备");
          await setter.call(audio, device);
        }
        const gain = audio.createGain();
        gain.gain.value = value(node, "volume", 0.7);
        gain.connect(audio.destination);
        entry.gain = gain;
        this.schedule(node, entry, asChannels(input), audio);
      } else if (node.type === "media_audio_movie") {
        const existing = text(node, "movie_node")
          ? this.context.videoForNode?.(text(node, "movie_node"))
          : undefined;
        if (text(node, "movie_node") && !existing)
          throw new Error("尚未找到对应视频节点的已加载播放器");
        const media = existing ?? document.createElement("video");
        entry.ownsMedia = !existing;
        if (!existing) {
          if (!text(node, "url")) throw new Error("请指定视频节点或视频 URL");
          media.crossOrigin = "anonymous";
          media.src = text(node, "url");
          media.loop = Boolean(node.data.params.loop);
        }
        await this.linkMedia(media, entry, node);
      } else if (node.type === "media_audio_stream_in") {
        if (!text(node, "url"))
          throw new Error("请填写浏览器可播放的 HTTP 音频流 URL");
        const media = new Audio();
        media.crossOrigin = "anonymous";
        media.src = text(node, "url");
        entry.ownsMedia = true;
        await this.linkMedia(media, entry, node);
      }
      if (this.entries.get(node.id) !== entry) {
        this.release(entry);
        throw new Error("媒体启用已取消");
      }
      entry.active = true;
      return {
        status:
          node.type === "media_audio_file_in" || node.type === "media_file_info"
            ? "媒体解码完成"
            : "媒体已启用",
      };
    } catch (error) {
      this.release(entry);
      entry.error = error instanceof Error ? error.message : String(error);
      entry.active = false;
      throw error;
    }
  }
  cook(
    node: GraphNode,
    time: number,
    input: (handle?: string) => unknown,
    _state?: Map<string, unknown>,
    context?: MediaContext,
  ): { handled: false } | { handled: true; value: ChannelBuffer | TableData } {
    if (!supported.has(node.type)) return { handled: false };
    if (context) this.context = context;
    const entry = this.entries.get(node.id);
    if (!entry?.active)
      throw new Error(
        entry?.error || "请在参数面板点击「启用媒体」以读取或播放音频",
      );
    if (entry.error) throw new Error(entry.error);
    if (entry.signature !== signature(node))
      throw new Error("媒体源参数已更改，请重新点击启用媒体");
    if (entry.gain) entry.gain.gain.value = value(node, "volume", 0.7);
    if (entry.source && node.type === "media_audio_play") {
      entry.source.loop = Boolean(node.data.params.loop);
      entry.source.playbackRate.value = value(node, "speed", 1);
    }
    if (node.type === "media_file_info")
      return {
        handled: true,
        value: makeTable([
          ["property", "value"],
          ["duration", entry.buffer!.duration],
          ["sample_rate", entry.buffer!.sampleRate],
          ["channels", entry.buffer!.numberOfChannels],
          ["samples", entry.buffer!.length],
          ["status", "decoded"],
        ]),
      };
    if (
      node.type === "media_audio_file_in" ||
      node.type === "media_audio_play"
    ) {
      const buffer = entry.buffer!,
        length = Math.min(
          16384,
          Math.max(1, Math.floor(value(node, "samples", 1024))),
        ),
        rate = buffer.sampleRate,
        position = Math.floor(
          (time * value(node, "speed", 1) + value(node, "offset")) * rate,
        ),
        loop = Boolean(node.data.params.loop);
      return {
        handled: true,
        value: makeChannels(
          Array.from({ length: buffer.numberOfChannels }, (_, c) => {
            const values = buffer.getChannelData(c);
            return {
              name:
                buffer.numberOfChannels === 2
                  ? ["left", "right"][c]
                  : `audio${c + 1}`,
              samples: Array.from({ length }, (_, i) => {
                const index = position + i;
                return loop
                  ? values[
                      ((index % values.length) + values.length) % values.length
                    ]
                  : (values[index] ?? 0);
              }),
            };
          }),
          rate,
          position,
          true,
        ),
      };
    }
    if (
      node.type === "media_audio_device_out" ||
      node.type === "media_audio_stream_out"
    ) {
      const channels = asChannels(input());
      if (this.audio) this.schedule(node, entry, channels, this.audio);
      return { handled: true, value: channels };
    }
    if (node.type === "media_audio_file_out")
      return { handled: true, value: asChannels(input()) };
    if (!entry.analysers)
      return {
        handled: true,
        value: makeChannels(
          { left: [], right: [] },
          this.audio?.sampleRate ?? 48000,
          0,
          true,
        ),
      };
    const requested = Math.max(
        32,
        Math.min(16384, Math.floor(value(node, "samples", 1024))),
      ),
      size = 2 ** Math.ceil(Math.log2(requested)),
      rate = this.audio?.sampleRate ?? 48000,
      position = Math.floor((entry.media?.currentTime ?? time) * rate);
    return {
      handled: true,
      value: makeChannels(
        entry.analysers.map((analyser, c) => {
          if (analyser.fftSize !== size) analyser.fftSize = size;
          const values = new Float32Array(size);
          analyser.getFloatTimeDomainData(values);
          return {
            name: c ? "right" : "left",
            samples: Array.from(values.slice(size - requested)),
          };
        }),
        rate,
        position - requested,
        true,
      ),
    };
  }
  status(id: string): MediaActivation & {
    active: boolean;
    error?: string;
    connection?: string;
    droppedBlocks?: number;
  } {
    const entry = this.entries.get(id);
    return {
      active: !!entry?.active,
      status: entry?.error ?? (entry?.active ? "已启用" : "未启用"),
      error: entry?.error,
      download: entry?.download,
      localDescription: entry?.peer?.localDescription
        ? JSON.stringify(entry.peer.localDescription)
        : undefined,
      connection: entry?.peer?.connectionState,
      droppedBlocks: entry?.dropped ?? 0,
    };
  }
  private release(entry: MediaEntry): void {
    entry.abort?.abort();
    for (const source of entry.sources ?? []) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
    }
    entry.sources?.clear();
    try {
      entry.source?.stop();
    } catch {
      /* Already ended. */
    }
    entry.source?.disconnect();
    entry.gain?.disconnect();
    entry.mediaSource?.disconnect();
    entry.splitter?.disconnect();
    entry.analysers?.forEach((node) => node.disconnect());
    entry.silent?.disconnect();
    entry.peer?.close();
    entry.destination?.stream.getTracks().forEach((track) => track.stop());
    entry.capture?.getTracks().forEach((track) => track.stop());
    if (entry.media && entry.ownsMedia) {
      entry.media.pause();
      entry.media.srcObject = null;
      entry.media.removeAttribute("src");
      entry.media.load();
    }
    if (entry.download) URL.revokeObjectURL(entry.download.url);
    entry.active = false;
  }
  stop(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.release(entry);
    this.entries.delete(id);
  }
  prune(ids: Iterable<string>): void {
    const keep = new Set(ids);
    for (const id of this.entries.keys()) if (!keep.has(id)) this.stop(id);
  }
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.stop(id);
    void this.audio?.close();
    this.audio = undefined;
    this.mediaSources = new WeakMap();
  }
}
