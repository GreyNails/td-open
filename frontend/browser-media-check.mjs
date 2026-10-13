import { chromium, expect as baseExpect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const base =
  process.env.TD_MEDIA_QA_URL ||
  process.env.TD_BASE_URL ||
  "http://127.0.0.1:8770";
const data = path.resolve(
  root,
  process.env.TD_MEDIA_QA_DATA_DIR || ".cache/media-qa",
);
const artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
await Promise.all(
  [data, artifacts, process.env.TMPDIR].map((p) =>
    fs.mkdir(p, { recursive: true }),
  ),
);
const expect = baseExpect.configure({ timeout: 20000 });
const checks = [],
  errors = [];
const mark = (name, extra = {}) => {
  checks.push({ name, passed: true, ...extra });
  console.log("PASS " + name);
};

function sineWave() {
  const rate = 22050,
    samples = rate * 8;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 3200),
      44 + i * 2,
    );
  return buffer;
}

function triangleGLB() {
  const vertices = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((v, i) =>
    vertices.writeFloatLE(v, i * 4),
  );
  const scene = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0.25, 0.5, 1],
          metallicFactor: 0,
          roughnessFactor: 0.6,
        },
      },
    ],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(scene)),
    json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(json);
  const result = Buffer.alloc(12 + 8 + json.length + 8 + vertices.length);
  result.write("glTF");
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12);
  result.write("JSON", 16);
  json.copy(result, 20);
  result.writeUInt32LE(vertices.length, 20 + json.length);
  result.writeUInt32LE(0x004e4942, 24 + json.length);
  vertices.copy(result, 28 + json.length);
  return result;
}

const browser = await chromium.launch({
  executablePath: process.env.TD_CHROMIUM,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
  env: { ...process.env, TMPDIR: process.env.TMPDIR },
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.__mediaQA = {
    audio: [],
    video: [],
    contexts: [],
    recordings: [],
    microphoneRequests: 0,
  };
  window.MediaRecorder = new Proxy(window.MediaRecorder, {
    construct(target, args) {
      const recorder = Reflect.construct(target, args);
      const sample = {
        frames: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        error: null,
      };
      window.__mediaQA.recordings.push(sample);
      // Observe a cloned capture track: fixed wall-clock waits do not guarantee
      // frames on software-rendered/headless browsers under CPU load.
      const track = recorder.stream.getVideoTracks()[0].clone();
      const reader = new MediaStreamTrackProcessor({
        track,
      }).readable.getReader();
      let stopped = false;
      void (async () => {
        try {
          while (!stopped) {
            const { value: frame, done } = await reader.read();
            if (done) break;
            sample.firstTimestamp ??= frame.timestamp;
            sample.lastTimestamp = frame.timestamp;
            sample.frames++;
            frame.close();
          }
        } catch (e) {
          if (!stopped) sample.error = String(e);
        }
      })();
      recorder.addEventListener(
        "stop",
        () => {
          stopped = true;
          void reader.cancel();
          track.stop();
        },
        { once: true },
      );
      return recorder;
    },
  });
  window.Audio = new Proxy(window.Audio, {
    construct(target, args) {
      const audio = Reflect.construct(target, args);
      window.__mediaQA.audio.push(audio);
      return audio;
    },
  });
  window.AudioContext = new Proxy(window.AudioContext, {
    construct(target, args) {
      const context = Reflect.construct(target, args);
      window.__mediaQA.contexts.push(context);
      return context;
    },
  });
  const create = document.createElement.bind(document);
  document.createElement = (...args) => {
    const element = create(...args);
    if (String(args[0]).toLowerCase() === "video")
      window.__mediaQA.video.push(element);
    return element;
  };
  const getMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = (...args) => {
    window.__mediaQA.microphoneRequests++;
    return getMedia(...args);
  };
});
const snapshotAudio = () =>
  page.evaluate(() =>
    window.__mediaQA.audio.map((a) => ({
      src: a.src,
      paused: a.paused,
      time: a.currentTime,
      ready: a.readyState,
    })),
  );
const latestProject = async () => {
  const list = await (await page.request.get(base + "/api/projects")).json();
  return (await page.request.get(base + "/api/projects/" + list[0].id)).json();
};

