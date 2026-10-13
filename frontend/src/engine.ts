import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GraphNode, Project } from "./types";
import { byType } from "./catalog";

import { cookVisualNode } from "./nodes/visual";
import { cookDataNode } from "./nodes/dataRuntime";
import { buildGeometryObject, type GeometrySpec } from "./nodes/geometry";
type Geo = GeometrySpec;
type Value = HTMLCanvasElement | number | string | Geo;
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
  revision = 0;
  frames = new Map<string, HTMLCanvasElement>();
  values = new Map<string, Value>();
  errors = new Map<string, string>();
  gpu = "Canvas 2D";
  audioLevel = 0;
  frequencies = new Uint8Array(128);
  private operatorStates = new Map<string, Map<string, unknown>>();
  private lastTime = 0;
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
    this.project = project;
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
  private setGPUSize(width: number, height: number) {
    if (
      this.renderer &&
      (this.renderer.domElement.width !== width ||
        this.renderer.domElement.height !== height)
    )
      this.renderer.setSize(width, height, false);
  }
  setProject(project: Project) {
    const previous = this.project;
    const switched = previous.id !== project.id;
    this.project = project;
    const ids = new Set(project.nodes.map((n) => n.id));
    for (const id of this.operatorStates.keys()) {
      const current = project.nodes.find((n) => n.id === id),
        old = previous.nodes.find((n) => n.id === id);
      if (
        switched ||
        !current ||
        current.type !== old?.type ||
        JSON.stringify(current.data.params) !==
          JSON.stringify(old?.data.params) ||
        JSON.stringify(project.edges.filter((e) => e.target === id)) !==
          JSON.stringify(previous.edges.filter((e) => e.target === id))
      )
        this.operatorStates.delete(id);
    }
    const imageUrls = new Set(
      project.nodes
        .filter((n) => n.type === "media" || n.type === "ai_image")
        .map((n) =>
          String(
            n.data.params[n.type === "media" ? "url" : "result_url"] || "",
          ),
        ),
    );
    const modelUrls = new Set(
      project.nodes
        .filter((n) => n.type === "ai_3d")
        .map((n) => String(n.data.params.result_url || "")),
    );
    const audioNodes = project.nodes.filter(
      (n) => n.type === "audio" || n.type === "ai_music",
    );
    const audioUrls = new Set(
      audioNodes.map((n) =>
        String(n.data.params[n.type === "audio" ? "url" : "result_url"] || ""),
      ),
    );
    const removedLastAudio =
      previous.nodes.some((n) => n.type === "audio" || n.type === "ai_music") &&
      !audioNodes.length;
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
        await context.resume();
        if (generation !== this.audioGeneration)
          throw new Error("音频请求已取消");
        if (this.playing) await audio.play();
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
    if (time < this.lastTime) this.operatorStates.clear();
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
        return e ? evalNode(e.source) : undefined;
      };
      let result: Value = 0;
      try {
        result = this.cook(n, time, inp);
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
    const target =
      (previewId && this.project.nodes.some((n) => n.id === previewId)
        ? previewId
        : undefined) ||
      this.project.nodes.find((n) => n.type === "output")?.id ||
      this.project.nodes[0]?.id;
    const v = target ? evalNode(target) : undefined;
    if (isCanvas(v)) return v;
    const c = this.canvas("__empty");
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#101116";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#727682";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      typeof v === "number"
        ? `信号值  ${v.toFixed(3)}`
        : typeof v === "string"
          ? v.slice(0, 55)
          : "连接节点，开始创作",
      W / 2,
      H / 2,
    );
    return c;
  }
  private cook(
    n: GraphNode,
    time: number,
    inp: (handle?: string) => Value | undefined,
  ): Value {
    const p = n.data.params;
    const v = (key: string, def = 0) => Number(p[key] ?? def);
    const s = (key: string, def = "") => String(p[key] ?? def);
    const type = n.type;
    const dataResult = cookDataNode(n, time, inp, this.state(n.id));
    if (dataResult.handled) return dataResult.value;
    if (type === "lfo")
      return (
        Math.sin(time * v("frequency", 0.3) * Math.PI * 2) * v("amplitude", 1) +
        v("offset")
      );
    if (type === "constant") return v("value", 1);
    if (type === "audio" || type === "ai_music")
      return this.audioLevel * v("gain", 1);
    if (type === "math") {
      const a = Number(inp() ?? 0),
        b = v("value", 1);
      return s("operation") === "add"
        ? a + b
        : s("operation") === "clamp"
          ? clamp(a, 0, b)
          : a * b;
    }
    if (type === "geometry")
      return { shape: s("shape", "torus"), detail: v("detail", 32) };
    if (type === "ai_3d")
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
        cookVisualNode({
          node: n,
          ctx,
          canvas: c,
          input: source,
          input2: isCanvas(second) ? second : undefined,
          time,
          mod,
          width: W,
          height: H,
          state: this.state(n.id),
        })
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
      } else if (type === "media" || type === "ai_image") {
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
            s("fit") === "contain"
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
            type === "ai_image"
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
        const geo =
          src && typeof src === "object" && !isCanvas(src)
            ? (src as Geo)
            : undefined;
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
          ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
        } else throw new Error("3D 渲染需要 WebGL 2");
      } else if (source) ctx.drawImage(source, 0, 0);
      return c;
    } finally {
      ctx.restore();
    }
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
    new GLTFLoader().load(
      url,
      (gltf) => {
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
        this.revision++;
      },
      undefined,
      () => {
        if (this.disposed || this.loadingModels.get(url) !== token) return;
        this.loadingModels.delete(url);
        this.modelRetryAt.set(url, Date.now() + 10000);
        this.errors.set(
          url,
          "3D 模型加载失败，仅支持 glTF/GLB，远程服务需允许跨域；10 秒后重试",
        );
      },
    );
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
      if (o instanceof THREE.Mesh) {
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
    this.disposed = true;
    this.stopAudio();
    this.images.forEach((media) => this.releaseMedia(media));
    this.images.clear();
    this.scenes.forEach((entry) => {
      if (entry.ownsResources) this.releaseObject(entry.object);
    });
    this.scenes.clear();
    this.modelLoads.forEach((model) => this.releaseObject(model));
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
    this.operatorStates.clear();
    this.errors.clear();
  }
}
