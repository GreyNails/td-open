import * as THREE from "three";
import { loadSceneModel } from "./nodes/sceneModelLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { api } from "./types";
import type { GraphNode, Project } from "./types";
import { byType } from "./catalog";
import {
  localImageTypes,
  localAudioTypes,
  localModelTypes,
} from "./nodes/localAICatalog";
import {
  cookReferenceTopNode,
  disposeReferenceTopState,
} from "./nodes/referenceTopRuntime";
import { cookCompatibilityTopNode } from "./nodes/compatibilityTopRuntime";
import { registerSceneModel, forgetSceneModel } from "./nodes/modelRegistry";
import { compileNetworks, operatorPath, networkTime } from "./networks";
import { cookChannelDataNode } from "./nodes/channelDataRuntime";
import { cookGeometryV2Node } from "./nodes/geometryV2Runtime";
import { cookIONode, disposeIOState } from "./nodes/ioRuntime";
import {
  isChannelBuffer,
  isTableData,
  scalarValue,
  textValue,
  type ChannelBuffer,
  type TableData,
} from "./runtimeValues";
import { buildScene, isSceneSpec, type SceneSpec } from "./nodes/sceneRuntime";
import { isMaterialSpec, type MaterialSpec } from "./nodes/materialRuntime";
import { MediaRuntime } from "./nodes/mediaRuntime";
import { BrowserInputs } from "./nodes/browserRuntime";
import { StemPerformance } from "./nodes/stemPerformance";
import {
  sampleSurface,
  cookEnvelope,
  danceSpec,
  pointCloudPLY,
  type PointCloudSpec,
} from "./nodes/pointPerformance";
import { PointStage } from "./nodes/pointStage";
import { resolveSceneModel } from "./nodes/modelRegistry";
import { cookComponentNode } from "./nodes/componentRuntime";

import { cookVisualNode } from "./nodes/visual";
import { cookDataNode } from "./nodes/dataRuntime";
import { cookAdvancedDataNode } from "./nodes/advancedDataRuntime";
import { cookAdvancedVisualNode } from "./nodes/advancedVisual";
import {
  buildGeometryObject,
  isGeometrySpec,
  type GeometrySpec,
} from "./nodes/geometry";
type Geo = GeometrySpec;
type LegacyValue = HTMLCanvasElement | number | string | Geo;
type Value = LegacyValue | ChannelBuffer | TableData | MaterialSpec | SceneSpec;
const W = 640,
  H = 360,
  NOISE_W = 320,
  NOISE_H = 180;
const isCanvas = (x: Value | undefined): x is HTMLCanvasElement =>
  x instanceof HTMLCanvasElement;
const clamp = (x: number, min: number, max: number) =>
  Math.max(min, Math.min(max, x));
const fragment = `
precision highp float;
varying vec2 vUv;
uniform float uTime,uScale,uDetail,uSeed;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uSeed*13.1)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){if(float(i)>=uDetail)break;v+=a*noise(p);p=mat2(.8,-.6,.6,.8)*p*2.03+3.2;a*=.5;}return v;}
void main(){vec2 uv=vUv;uv.x*=1.7778;vec2 p=(uv-vec2(.88,.5))*uScale;
vec2 q=vec2(fbm(p+uTime*.12),fbm(p+vec2(5.2,1.3)-uTime*.09));
vec2 r=vec2(fbm(p+3.5*q+vec2(1.7,9.2)+uTime*.15),fbm(p+3.5*q+vec2(8.3,2.8)-uTime*.13));
float f=fbm(p+4.*r);float ridge=pow(abs(sin((f*2.1+r.x*.75)*10.)),7.);
vec3 dark=vec3(.045,.03,.11),purple=vec3(.51,.28,.85),peach=vec3(1.,.49,.31);
vec3 col=mix(dark,purple,smoothstep(.25,.75,f));col=mix(col,peach,pow(r.y,2.)*.9);
col+=ridge*mix(vec3(.27,.12,.43),vec3(.77,.43,.34),q.x)*.95;
col*=.74+.26*smoothstep(.9,.1,length(vUv-.5));gl_FragColor=vec4(col,1.);}`;

