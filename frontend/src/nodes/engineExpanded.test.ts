import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { StudioEngine } from "../engine";
import { makeNode } from "../catalog";
import { makeChannels } from "../runtimeValues";
import type { GraphNode, Params, Project } from "../types";

const gpu = vi.hoisted(() => ({ scenes: [] as unknown[], disposed: 0 }));
const loader = vi.hoisted(() => ({
  pending: new Map<string, (value: unknown) => void>(),
}));

// Keep real Three.js geometry, scene graph and resource ownership. Only the GPU
// boundary and DOM drawing surface are replaced; these tests exercise StudioEngine.
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {}
      setSize(width: number, height: number) {
        this.domElement.width = width;
        this.domElement.height = height;
      }
      setClearColor() {}
      render(scene: unknown) {
        gpu.scenes.push(scene);
      }
      dispose() {
        gpu.disposed++;
      }
      forceContextLoss() {}
    },
  };
});
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    load(url: string, onLoad: (result: unknown) => void) {
      loader.pending.set(url, onLoad);
    }
  },
}));

class TestCanvas {
  width = 640;
  height = 360;
  context = {
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
  };
  getContext() {
    return this.context;
  }
}
const engines: StudioEngine[] = [];
function create(
  nodes: GraphNode[],
  links: [GraphNode, GraphNode, string?][] = [],
): StudioEngine {
  const project: Project = {
    id: "integration",
    name: "integration",
    version: 1,
    nodes,
    edges: links.map(([source, target, targetHandle = "in"], i) => ({
      id: `edge_${i}`,
      source: source.id,
      target: target.id,
      sourceHandle: "out",
      targetHandle,
    })),
  };
  const engine = new StudioEngine(project);
  engines.push(engine);
  return engine;
}
function node(type: string, params: Params = {}) {
  const result = makeNode(type);
  result.data.params = { ...result.data.params, ...params };
  return result;
}
function withParams(engine: StudioEngine, id: string, params: Params) {
  engine.setProject({
    ...engine.project,
    nodes: engine.project.nodes.map((item) =>
      item.id === id
        ? {
            ...item,
            data: { ...item.data, params: { ...item.data.params, ...params } },
          }
        : item,
    ),
  });
}
function sceneMeshes() {
  const result: THREE.Mesh[] = [];
  const scene = gpu.scenes.at(-1) as THREE.Scene;
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) result.push(child);
  });
  return result;
}
beforeEach(() => {
  gpu.scenes.length = 0;
  gpu.disposed = 0;
  loader.pending.clear();
  vi.stubGlobal("HTMLCanvasElement", TestCanvas);
  vi.stubGlobal("document", { createElement: () => new TestCanvas() });
});
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("expanded StudioEngine pipelines", () => {
  async function activeDeviceResources() {
    const camera = node("browser_video_device_in"),
      audio = node("media_audio_play"),
      engine = create([camera, audio]);
    const track = Object.assign(new EventTarget(), {
      readyState: "live",
      stop: vi.fn(),
    });
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    };
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
    };
    const source = {
      playbackRate: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    vi.stubGlobal(
      "AudioContext",
      class {
        state = "running";
        destination = {};
        createGain = () => gain;
        createBufferSource = () => source;
        createBuffer(channels: number, length: number, sampleRate: number) {
          return {
            numberOfChannels: channels,
            length,
            sampleRate,
            duration: length / sampleRate,
            copyToChannel: vi.fn(),
          };
        }
        close = vi.fn(async () => undefined);
      },
    );
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => []),
        getUserMedia: vi.fn(async () => stream),
      },
    });
    vi.stubGlobal("document", {
      createElement: (tag: string) =>
        tag === "video" ? video : new TestCanvas(),
    });
    await engine.browserInputs.capture(camera.id);
    await engine.mediaRuntime.activate(
      audio,
      makeChannels({ mono: [0, 1, 0] }),
    );
    expect(engine.mediaRuntime.status(audio.id).active).toBe(true);
    expect(source.start).toHaveBeenCalledOnce();
    expect(video.srcObject).toBe(stream);
    return { engine, camera, audio, track, video, source, gain };
  }

  it("releases active camera and audio on project switch even when node IDs and types are reused", async () => {
    const { engine, camera, audio, track, video, source, gain } =
      await activeDeviceResources();
    // Ordinary volume edits must preserve the active sources and permission grant.
    withParams(engine, audio.id, { volume: 0.25 });
    expect(track.stop).not.toHaveBeenCalled();
    expect(source.stop).not.toHaveBeenCalled();
    expect(engine.mediaRuntime.status(audio.id).active).toBe(true);
    engine.setProject({
      ...engine.project,
      id: "second-work-with-same-node-ids",
    });
    expect(engine.project.nodes.map((item) => item.id)).toEqual([
      camera.id,
      audio.id,
    ]);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
    expect(engine.mediaRuntime.status(audio.id).active).toBe(false);
    // Repeated project updates cannot stop or retain an already released source.
    engine.setProject({ ...engine.project, name: "renamed" });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("releases active resources when nodes are replaced with another type under the same IDs", async () => {
    const { engine, audio, track, source } = await activeDeviceResources();
    engine.setProject({
      ...engine.project,
      nodes: engine.project.nodes.map((item) => ({
        ...node("constant"),
        id: item.id,
      })),
    });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(engine.mediaRuntime.status(audio.id).active).toBe(false);
  });

  it("invalidates only the resource whose camera device or audio source changes", async () => {
    const { engine, camera, audio, track, source } =
      await activeDeviceResources();
    withParams(engine, camera.id, { device: 1 });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(source.stop).not.toHaveBeenCalled();
    expect(engine.mediaRuntime.status(audio.id).active).toBe(true);
    withParams(engine, audio.id, { url: "/another-recording.wav" });
    expect(source.stop).toHaveBeenCalledOnce();
    expect(engine.mediaRuntime.status(audio.id).active).toBe(false);
  });

  it("cancels pending capture permissions when switching to a project that reuses the camera ID", async () => {
    const camera = node("browser_video_device_in"),
      engine = create([camera]);
    let resolve!: (stream: unknown) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise<unknown>((yes) => {
          resolve = yes;
        }),
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const pending = engine.browserInputs.capture(camera.id);
    expect(getUserMedia).toHaveBeenCalledOnce();
    engine.setProject({ ...engine.project, id: "another-camera-project" });
    const stop = vi.fn();
    resolve({ getTracks: () => [{ stop }] });
    await pending;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("routes DAT transforms into the existing text TOP and output canvas", () => {
    const source = node("text_dat", { text: "hello 🌈" }),
      upper = node("case_text"),
      text = node("text"),
      out = node("output");
    // Reversed node order verifies dependency evaluation rather than array order.
    const engine = create(
      [out, text, upper, source],
      [
        [source, upper],
        [upper, text],
        [text, out],
      ],
    );
    const frame = engine.render(0) as unknown as TestCanvas;
    expect(engine.errors.size).toBe(0);
    expect(engine.values.get(upper.id)).toBe("HELLO 🌈");
    const textCanvas = engine.values.get(text.id) as unknown as TestCanvas;
    expect(textCanvas.context.fillText).toHaveBeenCalledWith(
      "HELLO 🌈",
      320,
      180,
      600,
    );
    expect(frame.context.drawImage).toHaveBeenCalledWith(textCanvas, 0, 0);
  });
  it("smooths changing upstream parameters without resetting downstream memory", () => {
    const source = node("constant", { value: 0 }),
      range = node("range", { out_max: 1 }),
      lag = node("lag", { rise: 1 });
    const engine = create(
      [source, range, lag],
      [
        [source, range],
        [range, lag],
      ],
    );
    engine.render(0, lag.id);
    withParams(engine, source.id, { value: 1 });
    engine.render(1, lag.id);
    expect(engine.values.get(lag.id)).toBeCloseTo(1 - Math.exp(-1));
    expect(engine.errors.size).toBe(0);
    withParams(engine, lag.id, { rise: 0 });
    engine.render(2, lag.id);
    expect(engine.values.get(lag.id)).toBe(1);
  });
  it("evaluates a temporal node once per frame across fanout and resets on rewind", () => {
    const source = node("constant", { value: 2 }),
      speed = node("speed"),
      first = node("null_chop"),
      second = node("abs");
    const engine = create(
      [first, second, speed, source],
      [
        [source, speed],
        [speed, first],
        [speed, second],
      ],
    );
    engine.render(0);
    engine.render(1);
    expect(engine.values.get(first.id)).toBe(2);
    expect(engine.values.get(second.id)).toBe(2);
    engine.render(2);
    expect(engine.values.get(speed.id)).toBe(4);
    engine.render(0);
    expect(engine.values.get(speed.id)).toBe(0);
  });
  it("clears temporal state after changing connections, deleting nodes, and changing projects", () => {
    const source = node("constant", { value: 2 }),
      speed = node("speed", { initial: 10 }),
      other = node("constant", { value: 4 });
    const engine = create([source, speed, other], [[source, speed]]);
    engine.render(0);
    engine.render(1);
    expect(engine.values.get(speed.id)).toBe(12);
    engine.setProject({
      ...engine.project,
      edges: [{ ...engine.project.edges[0], source: other.id }],
    });
    engine.render(2);
    expect(engine.values.get(speed.id)).toBe(10);
    engine.render(3);
    expect(engine.values.get(speed.id)).toBe(14);
    const saved = engine.project;
    engine.setProject({ ...saved, nodes: [source, other], edges: [] });
    engine.setProject(saved);
    engine.render(4);
    expect(engine.values.get(speed.id)).toBe(10);
    engine.render(5);
    expect(engine.values.get(speed.id)).toBe(14);
    engine.setProject({ ...saved, id: "another-project" });
    engine.render(6);
    expect(engine.values.get(speed.id)).toBe(10);
  });
  it("reports malformed JSON on the responsible node and clears its error after correction", () => {
    const source = node("text_dat", { text: "broken" }),
      select = node("json_select", { path: "value" }),
      numeric = node("dat_to_chop");
    const engine = create(
      [numeric, select, source],
      [
        [source, select],
        [select, numeric],
      ],
    );
    engine.render(0);
    expect(engine.errors.get(select.id)).toContain("有效的 JSON");
    withParams(engine, source.id, { text: '{"value":42}' });
    engine.render(1);
    expect(engine.errors.size).toBe(0);
    expect(engine.values.get(numeric.id)).toBe(42);
  });
  it("propagates upstream failures through numeric branches and recovers without stopping independent nodes", () => {
    const source = node("constant", { value: -1 }),
      sqrt = node("function_chop", { function: "sqrt" }),
      sum = node("weighted_sum"),
      math = node("math"),
      independent = node("constant", { value: 42 });
    const engine = create(
      [math, sum, sqrt, source, independent],
      [
        [source, sqrt],
        [sqrt, sum],
        [sum, math],
      ],
    );
    engine.render(0);
    expect(engine.errors.has(sqrt.id)).toBe(true);
    expect(engine.errors.get(sum.id)).toContain("上游");
    expect(engine.errors.get(math.id)).toContain("上游");
    expect(engine.values.get(independent.id)).toBe(42);
    withParams(engine, source.id, { value: 4 });
    engine.render(1);
    expect(engine.errors.size).toBe(0);
    expect(engine.values.get(math.id)).toBe(2);
    withParams(engine, math.id, { operation: "divide", value: 0 });
    engine.render(2);
    expect(engine.errors.get(math.id)).toContain("零");
  });
  it("supports LFO phase and four waveform modes and math second-port operands", () => {
    const oscillator = node("lfo", {
        wave: "triangle",
        phase: 0.25,
        frequency: 1,
        amplitude: 2,
        offset: 1,
      }),
      a = node("constant", { value: 12 }),
      b = node("constant", { value: 3 }),
      math = node("math", { operation: "divide", value: 99 });
    const engine = create(
      [oscillator, a, b, math],
      [
        [a, math],
        [b, math, "in2"],
      ],
    );
    engine.render(0);
    expect(engine.values.get(oscillator.id)).toBe(1);
    expect(engine.values.get(math.id)).toBe(4);
    for (const [wave, expected] of [
      ["sine", 3],
      ["square", 3],
      ["saw", 0],
    ] as const) {
      withParams(engine, oscillator.id, { wave });
      engine.render(0);
      expect(engine.values.get(oscillator.id)).toBeCloseTo(expected);
    }
  });
  it("marks non-finite scalar results as errors", () => {
    const a = node("constant", { value: 1e308 }),
      math = node("math", { value: 10 });
    const engine = create([a, math], [[a, math]]);
    engine.render(0);
    expect(engine.errors.get(math.id)).toContain("有限");
  });
  it("renders merged transformed primitives while retaining a cached scene until geometry changes", () => {
    const box = node("box"),
      move = node("transform_sop", { x: 1, sx: 0.5 }),
      sphere = node("sphere"),
      merge = node("merge_sop"),
      render = node("render", { speed: 0 }),
      out = node("output");
    const engine = create(
      [out, render, merge, move, box, sphere],
      [
        [box, move],
        [move, merge],
        [sphere, merge, "in2"],
        [merge, render],
        [render, out],
      ],
    );
    engine.render(0);
    expect(engine.errors.size).toBe(0);
    const first = sceneMeshes();
    expect(first.map((mesh) => mesh.geometry.type)).toEqual([
      "BoxGeometry",
      "SphereGeometry",
    ]);
    const scene = gpu.scenes.at(-1) as THREE.Scene;
    scene.updateMatrixWorld(true);
    expect(first[0].getWorldPosition(new THREE.Vector3()).x).toBe(1);
    engine.render(0);
    expect(sceneMeshes()[0].geometry).toBe(first[0].geometry);
    const release = vi.spyOn(first[0].geometry, "dispose");
    withParams(engine, move.id, { x: 2 });
    engine.render(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(sceneMeshes()[0].geometry).not.toBe(first[0].geometry);
    engine.setProject({ ...engine.project, nodes: [], edges: [] });
    expect(engine.values.size).toBe(0);
  });
  it("loads nested GLB models and releases shared GPU resources only when the asset leaves the project", () => {
    const model = node("ai_3d", { result_url: "/model.glb" }),
      move = node("transform_sop", { x: 1 }),
      box = node("box"),
      merge = node("merge_sop"),
      render = node("render", { speed: 0 });
    const engine = create(
      [model, move, box, merge, render],
      [
        [model, move],
        [move, merge],
        [box, merge, "in2"],
        [merge, render],
      ],
    );
    engine.render(0, render.id);
    expect(loader.pending.has("/model.glb")).toBe(true);
    const geometry = new THREE.BoxGeometry(),
      texture = new THREE.Texture(),
      material = new THREE.MeshStandardMaterial({ map: texture });
    const cached = new THREE.Group();
    cached.add(new THREE.Mesh(geometry, material));
    const releaseGeometry = vi.spyOn(geometry, "dispose"),
      releaseMaterial = vi.spyOn(material, "dispose"),
      releaseTexture = vi.spyOn(texture, "dispose");
    loader.pending.get("/model.glb")!({ scene: cached });
    engine.render(0, render.id);
    expect(sceneMeshes()).toHaveLength(2);
    expect(sceneMeshes()[0].geometry).toBe(geometry);
    withParams(engine, move.id, { x: 2 });
    engine.render(0, render.id);
    expect(releaseGeometry).not.toHaveBeenCalled();
    expect(releaseMaterial).not.toHaveBeenCalled();
    expect(releaseTexture).not.toHaveBeenCalled();
    engine.setProject({
      ...engine.project,
      nodes: engine.project.nodes.filter((item) => item.id !== model.id),
      edges: engine.project.edges.filter((edge) => edge.source !== model.id),
    });
    expect(releaseGeometry).toHaveBeenCalledTimes(1);
    expect(releaseMaterial).toHaveBeenCalledTimes(1);
    expect(releaseTexture).toHaveBeenCalledTimes(1);
    engine.render(0, render.id);
    expect(sceneMeshes()).toHaveLength(1);
    expect(releaseGeometry).toHaveBeenCalledTimes(1);
  });
});