try {
  const health = await (await page.request.get(base + "/api/health")).json();
  expect(path.resolve(health.data_dir)).toBe(data);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例作品", exact: true }).click();
  await page.getByRole("button", { name: /流光实验/ }).click();
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  const wav = sineWave();
  await fs.writeFile(path.join(data, "media-qa-sine.wav"), wav);
  await page
    .locator('input[type=file][accept="image/*,video/*,audio/*"]')
    .setInputFiles({
      name: "media-qa-sine.wav",
      mimeType: "audio/wav",
      buffer: wav,
    });
  await expect(
    page.locator(".studio-node").filter({ hasText: "media-qa-sine.wav" }),
  ).toHaveCount(1);
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  await expect
    .poll(async () =>
      (await snapshotAudio()).some(
        (a) => !a.paused && a.ready >= 2 && a.time > 0.05,
      ),
    )
    .toBe(true);
  const saved = await latestProject(),
    audioNode = saved.nodes.find((n) => n.type === "audio");
  expect(audioNode.data.params.url).toMatch(/^\/api\/assets\/[a-f0-9]+\.wav$/);
  const uploadedAudio = await page.request.get(
    base + audioNode.data.params.url,
  );
  expect(Buffer.compare(await uploadedAudio.body(), wav)).toBe(0);
  mark("real WAV UI upload plays and persists node asset URL", {
    bytes: wav.length,
    url: audioNode.data.params.url,
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  const reloaded = await latestProject();
  expect(
    reloaded.nodes.find((n) => n.id === audioNode.id).data.params.url,
  ).toBe(audioNode.data.params.url);
  await page.getByTitle("适应全部节点").click();
  await page
    .locator(".studio-node")
    .filter({ hasText: "media-qa-sine.wav" })
    .click();
  await page.getByRole("button", { name: "播放已导入音频" }).click();
  await expect
    .poll(async () =>
      (await snapshotAudio()).some((a) => !a.paused && a.time > 0.05),
    )
    .toBe(true);
  mark("saved WAV reload and manual playback");
  await page.getByTitle("暂停（空格）").click();
  await expect
    .poll(async () => (await snapshotAudio()).at(-1)?.paused)
    .toBe(true);
  await page.waitForTimeout(200);
  const frozen = (await snapshotAudio()).at(-1).time;
  await page.waitForTimeout(500);
  expect(Math.abs((await snapshotAudio()).at(-1).time - frozen)).toBeLessThan(
    0.02,
  );
  expect(
    await page.evaluate(() => window.__mediaQA.contexts.at(-1).state),
  ).toBe("suspended");
  await page.getByTitle("播放（空格）").click();
  await expect
    .poll(async () => (await snapshotAudio()).at(-1).time)
    .toBeGreaterThan(frozen + 0.1);
  mark(
    "pause freezes audio media time and suspends AudioContext; resume advances",
  );

  await page.getByTitle("录制画面 WebM").click();
  await expect(page.getByTitle("停止录制")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const sample = window.__mediaQA.recordings.at(-1);
          return (
            sample &&
            sample.frames >= 3 &&
            sample.lastTimestamp - sample.firstTimestamp >= 800000
          );
        }),
      {
        timeout: 45000,
        message:
          "canvas recording receives at least three frames spanning 0.8 seconds",
      },
    )
    .toBe(true);
  const recordingFrames = await page.evaluate(() =>
    window.__mediaQA.recordings.at(-1),
  );
  const exportResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/artifacts") && r.request().method() === "POST",
  );
  await page.getByTitle("停止录制").click();
  const exported = await (await exportResponse).json();
  expect(exported.url).toMatch(/^\/api\/exports\/[a-f0-9]+\.webm$/);
  const webm = await fs.readFile(
    path.join(data, "exports", exported.url.split("/").pop()),
  );
  expect(webm.length).toBeGreaterThan(1000);
  expect(webm.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  mark(
    "real canvas WebM recording persists valid EBML bytes to isolated exports",
    { bytes: webm.length, url: exported.url, recordingFrames },
  );
  await page
    .locator('input[type=file][accept="image/*,video/*,audio/*"]')
    .setInputFiles({
      name: "media-qa-recording.webm",
      mimeType: "video/webm",
      buffer: webm,
    });
  await expect(page.locator(".preview-title")).toContainText(
    "media-qa-recording.webm",
  );
  await expect(page.locator(".save-state")).toHaveText("已自动保存");
  const videoProject = await latestProject();
  const videoAsset = videoProject.nodes.find(
    (n) => n.data.label === "media-qa-recording.webm",
  ).data.params.url;
  const videoURL = new URL(videoAsset, base).href;
  const snapshotVideo = () =>
    page.evaluate((url) => {
      const v = window.__mediaQA.video.find((video) => video.src === url);
      return v
        ? {
            src: v.src,
            time: v.currentTime,
            paused: v.paused,
            ready: v.readyState,
            duration: v.duration,
            error: v.error?.message,
          }
        : null;
    }, videoURL);
  await expect
    .poll(async () => {
      const video = await snapshotVideo();
      return video && video.ready >= 2 && !video.paused && video.time > 0.05;
    })
    .toBe(true);
  await page.getByTitle("暂停（空格）").click();
  await expect.poll(async () => (await snapshotVideo())?.paused).toBe(true);
  await page.waitForTimeout(200);
  const videoTime = (await snapshotVideo()).time;
  await page.waitForTimeout(400);
  expect(Math.abs((await snapshotVideo()).time - videoTime)).toBeLessThan(0.02);
  await page.screenshot({
    path: path.join(artifacts, "media-qa-paused-video.png"),
  });
  mark("recorded WebM reimports, decodes, plays and freezes while paused");

  const glb = triangleGLB();
  await fs.writeFile(path.join(data, "media-qa-triangle.glb"), glb);
  const uploadedModel = await (
    await page.request.post(base + "/api/upload", {
      multipart: {
        file: {
          name: "media-qa-triangle.glb",
          mimeType: "model/gltf-binary",
          buffer: glb,
        },
      },
    })
  ).json();
  let modelGets = 0;
  page.on("request", (r) => {
    if (r.url() === base + uploadedModel.url && r.method() === "GET")
      modelGets++;
  });
  const node = (id, type, x, params) => ({
    id,
    type,
    position: { x, y: 180 },
    data: { label: id, params },
  });
  const scene = {
    id: "media_qa_glb",
    name: "Media QA GLB",
    version: 1,
    nodes: [
      node("model", "ai_3d", 0, { result_url: uploadedModel.url }),
      node("render", "render", 260, {
        color: "#ff5588",
        wireframe: false,
        speed: 0.3,
      }),
      node("output", "output", 520, {}),
    ],
    edges: [
      {
        id: "model-render",
        source: "model",
        target: "render",
        sourceHandle: "out",
        targetHandle: "in",
      },
      {
        id: "render-output",
        source: "render",
        target: "output",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ],
    settings: {},
  };
  const modelSave = await page.request.post(base + "/api/projects", {
    data: scene,
  });
  expect(modelSave.ok()).toBe(true);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("作品名称")).toHaveValue("Media QA GLB");
  await expect.poll(() => modelGets).toBe(1);
  await page.waitForTimeout(700);
  const pixels = await page
    .getByLabel("节点实时渲染画面")
    .evaluate((canvas) => {
      const bytes = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < bytes.length; i += 4)
        if (bytes[i] > 120 && bytes[i] > bytes[i + 1] * 1.2) colored++;
      return colored;
    });
  expect(pixels).toBeGreaterThan(100);
  await page.getByTitle("暂停（空格）").click();
  await page.locator(".studio-node").filter({ hasText: "render" }).click();
  await page.getByRole("spinbutton", { name: "旋转速度数值" }).fill("0.5");
  await page.getByRole("spinbutton", { name: "旋转速度数值" }).blur();
  await page.waitForTimeout(700);
  expect(modelGets).toBe(1);
  await page.screenshot({
    path: path.join(artifacts, "media-qa-glb-render.png"),
  });
  mark(
    "real GLB loads, produces colored rendered pixels and remains cached during parameter edits",
    { requests: modelGets, coloredPixels: pixels },
  );
  expect(await page.evaluate(() => window.__mediaQA.microphoneRequests)).toBe(
    0,
  );
  expect(errors).toEqual([]);
  mark("no real microphone request or browser JavaScript error");
} catch (error) {
  checks.push({ name: "failure", passed: false, message: error.message });
  console.error(error);
  await fs.writeFile(
    path.join(artifacts, "media-qa-debug.json"),
    JSON.stringify(
      await page.evaluate(() => ({
        recordings: window.__mediaQA.recordings,
        videos: window.__mediaQA.video.map((v) => ({
          src: v.src,
          duration: v.duration,
          paused: v.paused,
          time: v.currentTime,
          ready: v.readyState,
          error: v.error?.message,
        })),
      })),
      null,
      2,
    ),
  );
  await page.screenshot({
    path: path.join(artifacts, "media-qa-failure.png"),
    fullPage: true,
  });
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.join(artifacts, "media-qa-results.json"),
    JSON.stringify({ base, data, checks, errors }, null, 2),
  );
  await browser.close();
}
