import type { GraphNode, Project } from "../types";
import { makeChannels, type ChannelBuffer } from "../runtimeValues";
export type PerformanceStatus = {
  ready: boolean;
  playing: boolean;
  duration: number;
  time: number;
  tracks: number;
};
type Output = { name: string; kind: string; url: string };
export function connectedNode(
  project: Project,
  nodeId: string,
  handle = "in",
): GraphNode | undefined {
  const edge = project.edges.find(
    (e) => e.target === nodeId && (e.targetHandle || "in") === handle,
  );
  return project.nodes.find((n) => n.id === edge?.source);
}
export function trackURL(project: Project, node: GraphNode): string {
  const source = connectedNode(project, node.id);
  if (!source) return "";
  let outputs: Output[] = [];
  try {
    outputs = JSON.parse(String(source.data.params.outputs_json || "[]"));
  } catch {}
  const name = String(node.data.params.track || "vocals");
  return (
    outputs.find(
      (o) =>
        o.kind === "audio" &&
        new RegExp("^" + name + "(?:_|\\.|$)", "i").test(o.name),
    )?.url || ""
  );
}
export function performanceAncestors(
  project: Project,
  nodeId: string,
): GraphNode[] {
  const ids = new Set<string>();
  const visit = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const edge of project.edges.filter((e) => e.target === id))
      visit(edge.source);
  };
  visit(nodeId);
  return project.nodes.filter((n) => ids.has(n.id));
}
/** All stems and the audible mix share a single AudioContext clock and timeline. */
export class StemPerformance {
  private context?: AudioContext;
  private buffers = new Map<string, AudioBuffer>();
  private references = new Map<string, number>();
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private mix?: AudioBuffer;
  private offset = 0;
  private started = 0;
  private playing = false;
  private signature = "";
  private generation = 0;
  private tracks = 0;
  private rootId = "";
  captureTime?: number;
  private position() {
    return (
      this.captureTime ??
      (this.playing && this.context
        ? Math.max(0, this.context.currentTime - this.started) + this.offset
        : this.offset)
    );
  }
  get time() {
    const t = this.position();
    return this.mix?.duration ? t % this.mix.duration : t;
  }
  get status(): PerformanceStatus {
    return {
      ready: !!this.mix,
      playing: this.playing,
      duration: this.mix?.duration || 0,
      time: this.time,
      tracks: this.tracks,
    };
  }
  private async decode(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    if (!url.startsWith("/api/assets/") && !url.startsWith("/api/exports/"))
      throw new Error("演出音频需要工作台保存的本地文件");
    const response = await fetch(url);
    if (!response.ok) throw new Error("音频读取失败：" + url);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 100 * 1024 * 1024)
      throw new Error("演出音频请限制为 100 MB 以内");
    const decoded = await this.context!.decodeAudioData(bytes);
    this.buffers.set(url, decoded);
    const energies: number[] = [];
    for (let start = 0; start < decoded.length; start += 2048) {
      let sum = 0,
        count = 0;
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const values = decoded.getChannelData(c);
        for (let i = start; i < Math.min(start + 2048, decoded.length); i++) {
          sum += values[i] * values[i];
          count++;
        }
      }
      energies.push(Math.sqrt(sum / Math.max(1, count)));
    }
    energies.sort((a, b) => a - b);
    this.references.set(
      url,
      Math.max(
        0.0001,
        energies[Math.floor((energies.length - 1) * 0.95)] || 0.0001,
      ),
    );
    return decoded;
  }
  async prepare(
    project: Project,
    stageId: string,
    volume = 0.65,
  ): Promise<void> {
    this.context ??= new AudioContext();
    await this.context.resume();
    const generation = ++this.generation;
    const nodes = performanceAncestors(project, stageId),
      tracks = nodes.filter((n) => n.type === "stem_track_chop"),
      music = nodes.find((n) => n.type === "local_music");
    const mix = String(music?.data.params.result_url || "");
    if (!mix || tracks.length < 1)
      throw new Error("请先生成音乐并连接分轨节点与声部读取节点");
    const urls = tracks.map((n) => trackURL(project, n));
    if (urls.some((url) => !url))
      throw new Error("分轨结果不完整，请先运行本地分轨");
    const buffers = await Promise.all([
      this.decode(mix),
      ...urls.map((url) => this.decode(url)),
    ]);
    if (generation !== this.generation)
      throw new Error("作品已切换，已丢弃旧演出准备");
    if (
      buffers
        .slice(1)
        .some(
          (buffer) => Math.abs(buffer.duration - buffers[0].duration) > 0.12,
        )
    )
      throw new Error("声部时长与主音乐不同，不能同步演出");
    this.stop();
    this.mix = buffers[0];
    this.tracks = tracks.length;
    this.rootId = project.id;
    this.signature = this.projectSignature(project, stageId);
    this.gain = this.context.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(this.context.destination);
    this.destination = this.context.createMediaStreamDestination();
    this.gain.connect(this.destination);
    this.offset = 0;
    this.setPlaying(true);
  }
  private projectSignature(project: Project, stageId: string) {
    return JSON.stringify(
      performanceAncestors(project, stageId)
        .filter((n) =>
          ["local_music", "local_stems", "stem_track_chop"].includes(n.type),
        )
        .map((n) => [
          n.id,
          n.type,
          n.data.params.result_url,
          n.data.params.outputs_json,
          n.data.params.track,
        ]),
    );
  }
  reconcile(project: Project) {
    if (this.rootId && this.rootId !== project.id) {
      this.release();
      return;
    }
    const stage = project.nodes.find((n) => n.type === "pointcloud_stage_top");
    if (
      this.mix &&
      (!stage || this.projectSignature(project, stage.id) !== this.signature)
    )
      this.release();
    if (stage && this.gain && this.context)
      this.gain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, Number(stage.data.params.volume ?? 0.65))),
        this.context.currentTime,
        0.04,
      );
  }
  setPlaying(playing: boolean) {
    if (!this.context || !this.mix || playing === this.playing) return;
    if (!playing) {
      this.offset = this.position() % this.mix.duration;
      this.source?.stop();
      this.source?.disconnect();
      this.source = undefined;
      this.playing = false;
      return;
    }
    void this.context.resume();
    this.source = this.context.createBufferSource();
    this.source.buffer = this.mix;
    this.source.loop = true;
    this.source.connect(this.gain!);
    this.started = this.context.currentTime + 0.06;
    this.source.start(this.started, this.offset);
    this.playing = true;
  }
  rewind() {
    const playing = this.playing;
    this.setPlaying(false);
    this.offset = 0;
    this.captureTime = undefined;
    this.setPlaying(playing);
  }
  stop() {
    if (this.playing) this.setPlaying(false);
    this.source?.disconnect();
    this.gain?.disconnect();
    this.destination?.disconnect();
    this.source = undefined;
    this.gain = undefined;
    this.destination = undefined;
    this.offset = 0;
    this.playing = false;
    this.mix = undefined;
    this.tracks = 0;
  }
  release() {
    this.generation++;
    this.stop();
    this.mix = undefined;
    this.buffers.clear();
    this.references.clear();
    this.rootId = "";
    this.signature = "";
    this.tracks = 0;
    this.captureTime = undefined;
  }
  dispose() {
    this.release();
    void this.context?.close();
    this.context = undefined;
  }
  stream() {
    return this.destination?.stream;
  }
  reference(project: Project, envelope: GraphNode) {
    const track = connectedNode(project, envelope.id);
    return track ? this.references.get(trackURL(project, track)) || 0.18 : 0.18;
  }
  samples(project: Project, node: GraphNode, time: number): ChannelBuffer {
    const track = String(node.data.params.track || "vocals"),
      buffer =
        this.mix || this.captureTime !== undefined
          ? this.buffers.get(trackURL(project, node))
          : undefined,
      length = Math.min(
        8192,
        Math.max(512, Number(node.data.params.samples) || 2048),
      ),
      rate = buffer?.sampleRate || 44100,
      start = Math.floor(time * rate);
    return makeChannels(
      Array.from({ length: buffer?.numberOfChannels || 2 }, (_, c) => ({
        name: track + "_" + (c === 0 ? "left" : "right"),
        samples: Array.from({ length }, (_, i) => {
          if (!buffer) return 0;
          const values = buffer.getChannelData(c),
            index = start + i - Math.floor(length / 2);
          return values[
            ((index % values.length) + values.length) % values.length
          ];
        }),
      })),
      rate,
      start - Math.floor(length / 2),
      true,
    );
  }
}