export class StudioEngine {
  project: Project;
  browserInputs = new BrowserInputs();
  mediaRuntime = new MediaRuntime();
  viewPath: string[] = [];
  resolveId(id: string) {
    return [...this.viewPath, id].filter(Boolean).join("/");
  }
  revision = 0;
  frames = new Map<string, HTMLCanvasElement>();
  values = new Map<string, Value>();
  errors = new Map<string, string>();
  gpu = "Canvas 2D";
  audioLevel = 0;
  frequencies = new Uint8Array(128);
  private renderSources = new WeakMap<
    HTMLCanvasElement,
    { scene: THREE.Scene; camera: THREE.Camera }
  >();
  private sceneFrames = new Map<
    string,
    { key: string; built: ReturnType<typeof buildScene> }
  >();
  private releaseState(state: Map<string, unknown>) {
    disposeIOState(state);
    disposeReferenceTopState(state);
    const dispose = state.get("dispose");
    if (typeof dispose === "function") dispose();
  }
  private clearStates() {
    for (const state of this.operatorStates.values()) this.releaseState(state);
    this.operatorStates.clear();
  }
  private operatorStates = new Map<string, Map<string, unknown>>();
  private lastTime = 0;
  readonly performance = new StemPerformance();
  private state(id: string) {
    let state = this.operatorStates.get(id);
    if (!state) {
      state = new Map();
      this.operatorStates.set(id, state);
    }
    return state;
  }
  private renderer?: THREE.WebGLRenderer;
  private noiseScene?: THREE.Scene;
  private noiseMaterial?: THREE.ShaderMaterial;
  private noiseCamera = new THREE.Camera();
  private camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  private scenes = new Map<
    string,
    {
      key: string;
      scene: THREE.Scene;
      object: THREE.Object3D;
      ownsResources: boolean;
    }
  >();
  private images = new Map<string, HTMLImageElement | HTMLVideoElement>();
  private modelLoads = new Map<string, THREE.Group>();
  private loadingModels = new Map<string, symbol>();
  private modelRetryAt = new Map<string, number>();
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private stream?: MediaStream;
  private audioEl?: HTMLAudioElement;
  private audioUrl = "";
  private audioGeneration = 0;
  private playing = true;
  private disposed = false;
  constructor(project: Project) {
    this.project = compileNetworks(project);
    this.camera.position.set(0, 0, 4.5);
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(NOISE_W, NOISE_H);
      this.renderer.setClearColor("#0c0c13");
      this.gpu = "WebGL 2";
      this.noiseScene = new THREE.Scene();
      this.noiseMaterial = new THREE.ShaderMaterial({
        vertexShader:
          "varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.);}",
        fragmentShader: fragment,
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 3 },
          uDetail: { value: 4 },
          uSeed: { value: 1 },
        },
      });
      this.noiseScene.add(
        new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.noiseMaterial),
      );
    } catch {
      this.renderer?.dispose();
      this.renderer = undefined;
      this.gpu = "Canvas 2D（WebGL 不可用）";
    }
  }
  private stateParams(node: GraphNode) {
    const params = { ...node.data.params };
    if (node.type === "channel_record") {
      delete params.recording;
      delete params.reset;
    }
    return params;
  }
  private setGPUSize(width: number, height: number) {
    if (
      this.renderer &&
      (this.renderer.domElement.width !== width ||
        this.renderer.domElement.height !== height)
    )
      this.renderer.setSize(width, height, false);
  }
  setProject(document: Project) {
    let project: Project;
    try {
      project = compileNetworks(document);
      this.errors.delete("__network");
    } catch (error) {
      this.errors.set("__network", String(error));
      return;
    }
    const previous = this.project;
    const switched = previous.id !== project.id;
    this.project = project;
    this.performance.reconcile(project);
    const ids = new Set(project.nodes.map((n) => n.id));
    const previousNodes = new Map(previous.nodes.map((n) => [n.id, n]));
    const resourceIds = new Set(
      project.nodes
        .filter((n) => {
          const old = previousNodes.get(n.id);
          return (
            !switched &&
            old?.type === n.type &&
            [
              "url",
              "result_url",
              "movie_node",
              "mode",
              "device_id",
              "device",
            ].every((key) => old.data.params[key] === n.data.params[key])
          );
        })
        .map((n) => n.id),
    );
    this.browserInputs.retain(resourceIds);
    this.mediaRuntime.prune(resourceIds);
    for (const [id, entry] of this.sceneFrames)
      if (switched || !ids.has(id)) {
        entry.built.dispose();
        this.sceneFrames.delete(id);
      }
    for (const id of this.operatorStates.keys()) {
      const current = project.nodes.find((n) => n.id === id),
        old = previous.nodes.find((n) => n.id === id);
      if (
        switched ||
        !current ||
        current.type !== old?.type ||
        JSON.stringify(this.stateParams(current)) !==
          JSON.stringify(old && this.stateParams(old)) ||
        JSON.stringify(project.edges.filter((e) => e.target === id)) !==
          JSON.stringify(previous.edges.filter((e) => e.target === id))
      ) {
        this.releaseState(this.operatorStates.get(id)!);
        this.operatorStates.delete(id);
      }
    }
    const imageUrls = new Set(
      project.nodes
        .filter(
          (n) =>
            n.type === "media" ||
            n.type === "ai_image" ||
            localImageTypes.has(n.type) ||
            (["comfy_workflow", "comfy_custom"].includes(n.type) &&
              ["image", "video"].includes(String(n.data.params.result_kind))),
        )
        .map((n) =>
          String(
            n.data.params[n.type === "media" ? "url" : "result_url"] || "",
          ),
        ),
    );
    const modelUrls = new Set(
      project.nodes
        .filter(
          (n) =>
            ["ai_3d", "file_in_sop", "fbx_comp"].includes(n.type) ||
            localModelTypes.has(n.type) ||
            (["comfy_workflow", "comfy_custom"].includes(n.type) &&
              n.data.params.result_kind === "3d"),
        )
        .map((n) =>
          String(
            n.data.params[
              n.type === "ai_3d" ||
              localModelTypes.has(n.type) ||
              ["comfy_workflow", "comfy_custom"].includes(n.type)
                ? "result_url"
                : "url"
            ] || "",
          ),
        ),
    );
    const audioNodes = project.nodes.filter(
      (n) =>
        n.type === "audio" ||
        n.type === "ai_music" ||
        localAudioTypes.has(n.type) ||
        (["comfy_workflow", "comfy_custom"].includes(n.type) &&
          n.data.params.result_kind === "audio"),
    );
    const audioUrls = new Set(
      audioNodes.map((n) =>
        String(n.data.params[n.type === "audio" ? "url" : "result_url"] || ""),
      ),
    );
    const removedLastAudio =
      previous.nodes.some(
        (n) =>
          n.type === "audio" ||
          n.type === "ai_music" ||
          localAudioTypes.has(n.type),
      ) && !audioNodes.length;
    if (
      switched ||
      removedLastAudio ||
      (this.audioUrl && !audioUrls.has(this.audioUrl))
    )
      this.stopAudio();
    for (const id of this.frames.keys())
      if (switched || !ids.has(id)) this.frames.delete(id);
    for (const [id, entry] of this.scenes)
      if (switched || !ids.has(id)) {
        if (entry.ownsResources) this.releaseObject(entry.object);
        this.scenes.delete(id);
      }
    for (const [url, media] of this.images)
      if (!imageUrls.has(url)) {
        this.releaseMedia(media);
        this.images.delete(url);
      }
    for (const [url, model] of this.modelLoads)
      if (!modelUrls.has(url)) {
        this.releaseObject(model);
        this.modelLoads.delete(url);
        forgetSceneModel(url);
      }
    for (const url of this.loadingModels.keys())
      if (!modelUrls.has(url)) this.loadingModels.delete(url);
    for (const url of this.modelRetryAt.keys())
      if (!modelUrls.has(url)) this.modelRetryAt.delete(url);
    for (const key of this.errors.keys())
      if (
        switched ||
        (!ids.has(key) &&
          !imageUrls.has(key) &&
          !modelUrls.has(key) &&
          key !== "__audio")
      )
        this.errors.delete(key);
    this.values.clear();
  }
  private canvas(id: string) {
    let c = this.frames.get(id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      this.frames.set(id, c);
    }
    return c;
  }
  private image(url: string) {
    if (!url) return undefined;
    const old = this.images.get(url);
    if (old) return old;
    if (
      /\.(mp4|webm|mov)([?#]|$)/i.test(url) ||
      url.startsWith("data:video/")
    ) {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.src = url;
      if (this.playing)
        void v.play().catch(() => {
          if (this.playing && this.images.get(url) === v)
            this.errors.set(url, "视频未能播放，请检查格式");
        });
      v.onloadeddata = () => {
        this.revision++;
        this.errors.delete(url);
      };
      v.onerror = () => {
        this.errors.set(url, "视频加载失败");
        this.revision++;
      };
      this.images.set(url, v);
      return v;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      this.revision++;
      this.errors.delete(url);
    };
    img.onerror = () => {
      this.errors.set(url, "图片加载失败：检查地址或跨域权限");
      this.revision++;
    };
    this.images.set(url, img);
    return img;
  }
  async microphone() {
    this.stopAudio();
    const generation = this.audioGeneration;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.disposed || generation !== this.audioGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("音频请求已取消");
    }
    this.stream = stream;
    try {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.context.createMediaStreamSource(stream).connect(this.analyser);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = this.playing;
      });
      if (this.playing) await this.context.resume();
      else await this.context.suspend();
      if (generation !== this.audioGeneration)
        throw new Error("音频请求已取消");
    } catch (error) {
      if (generation === this.audioGeneration) this.stopAudio();
      throw error;
    }
  }
  async playAudio(url: string) {
    if (!url) throw new Error("音频地址为空");
    this.stopAudio();
    const generation = this.audioGeneration;
    this.audioUrl = url;
    try {
      const context = new AudioContext();
      this.context = context;
      const audio = new Audio(url);
      this.audioEl = audio;
      audio.crossOrigin = "anonymous";
      audio.loop = true;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      context.createMediaElementSource(audio).connect(this.analyser);
      this.analyser.connect(context.destination);
      if (this.playing) {
        // Request both while the initiating user gesture is still available.
        // A suspended/output-blocked AudioContext must not delay media.play().
        await Promise.all([context.resume(), audio.play()]);
        if (generation !== this.audioGeneration)
          throw new Error("音频请求已取消");
        if (!this.playing) audio.pause();
      } else await context.suspend();
    } catch (error) {
      if (
        generation === this.audioGeneration &&
        !this.playing &&
        error instanceof DOMException &&
        error.name === "AbortError"
      )
        return;
      if (generation === this.audioGeneration) this.stopAudio();
      throw error;
    }
  }
  stopAudio() {
    this.audioGeneration++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.removeAttribute("src");
      this.audioEl.load();
      this.audioEl = undefined;
    }
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.context = undefined;
    this.analyser = undefined;
    this.audioUrl = "";
    this.audioLevel = 0;
    this.frequencies.fill(0);
    this.errors.delete("__audio");
  }
  get hasAudio() {
    return Boolean(this.context);
  }
  setPlaying(playing: boolean) {
    this.playing = playing;
    this.performance.setPlaying(playing);
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = playing;
    });
    for (const [url, el] of this.images)
      if (el instanceof HTMLVideoElement) {
        if (playing)
          void el.play().catch(() => {
            if (this.playing && this.images.get(url) === el)
              this.errors.set(url, "视频未能播放，请检查格式");
          });
        else el.pause();
      }
    const context = this.context,
      generation = this.audioGeneration,
      audio = this.audioEl;
    if (!context || context.state === "closed") return;
    if (!playing) {
      audio?.pause();
      void context.suspend().catch(() => {});
    } else
      void context
        .resume()
        .then(async () => {
          if (this.playing && generation === this.audioGeneration)
            await audio?.play();
        })
        .catch(() => {
          if (this.playing && generation === this.audioGeneration)
            this.errors.set("__audio", "音频未能恢复，请重新点击播放音频");
        });
  }
  render(time: number, previewId?: string): HTMLCanvasElement {
    if (previewId) previewId = this.resolveId(previewId);
    if (time < this.lastTime) {
      // A seek resets temporal operators while retaining immutable surface
      // samples and GPU buffers, so the audio clock can resume immediately.
      for (const [id, state] of this.operatorStates) {
        if (state.has("cloud_key") || state.has("point_stage")) continue;
        this.releaseState(state);
        this.operatorStates.delete(id);
      }
    }
    this.lastTime = time;
    this.values.clear();
    if (this.playing && this.analyser) {
      this.analyser.getByteFrequencyData(
        this.frequencies as Uint8Array<ArrayBuffer>,
      );
      this.audioLevel =
        this.frequencies.reduce((a, b) => a + b, 0) /
        this.frequencies.length /
        255;
    }
    const visiting = new Set<string>();
    const evalNode = (id: string): Value => {
      const cached = this.values.get(id);
      if (cached !== undefined) return cached;
      if (visiting.has(id)) {
        this.errors.set(id, "检测到循环连接");
        return 0;
      }
      visiting.add(id);
      const n = this.project.nodes.find((n) => n.id === id);
      if (!n) {
        visiting.delete(id);
        return 0;
      }
      const inp = (handle = "in") => {
        const e = this.project.edges.find(
          (e) =>
            e.target === id &&
            (e.targetHandle || byType[n.type]?.inputs[0]?.id || "in") ===
              handle,
        );
        if (!e) return undefined;
        const value = evalNode(e.source);
        if (this.errors.has(e.source))
          throw new Error(`上游节点执行失败：${this.errors.get(e.source)}`);
        return value;
      };
      let result: Value = 0;
      try {
        result = this.cook(n, networkTime(time, n.data.params), inp, (path) =>
          evalNode(
            operatorPath(
              n.id.includes("/")
                ? n.id.slice(0, n.id.lastIndexOf("/") + 1)
                : "",
              path,
            ),
          ),
        );
        if (typeof result === "number" && !Number.isFinite(result))
          throw new Error("运算结果不是有限数值");
        this.errors.delete(id);
      } catch (e) {
        this.errors.set(id, e instanceof Error ? e.message : String(e));
        result = this.canvas(id);
      }
      visiting.delete(id);
      this.values.set(id, result);
      return result;
    };
    for (const n of this.project.nodes) evalNode(n.id);
    const visibleNodes = this.project.nodes.filter(
      (n) => n.id.split("/").slice(0, -1).join("/") === this.viewPath.join("/"),
    );
    const target =
      (previewId && this.project.nodes.some((n) => n.id === previewId)
        ? previewId
        : undefined) ||
      visibleNodes.find(
        (n) => n.type === "output" || n.type.startsWith("network_out_"),
      )?.id ||
      visibleNodes[0]?.id;
    const v = target ? evalNode(target) : undefined;
    if (isCanvas(v)) return v;
    if (isGeometrySpec(v) || isMaterialSpec(v) || isSceneSpec(v)) {
      const canvas = this.canvas("__value");
      const ctx = canvas.getContext("2d")!;
      const scene: SceneSpec = isSceneSpec(v)
        ? v
        : {
            kind: "scene",
            objects: [
              {
                geometry: isGeometrySpec(v)
                  ? v
                  : { shape: "sphere", detail: 32 },
                material: isMaterialSpec(v) ? v : undefined,
              },
            ],
            lights: [
              {
                type: "ambient",
                color: "#ffffff",
                intensity: 1,
                position: [0, 0, 0],
              },
              {
                type: "directional",
                color: "#ffffff",
                intensity: 3,
                position: [3, 4, 5],
              },
            ],
          };
      try {
        this.drawScene("__value", scene, ctx);
        return canvas;
      } catch (error) {
        this.errors.set("__value", String(error));
      }
    }
    const c = this.canvas("__empty");
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#101116";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#727682";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      isChannelBuffer(v)
        ? `${v.channels.length} 通道 × ${v.channels[0]?.samples.length || 0} 样本 · ${v.sampleRate} Hz`
        : isTableData(v)
          ? `${v.rows.length} 行 · ${v.rows[0]?.join(" | ").slice(0, 65) || "空表"}`
          : typeof v === "number"
            ? `信号值  ${v.toFixed(3)}`
            : typeof v === "string"
              ? v.slice(0, 55)
              : "连接节点，开始创作",
      W / 2,
      H / 2,
    );
    return c;
  }
  async activateMedia(id: string) {
    const fullId = this.resolveId(id),
      node = this.project.nodes.find((n) => n.id === fullId);
    if (!node) throw new Error("节点不存在");
    const input = this.project.edges.find(
      (e) => e.target === fullId && (e.targetHandle || "in") === "in",
    );
    const result = await this.mediaRuntime.activate(
      this.localAudioNode(node),
      input ? this.values.get(input.source) : undefined,
    );
    this.revision++;
    this.frames.delete(fullId);
    return result;
  }
  async startPerformance(id: string) {
    this.stopAudio();
    const fullId = this.resolveId(id),
      node = this.project.nodes.find((n) => n.id === fullId);
    if (!node) throw new Error("声景舞台不存在");
    await this.performance.prepare(
      this.project,
      fullId,
      Number(node.data.params.volume ?? 0.65),
    );
    this.playing = true;
    this.revision++;
    return this.performance.status;
  }
  exportPerformancePoints(id: string) {
    const fullId = this.resolveId(id),
      edge = this.project.edges.find(
        (e) =>
          e.target === fullId && (!e.targetHandle || e.targetHandle === "in"),
      );
    const value = this.values.get(edge?.source || fullId);
    if (!isGeometrySpec(value)) throw new Error("点云尚未就绪");
    return pointCloudPLY(value as PointCloudSpec);
  }
  private localAudioNode(node: GraphNode): GraphNode {
    if (
      !localAudioTypes.has(node.type) &&
      !(
        ["comfy_workflow", "comfy_custom"].includes(node.type) &&
        node.data.params.result_kind === "audio"
      )
    )
      return node;
    return {
      ...node,
      type: "media_audio_file_in",
      data: {
        ...node.data,
        params: {
          ...node.data.params,
          url: String(node.data.params.result_url || ""),
          samples: 1024,
          loop: true,
          speed: 1,
          offset: 0,
        },
      },
    };
  }
  async runPython(id: string, time: number) {
    const fullId = this.resolveId(id),
      node = this.project.nodes.find((n) => n.id === fullId);
    if (!node || !node.type.startsWith("python_script_"))
      throw new Error("Python 节点不存在");
    const inputs: Record<string, unknown> = {};
    for (const edge of this.project.edges.filter((e) => e.target === fullId)) {
      const value = this.values.get(edge.source);
      if (isCanvas(value)) {
        const bytes = value
          .getContext("2d")!
          .getImageData(0, 0, value.width, value.height).data;
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        inputs[edge.targetHandle || "in"] = {
          kind: "image",
          width: value.width,
          height: value.height,
          rgba: btoa(binary),
        };
      } else inputs[edge.targetHandle || "in"] = value ?? null;
    }
    const state = this.state(fullId),
      code = String(node.data.params.code || "");
    const intent = await api<{ token: string }>(
      "/scripts/intent",
      undefined,
      "POST",
    );
    const result = await api<{
      value:
        Value | { kind: "image"; width: number; height: number; rgba: string };
      log: string;
    }>("/scripts/run", { code, inputs, time }, "POST", {
      "X-TD-Script-Intent": intent.token,
    });
    if (this.disposed || this.operatorStates.get(fullId) !== state)
      throw new Error("节点已更改，已丢弃旧脚本结果");
    let value: Value;
    if (
      result.value &&
      typeof result.value === "object" &&
      "kind" in result.value &&
      result.value.kind === "image"
    ) {
      const image = result.value,
        w = Math.floor(image.width),
        h = Math.floor(image.height);
      if (w < 1 || h < 1 || w * h > 4194304)
        throw new Error("脚本图像尺寸无效或超过 4096K 像素");
      const bytes = Uint8ClampedArray.from(atob(image.rgba), (c) =>
        c.charCodeAt(0),
      );
      if (bytes.length !== w * h * 4) throw new Error("RGBA 图像长度不匹配");
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.putImageData(new ImageData(bytes, w, h), 0, 0);
      value = canvas;
    } else if (
      isChannelBuffer(result.value) ||
      isTableData(result.value) ||
      isGeometrySpec(result.value) ||
      typeof result.value === "number" ||
      typeof result.value === "string"
    )
      value = result.value;
    else
      throw new Error("脚本结果必须是通道、表格、网格、RGBA 图像、数字或文本");
    state.set("python_result", value);
    state.set("python_log", result.log);
    this.errors.delete(fullId);
    this.revision++;
    return result.log;
  }
  private cook(
    n: GraphNode,
    time: number,
    rawInput: (handle?: string) => Value | undefined,
    resolveNode: (path: string) => Value,
  ): Value {
    const state = this.state(n.id);
    const performanceTime = this.performance.status.ready
      ? this.performance.time
      : time;
    if (n.type === "stem_track_chop")
      return this.performance.samples(this.project, n, performanceTime);
    if (n.type === "audio_envelope_chop")
      return cookEnvelope(
        n,
        rawInput(),
        performanceTime,
        state,
        this.performance.reference(this.project, n),
      );
    if (n.type === "model_to_pointcloud_sop") {
      const source = rawInput();
      if (!isGeometrySpec(source) || (!source.url && !source.mesh))
        return {
          shape: "mesh",
          detail: 1,
          pointCloud: true,
          mesh: { positions: [], faces: [] },
        } as PointCloudSpec;
      if (source.url && !resolveSceneModel(source.url)) {
        this.loadModel(source.url);
        return {
          shape: "mesh",
          detail: 1,
          pointCloud: true,
          mesh: { positions: [], faces: [] },
        } as PointCloudSpec;
      }
      const key = JSON.stringify([source, n.data.params]);
      if (state.get("cloud_key") !== key) {
        state.set(
          "cloud",
          sampleSurface(
            source,
            Math.floor(Number(n.data.params.count) || 28000),
            Number(n.data.params.seed) || 41,
            Number(n.data.params.height) || 2.7,
          ),
        );
        state.set("cloud_key", key);
      }
      return state.get("cloud") as PointCloudSpec;
    }
    if (n.type === "pointcloud_dance_sop")
      return danceSpec(n, rawInput(), rawInput, performanceTime);
    if (n.type === "pointcloud_stage_top") {
      if (!this.renderer) throw new Error("声景舞台需要 WebGL 2");
      const source = rawInput();
      const cloud = isGeometrySpec(source)
        ? (source as PointCloudSpec)
        : { shape: "mesh", detail: 1, mesh: { positions: [], faces: [] } };
      let stage = state.get("point_stage") as PointStage | undefined;
      if (!stage) {
        stage = new PointStage();
        state.set("point_stage", stage);
        state.set("dispose", () => stage!.dispose());
      }
      return stage.render(cloud, n, this.renderer);
    }
    if (n.type === "output") {
      const source = rawInput();
      if (source instanceof HTMLCanvasElement) {
        const canvas = this.canvas(n.id);
        if (canvas.width !== source.width || canvas.height !== source.height) {
          canvas.width = source.width;
          canvas.height = source.height;
        }
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0);
        return canvas;
      }
    }
    if (n.type === "web_render_top") {
      const url = state.get("web_url") as string | undefined;
      if (!url) throw new Error("点击捕获网页以加载页面");
      const img = this.image(url),
        c = this.canvas(n.id);
      if (img instanceof HTMLImageElement && img.complete)
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      return c;
    }
    if (n.type === "movie_file_out_top") return rawInput() ?? this.canvas(n.id);
    if (n.type.startsWith("python_script_")) {
      if (!state.has("python_result"))
        throw new Error("点击运行 Python 以执行脚本");
      return state.get("python_result") as Value;
    }
    if (
      localAudioTypes.has(n.type) &&
      (!n.data.params.result_url || !this.mediaRuntime.status(n.id).active)
    )
      return 0;
    const media = this.mediaRuntime.cook(
      this.localAudioNode(n),
      time,
      rawInput,
      state,
      {
        project: this.project,
        videoForNode: (id) => {
          const node = this.project.nodes.find((x) => x.id === id);
          const el = node
            ? this.image(
                String(
                  node.data.params.url || node.data.params.result_url || "",
                ),
              )
            : undefined;
          return el instanceof HTMLVideoElement ? el : undefined;
        },
      },
    );
    if (media.handled) return media.value;
    if (
      n.type.startsWith("comfy_") &&
      !(
        n.data.params.result_url &&
        ["image", "video", "audio", "3d"].includes(
          String(n.data.params.result_kind),
        )
      ) &&
      ![
        "comfy_save_image",
        "comfy_save_audio",
        "comfy_save_video",
        "comfy_save_mesh",
        "comfy_workflow",
      ].includes(n.type)
    )
      return String(
        n.data.params.result_text || "连接到 Comfy 保存节点后手动运行",
      );
    const io = cookIONode(n, time, rawInput, state);
    if (io.handled) return io.value;
    const channels = cookChannelDataNode(n, time, rawInput, state, {
      project: this.project,
    });
    if (channels.handled) return channels.value;
    const geometry = cookGeometryV2Node(n, time, rawInput, state);
    if (geometry.handled) {
      if (isGeometrySpec(geometry.value) && geometry.value.url)
        this.loadModel(geometry.value.url);
      return geometry.value;
    }
    const inp = (handle?: string): LegacyValue | undefined => {
      const value = rawInput(handle);
      return isChannelBuffer(value)
        ? scalarValue(value)
        : isTableData(value)
          ? textValue(value)
          : (value as LegacyValue | undefined);
    };
    const waveform =
      n.type === "browser_audio_device_in" && this.analyser
        ? new Float32Array(this.analyser.fftSize)
        : undefined;
    if (waveform) this.analyser?.getFloatTimeDomainData(waveform);
    const browser = this.browserInputs.cook(
      n,
      rawInput,
      this.project,
      waveform,
      this.context?.sampleRate,
      this.context?.currentTime,
    );
    if (browser.handled) return browser.value as Value;
    const component = cookComponentNode(n, time, rawInput, this.state(n.id));
    if (component.handled) return component.value as Value;
    const p = n.data.params;
    const v = (key: string, def = 0) => Number(p[key] ?? def);
    const s = (key: string, def = "") => String(p[key] ?? def);
    const type = n.type;
    const advancedData = cookAdvancedDataNode(n, time, inp, this.state(n.id));
    if (advancedData.handled) return advancedData.value;
    const dataResult = cookDataNode(n, time, inp, this.state(n.id));
    if (dataResult.handled) return dataResult.value;
    if (type === "lfo") {
      const phase = time * v("frequency", 0.3) + v("phase"),
        fraction = ((phase % 1) + 1) % 1;
      const waves: Record<string, number> = {
        sine: Math.sin(phase * Math.PI * 2),
        triangle: 1 - 4 * Math.abs(fraction - 0.5),
        square: fraction < 0.5 ? 1 : -1,
        saw: 2 * fraction - 1,
      };
      return (
        (waves[s("wave", "sine")] ?? waves.sine) * v("amplitude", 1) +
        v("offset")
      );
    }
    if (type === "constant") return v("value", 1);
    if (type === "audio" || type === "ai_music")
      return this.audioLevel * v("gain", 1);
    if (type === "math") {
      const a = Number(inp() ?? 0),
        b = Number(inp("in2") ?? v("value", 1));
      const operation = s("operation", "multiply");
      if (operation === "divide" && b === 0) throw new Error("不能除以零");
      const operations: Record<string, () => number> = {
        add: () => a + b,
        subtract: () => a - b,
        multiply: () => a * b,
        divide: () => a / b,
        min: () => Math.min(a, b),
        max: () => Math.max(a, b),
        clamp: () => clamp(a, 0, b),
      };
      if (!operations[operation]) throw new Error(`未知运算：${operation}`);
      return operations[operation]();
    }
    if (type === "geometry")
      return { shape: s("shape", "torus"), detail: v("detail", 32) };
    if (
      type === "ai_3d" ||
      localModelTypes.has(type) ||
      (["comfy_workflow", "comfy_custom"].includes(type) &&
        s("result_kind") === "3d")
    )
      return { shape: "model", detail: 32, url: s("result_url") };
    if (type === "ai_text" || type === "mcp_tool") return s("result_text");
    const c = this.canvas(n.id),
      ctx = c.getContext("2d")!;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0b0c12";
      ctx.fillRect(0, 0, W, H);
      const src = inp();
      const source = isCanvas(src) ? src : undefined;
      const mod = Number(inp("mod") ?? 0);
      const second = inp("in2");
      if (
        [
          cookCompatibilityTopNode,
          cookReferenceTopNode,
          cookAdvancedVisualNode,
          cookVisualNode,
        ].some((cook) =>
          cook({
            node: n.type === "glsl_comp" ? { ...n, type: "ref_top_glsl" } : n,
            ctx,
            canvas: c,
            rawInput: rawInput(),
            resolveNode,
            resolveRenderPass: (
              src: HTMLCanvasElement,
              pass: "color" | "depth" | "normal",
            ) => this.renderPass(src, pass),
            resolveImportedTexture: (path: string, name: string) =>
              this.importedTexture(resolveNode(path), name),
            input: source,
            input2: isCanvas(second) ? second : undefined,
            input3: isCanvas(inp("in3"))
              ? (inp("in3") as HTMLCanvasElement)
              : undefined,
            time,
            mod,
            width: W,
            height: H,
            state: this.state(n.id),
          }),
        )
      )
        return c;
      if (type === "noise") {
        if (this.renderer && this.noiseMaterial && this.noiseScene) {
          this.setGPUSize(NOISE_W, NOISE_H);
          const u = this.noiseMaterial.uniforms;
          u.uTime.value = time * v("speed", 0.25) + mod;
          u.uScale.value = v("scale", 3);
          u.uDetail.value = v("detail", 4);
          u.uSeed.value = v("seed", 1);
          this.renderer.render(this.noiseScene, this.noiseCamera);
          ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
        } else {
          const g = ctx.createLinearGradient(0, 0, W, H);
          g.addColorStop(0, "#29203e");
          g.addColorStop(0.5, "#9e67bc");
          g.addColorStop(1, "#e59a6d");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.strokeStyle = "#e2c0e9";
          ctx.lineWidth = 1;
          for (let j = 0; j < 55; j++) {
            ctx.beginPath();
            for (let x = 0; x < W; x += 5) {
              const y =
                j * 9 + Math.sin(x * 0.012 + time * v("speed") + j * 0.16) * 45;
              ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      } else if (type === "ramp") {
        const angle = (v("angle", 45) * Math.PI) / 180;
        const dx = (Math.cos(angle) * W) / 2,
          dy = (Math.sin(angle) * H) / 2;
        const g = ctx.createLinearGradient(
          W / 2 - dx,
          H / 2 - dy,
          W / 2 + dx,
          H / 2 + dy,
        );
        g.addColorStop(0, s("color1", "#9c6dff"));
        g.addColorStop(1, s("color2", "#ff9055"));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (type === "shape") {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = s("color", "#b696ff");
        const size = v("size", 0.35) * H;
        ctx.beginPath();
        if (s("shape") === "rectangle")
          ctx.rect(W / 2 - size, H / 2 - size, size * 2, size * 2);
        else ctx.arc(W / 2, H / 2, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === "text") {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = s("color", "#fff");
        ctx.font = `600 ${v("size", 64)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const text = typeof src === "string" ? src : s("text", "HELLO, FLOW");
        text
          .split("\n")
          .slice(0, 6)
          .forEach((line, i) =>
            ctx.fillText(line, W / 2, H / 2 + i * v("size", 64) * 1.2, W - 40),
          );
      } else if (
        type === "media" ||
        type === "ai_image" ||
        localImageTypes.has(type) ||
        (["comfy_workflow", "comfy_custom"].includes(type) &&
          ["image", "video"].includes(s("result_kind")))
      ) {
        const media = this.image(s(type === "media" ? "url" : "result_url"));
        const mw =
            media instanceof HTMLVideoElement
              ? media.videoWidth
              : media?.naturalWidth,
          mh =
            media instanceof HTMLVideoElement
              ? media.videoHeight
              : media?.naturalHeight;
        if (media && mw && mh) {
          const factor =
            s("fit") === "contain" || localImageTypes.has(type)
              ? Math.min(W / mw, H / mh)
              : Math.max(W / mw, H / mh);
          ctx.drawImage(
            media,
            (W - mw * factor) / 2,
            (H - mh * factor) / 2,
            mw * factor,
            mh * factor,
          );
        } else {
          ctx.textAlign = "center";
          ctx.fillStyle = "#9b94ad";
          ctx.font = "16px sans-serif";
          ctx.fillText(
            type !== "media"
              ? "配置 AI 服务并运行，生成画面"
              : "导入一张图片或一段视频",
            W / 2,
            H / 2,
          );
        }
      } else if (type === "color" && source) {
        ctx.filter = `hue-rotate(${v("hue")}deg) saturate(${v("saturation", 1.2)}) brightness(${v("brightness", 1.1)})`;
        ctx.drawImage(source, 0, 0);
      } else if (type === "blur" && source) {
        ctx.drawImage(source, 0, 0);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = clamp(v("glow", 0.5) / 2, 0, 1);
        ctx.filter = `blur(${v("radius", 8)}px)`;
        ctx.drawImage(source, 0, 0);
      } else if (type === "transform" && source) {
        ctx.translate(W / 2 + v("x") * W, H / 2 + v("y") * H);
        ctx.rotate(((v("rotate") + mod * 30) * Math.PI) / 180);
        ctx.scale(v("scale", 1), v("scale", 1));
        ctx.drawImage(source, -W / 2, -H / 2);
      } else if (type === "composite") {
        if (source) ctx.drawImage(source, 0, 0);
        const second = inp("in2");
        if (isCanvas(second)) {
          ctx.globalCompositeOperation = s(
            "mode",
            "screen",
          ) as GlobalCompositeOperation;
          ctx.globalAlpha = v("opacity", 0.7);
          ctx.drawImage(second, 0, 0);
        }
      } else if (type === "particles") {
        const count = clamp(v("count", 1600), 100, 6000),
          t = time * v("speed", 0.3),
          spread = v("spread", 1) * (1 + mod * 0.3);
        ctx.globalCompositeOperation = "lighter";
        const gradient = ctx.createRadialGradient(
          W / 2,
          H / 2,
          0,
          W / 2,
          H / 2,
          H * 0.6,
        );
        gradient.addColorStop(0, "#251a4822");
        gradient.addColorStop(1, "#251a4800");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < count; i++) {
          const a = i * 2.39996323 + t * 0.45;
          const band = Math.sin(i * 43.1) * 0.5 + 0.5;
          const radius = (95 + band * 32 + Math.sin(a * 3 + t) * 16) * spread;
          let x = Math.cos(a) * radius,
            y = Math.sin(a) * radius;
          const z = Math.sin(i * 4.11 + t) * 24;
          const yy = y * 0.5 + z * 0.8;
          const depth = 1 + y / 380;
          const xx = x * 1.6;
          const size = v("size", 2) * depth * (0.25 + band * 0.7);
          ctx.globalAlpha = 0.3 + band * 0.6;
          ctx.fillStyle = i % 9 === 0 ? "#f4bd97" : s("color", "#c1a2ff");
          ctx.beginPath();
          ctx.arc(W / 2 + xx, H / 2 + yy, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === "spectrum") {
        const count = clamp(v("bars", 64), 8, 128),
          gain = typeof src === "number" ? src : 0;
        ctx.fillStyle = "#bb9bfb";
        for (let i = 0; i < count; i++) {
          const h =
            (this.frequencies[Math.floor((i * 128) / count)] / 255) *
            H *
            0.75 *
            (gain > 0 ? 1 : 0);
          ctx.fillRect((i * W) / count + 2, H - h, W / count - 4, h);
        }
        if (!gain) {
          ctx.fillStyle = "#777581";
          ctx.font = "15px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("连接音频输入，并启用麦克风或播放音频", W / 2, H / 2);
        }
      } else if (type === "render") {
        const raw = rawInput();
        if (isSceneSpec(raw)) {
          this.drawScene(n.id, raw, ctx);
          return c;
        }
        const geo = isGeometrySpec(src) ? src : undefined;
        if (!geo) {
          ctx.fillStyle = "#777581";
          ctx.font = "15px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("连接几何体节点以开始渲染", W / 2, H / 2);
        } else if (this.renderer) {
          this.setGPUSize(W, H);
          const scene = this.geometryScene(
            n.id,
            geo,
            s("color", "#a888ff"),
            Boolean(p.wireframe),
          );
          scene.object.rotation.set(
            time * v("speed", 0.3) * 0.4 + mod * 0.1,
            time * v("speed", 0.3) * 0.7,
            Math.sin(time * 0.2) * 0.12,
          );
          this.renderer.render(scene.scene, this.camera);
          this.renderSources.set(c, {
            scene: scene.scene,
            camera: this.camera,
          });
          ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
        } else throw new Error("3D 渲染需要 WebGL 2");
      } else if (source) ctx.drawImage(source, 0, 0);
      return c;
    } finally {
      ctx.restore();
    }
  }
  private renderPass(
    source: HTMLCanvasElement,
    pass: "color" | "depth" | "normal",
  ): HTMLCanvasElement | undefined {
    if (pass === "color") return source;
    const cached = this.renderSources.get(source);
    if (!cached || !this.renderer) return undefined;
    const material =
      pass === "depth"
        ? new THREE.MeshDepthMaterial()
        : new THREE.MeshNormalMaterial();
    const previous = cached.scene.overrideMaterial;
    cached.scene.overrideMaterial = material;
    const canvas = this.canvas("__pass_" + pass);
    try {
      this.setGPUSize(W, H);
      this.renderer.render(cached.scene, cached.camera);
      canvas.getContext("2d")!.drawImage(this.renderer.domElement, 0, 0, W, H);
    } finally {
      cached.scene.overrideMaterial = previous;
      material.dispose();
    }
    return canvas;
  }
  private importedTexture(
    value: Value,
    name: string,
  ): HTMLCanvasElement | undefined {
    const urls: string[] = [];
    const collect = (g: GeometrySpec) => {
      if (g.url) urls.push(g.url);
      g.children?.forEach(collect);
    };
    if (isGeometrySpec(value)) collect(value);
    else if (isSceneSpec(value))
      value.objects.forEach((o) => collect(o.geometry));
    for (const url of urls) {
      let found: CanvasImageSource | undefined;
      this.modelLoads.get(url)?.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || found) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          const texture = (material as unknown as Record<string, unknown>)[
            name || "map"
          ];
          if (texture instanceof THREE.Texture && texture.image)
            found = texture.image as CanvasImageSource;
        }
      });
      if (found) {
        const canvas = this.canvas("__texture_" + url + name);
        canvas.getContext("2d")!.drawImage(found, 0, 0, W, H);
        return canvas;
      }
    }
    return undefined;
  }
  async captureWeb(id: string) {
    const fullId = this.resolveId(id),
      node = this.project.nodes.find((n) => n.id === fullId);
    if (!node) throw new Error("节点不存在");
    const state = this.state(fullId),
      p = node.data.params;
    const result = await api<{ image_url: string }>("/web-render/capture", {
      url: p.url,
      html: p.html,
      width: p.width,
      height: p.height,
      actions: JSON.parse(String(p.actions || "[]")),
    });
    if (this.disposed || this.operatorStates.get(fullId) !== state) return;
    state.set("web_url", result.image_url);
    this.image(result.image_url);
    this.revision++;
  }
  toggleMovie(id: string): boolean {
    const fullId = this.resolveId(id),
      state = this.state(fullId),
      old = state.get("recorder") as MediaRecorder | undefined;
    if (old?.state === "recording") {
      old.stop();
      state.delete("recorder");
      return false;
    }
    const node = this.project.nodes.find((n) => n.id === fullId),
      source = this.values.get(fullId);
    if (!isCanvas(source)) throw new Error("请先连接要录制的 TOP");
    const stream = source.captureStream(
      Math.max(1, Math.min(60, Number(node?.data.params.fps) || 30)),
    );
    const mime = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((x) => MediaRecorder.isTypeSupported(x));
    if (!mime) throw new Error("此浏览器不支持 WebM");
    const recorder = new MediaRecorder(stream, { mimeType: mime }),
      chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const form = new FormData();
      form.append(
        "file",
        new Blob(chunks, { type: "video/webm" }),
        "capture.webm",
      );
      void fetch("/api/artifacts", { method: "POST", body: form })
        .then(async (r) => {
          if (!r.ok) throw new Error("视频保存失败");
          const value = await r.json();
          state.set("movie_url", value.url);
          this.revision++;
        })
        .catch((error) => {
          if (!this.disposed) this.errors.set(fullId, String(error));
        });
    };
    recorder.start(1000);
    state.set("recorder", recorder);
    state.set("dispose", () => {
      if (recorder.state === "recording") recorder.stop();
    });
    return true;
  }
  private drawScene(
    id: string,
    spec: SceneSpec,
    ctx: CanvasRenderingContext2D,
  ) {
    if (!this.renderer) throw new Error("3D 渲染需要 WebGL 2");
    const urls: string[] = [];
    const collect = (g: GeometrySpec) => {
      if (g.url) {
        urls.push(g.url);
        this.loadModel(g.url);
      }
      g.children?.forEach(collect);
    };
    spec.objects.forEach((o) => collect(o.geometry));
    const key = JSON.stringify([
      spec,
      urls.map((url) => this.modelLoads.has(url)),
    ]);
    let cache = this.sceneFrames.get(id);
    if (!cache || cache.key !== key) {
      cache?.built.dispose();
      const built = buildScene(spec, W, H, (url) => {
        this.loadModel(url);
        return this.modelLoads.get(url);
      });
      cache = { key, built };
      this.sceneFrames.set(id, cache);
    }
    this.setGPUSize(W, H);
    this.renderer.render(cache.built.scene, cache.built.camera);
    this.renderSources.set(ctx.canvas, {
      scene: cache.built.scene,
      camera: cache.built.camera,
    });
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
  }
  private loadModel(url: string) {
    if (
      this.modelLoads.has(url) ||
      this.loadingModels.has(url) ||
      (this.modelRetryAt.get(url) || 0) > Date.now()
    )
      return;
    const token = Symbol(url);
    this.loadingModels.set(url, token);
    const loaded = (gltf: { scene: THREE.Group }) => {
      if (this.disposed || this.loadingModels.get(url) !== token) {
        this.releaseObject(gltf.scene);
        return;
      }
      this.loadingModels.delete(url);
      this.modelRetryAt.delete(url);
      this.errors.delete(url);
      const box = new THREE.Box3().setFromObject(gltf.scene),
        size = box.getSize(new THREE.Vector3()),
        center = box.getCenter(new THREE.Vector3());
      gltf.scene.position.sub(center);
      const group = new THREE.Group();
      group.add(gltf.scene);
      group.scale.setScalar(2.5 / Math.max(size.x, size.y, size.z, 0.001));
      this.modelLoads.set(url, group);
      registerSceneModel(url, group);
      this.revision++;
    };
    const failed = () => {
      if (this.disposed || this.loadingModels.get(url) !== token) return;
      this.loadingModels.delete(url);
      this.modelRetryAt.set(url, Date.now() + 10000);
      this.errors.set(
        url,
        "3D 模型加载失败，支持 glTF/GLB/FBX/OBJ，远程服务需允许跨域；10 秒后重试",
      );
    };
    if (/\.(fbx|obj)([?#]|$)/i.test(url))
      void loadSceneModel(url).then((scene) => loaded({ scene }), failed);
    else new GLTFLoader().load(url, loaded, undefined, failed);
  }
  private geometryScene(id: string, g: Geo, color: string, wireframe: boolean) {
    const urls: string[] = [];
    const collect = (spec: Geo) => {
      if (spec.url) {
        urls.push(spec.url);
        this.loadModel(spec.url);
      }
      for (const child of spec.children ?? []) collect(child);
    };
    collect(g);
    const key = JSON.stringify([
      g,
      color,
      wireframe,
      urls.map((url) => this.modelLoads.has(url)),
    ]);
    const existing = this.scenes.get(id);
    if (existing?.key === key) return existing;
    if (existing?.ownsResources) this.releaseObject(existing.object);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c0c14");
    const object = buildGeometryObject(g, color, wireframe, (url) =>
      this.modelLoads.get(url),
    );
    const ownsResources = true;
    scene.add(object);
    scene.add(new THREE.AmbientLight("#d7baff", 2));
    const light = new THREE.DirectionalLight("#c5b4ff", 4);
    light.position.set(2, 3, 4);
    scene.add(light);
    const back = new THREE.PointLight("#ff9c6a", 25);
    back.position.set(-3, -2, 2);
    scene.add(back);
    const item = { key, scene, object, ownsResources };
    this.scenes.set(id, item);
    return item;
  }
  private releaseMedia(media: HTMLImageElement | HTMLVideoElement) {
    media.onerror = null;
    if (media instanceof HTMLVideoElement) {
      media.onloadeddata = null;
      media.pause();
      media.removeAttribute("src");
      media.load();
    } else {
      media.onload = null;
      media.removeAttribute("src");
    }
  }
  private releaseObject(object: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    const visit = (o: THREE.Object3D) => {
      if (o.userData.tdBorrowedResources) return;
      if (
        o instanceof THREE.Mesh ||
        o instanceof THREE.LineSegments ||
        o instanceof THREE.Points
      ) {
        geometries.add(o.geometry);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const material of mats) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      }
      o.children.forEach(visit);
    };
    visit(object);
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
  }
  dispose() {
    this.performance.dispose();
    this.browserInputs.dispose();
    this.mediaRuntime.dispose();
    for (const entry of this.sceneFrames.values()) entry.built.dispose();
    this.sceneFrames.clear();
    this.disposed = true;
    this.stopAudio();
    this.images.forEach((media) => this.releaseMedia(media));
    this.images.clear();
    this.scenes.forEach((entry) => {
      if (entry.ownsResources) this.releaseObject(entry.object);
    });
    this.scenes.clear();
    this.modelLoads.forEach((model) => this.releaseObject(model));
    for (const url of this.modelLoads.keys()) forgetSceneModel(url);
    this.modelLoads.clear();
    this.loadingModels.clear();
    this.modelRetryAt.clear();
    this.noiseScene?.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.noiseMaterial?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.frames.clear();
    this.values.clear();
    this.clearStates();
    this.errors.clear();
  }
}
