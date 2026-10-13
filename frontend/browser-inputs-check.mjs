import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const frontend = import.meta.dirname,
  root = path.resolve(frontend, ".."),
  temp = path.join(root, ".cache/tmp"),
  artifacts = path.join(root, "data/artifacts");
await fs.mkdir(temp, { recursive: true });
await fs.mkdir(artifacts, { recursive: true });
const server = await createServer({
  root: frontend,
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { usePolling: true, interval: 1000 },
  },
  logLevel: "error",
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.TD_CHROMIUM,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage({
      viewport: { width: 1000, height: 600 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/browser-inputs-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Browser input lifecycle checks</title>",
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "browser-inputs-qa.html");
  const report = await page.evaluate(async () => {
    const { BrowserInputs } = await import("/src/nodes/browserRuntime.ts"),
      runtime = new BrowserInputs(),
      checks = [],
      project = { id: "qa", name: "qa", version: 1, nodes: [], edges: [] };
    const check = (name, condition) => {
      if (!condition) throw new Error(name);
      checks.push(name);
    };
    const node = (type, params = {}, id = type) => ({
      id,
      type: "browser_" + type,
      position: { x: 0, y: 0 },
      data: { label: type, params },
    });
    const cook = (type, params = {}, id = type) => {
      const result = runtime.cook(
        node(type, params, id),
        () => undefined,
        project,
      );
      if (!result.handled) throw new Error("Unhandled");
      return result.value;
    };
    const channel = (value, name) =>
      value.channels.find((ch) => ch.name === name)?.samples[0];
    const media = navigator.mediaDevices,
      originalEnumerate = media.enumerateDevices.bind(media),
      originalCapture = media.getUserMedia.bind(media),
      streams = [];
    try {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyW", key: "w" }),
      );
      check(
        "Real DOM keyboard events set channel state",
        channel(cook("keyboard_in", { keys: "KeyW" }), "KeyW") === 1,
      );
      window.dispatchEvent(new Event("blur"));
      check(
        "Window blur emits key release and clears channel",
        channel(cook("keyboard_in", { keys: "KeyW" }), "KeyW") === 0 &&
          cook("keyboard_dat").rows.at(-1)[3] === "0",
      );
      window.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "pen",
          isPrimary: true,
          clientX: 250,
          clientY: 150,
          pressure: 0.75,
          tiltX: 20,
          tiltY: -30,
          twist: 90,
          buttons: 1,
        }),
      );
      check(
        "PointerEvent tablet reports genuine pressure/tilt fields",
        channel(cook("tablet"), "pressure") === 0.75 &&
          channel(cook("tablet"), "tilty") === -30,
      );
      window.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: 1,
          pointerType: "pen",
          isPrimary: true,
          clientX: 250,
          clientY: 150,
          pressure: 0.75,
          buttons: 1,
        }),
      );
      check(
        "Cancelled pen contact resets pressure and buttons",
        channel(cook("tablet"), "pressure") === 0 &&
          channel(cook("mouse_in"), "lselect") === 0,
      );
      for (const id of [2, 3])
        window.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 2,
            clientX: id * 100,
            clientY: 200,
            pressure: 0.5,
            buttons: 1,
          }),
        );
      check(
        "Independent touch pointers remain distinct",
        cook("multi_touch_in").rows.length === 3,
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 3,
          pointerType: "touch",
          isPrimary: false,
          clientX: 300,
          clientY: 200,
          pressure: 0,
        }),
      );
      check(
        "Secondary touch release keeps primary pointer pressed",
        cook("multi_touch_in").rows.length === 2 &&
          channel(cook("mouse_in"), "lselect") === 1,
      );
      await runtime.refreshDevices();
      const devices = await originalEnumerate(),
        camera = devices.find((device) => device.kind === "videoinput");
      check(
        "Browser media enumeration exposes a video input",
        !!camera && cook("video_devices").rows.length > 1,
      );
      // Chromium supplies a synthetic camera, but the capture is a real MediaStream,
      // HTMLVideoElement and Canvas pipeline. Put it at index 1 to verify selection.
      media.enumerateDevices = async () => [
        {
          deviceId: "not-the-selected-camera",
          kind: "videoinput",
          label: "Other",
          groupId: "other",
        },
        ...devices,
      ];
      let selected;
      media.getUserMedia = async (constraints) => {
        selected = constraints;
        const stream = await originalCapture(constraints);
        streams.push(stream);
        return stream;
      };
      await runtime.capture("camera", false, 1);
      check(
        "Requested camera index resolves to exact deviceId",
        selected.video.deviceId.exact === camera.deviceId,
      );
      const canvas = cook("video_device_in", {}, "camera");
      const pixels = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let low = 255,
        high = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        low = Math.min(low, pixels[i]);
        high = Math.max(high, pixels[i]);
      }
      check(
        "Real synthetic-camera frames reach Canvas output",
        canvas.width > 0 && canvas.height > 0 && high - low > 10,
      );
      runtime.retain(new Set());
      check(
        "Removing camera node stops every real media track",
        streams[0].getTracks().every((track) => track.readyState === "ended"),
      );
      media.enumerateDevices = originalEnumerate;
      let pendingStream, release;
      media.getUserMedia = async (constraints) => {
        pendingStream = await originalCapture(constraints);
        await new Promise((resolve) => (release = resolve));
        return pendingStream;
      };
      const pending = runtime.capture("late", false, 0);
      for (let i = 0; i < 100 && !release; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!release) throw new Error("Delayed getUserMedia did not resolve");
      runtime.stop("late");
      release();
      await pending;
      check(
        "Late permission result is stopped after cancellation",
        pendingStream
          .getTracks()
          .every((track) => track.readyState === "ended"),
      );
      const microphone = runtime.cook(
        node("audio_device_in"),
        () => undefined,
        project,
        new Float32Array([0.5, -0.5]),
        44100,
        2,
      ).value;
      check(
        "Microphone buffers retain actual sample rate and sample origin",
        microphone.sampleRate === 44100 &&
          microphone.start === 88198 &&
          microphone.timeSlice === true,
      );
      runtime.dispose();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyW", key: "w" }),
      );
      check(
        "Disposal removes real browser event listeners",
        channel(cook("keyboard_in", { keys: "KeyW" }), "KeyW") === 0,
      );
      return {
        checks,
        camera: "Chromium synthetic media device",
        midi: "Device behavior tested with deterministic MIDI port mocks in browserRuntime.test.ts; no physical MIDI hardware tested",
      };
    } finally {
      runtime.dispose();
      media.getUserMedia = originalCapture;
      media.enumerateDevices = originalEnumerate;
      streams.forEach((stream) =>
        stream.getTracks().forEach((track) => track.stop()),
      );
    }
  });
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    path.join(artifacts, "browser-inputs-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { passed: report.checks.length, camera: report.camera },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
