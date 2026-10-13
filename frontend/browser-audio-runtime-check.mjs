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
      "--autoplay-policy=no-user-gesture-required",
      "--disable-audio-output",
    ],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/audio-runtime-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Real Web Audio runtime checks</title>",
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "audio-runtime-qa.html");
  const report = await page.evaluate(async () => {
    const { MediaRuntime, encodeWAV } =
        await import("/src/nodes/mediaRuntime.ts"),
      { mediaCatalog } = await import("/src/nodes/mediaCatalog.ts"),
      { makeChannels } = await import("/src/runtimeValues.ts");
    const options = {
      audioContextFactory: () => new AudioContext({ sinkId: { type: "none" } }),
    };
    const runtime = new MediaRuntime(options),
      receiver = new MediaRuntime(options),
      checks = [],
      urls = [];
    const check = (name, condition) => {
      if (!condition) throw new Error(name);
      checks.push(name);
    };
    const node = (type, params = {}, id = type) => ({
      id,
      type,
      position: { x: 0, y: 0 },
      data: {
        label: type,
        params: {
          ...Object.fromEntries(
            mediaCatalog
              .find((spec) => spec.type === type)
              .params.map((p) => [p.key, p.default]),
          ),
          ...params,
        },
      },
    });
    const pcm = makeChannels(
      {
        left: Array.from(
          { length: 16384 },
          (_, i) => Math.sin((i * Math.PI * 2 * 1000) / 48000) * 0.5,
        ),
        right: Array.from(
          { length: 16384 },
          (_, i) => -Math.sin((i * Math.PI * 2 * 1000) / 48000) * 0.25,
        ),
      },
      48000,
    );
    const file = URL.createObjectURL(
      new Blob([encodeWAV(pcm)], { type: "audio/wav" }),
    );
    urls.push(file);
    try {
      let inactive = false;
      try {
        runtime.cook(
          node("media_audio_file_in", { url: file }),
          0,
          () => undefined,
        );
      } catch (error) {
        inactive = String(error).includes("启用媒体");
      }
      check("Audio files require explicit activation", inactive);
      const reader = node("media_audio_file_in", { url: file, samples: 128 });
      await runtime.activate(reader);
      const read = runtime.cook(reader, 0, () => undefined).value;
      check(
        "decodeAudioData creates real independent PCM channels",
        read.channels.length === 2 &&
          read.channels[0].samples.some((x) => Math.abs(x) > 0.45),
      );
      check(
        "Stereo phase and amplitudes survive WAV encode/decode",
        read.channels[0].samples.every(
          (x, i) => Math.abs(x + read.channels[1].samples[i] * 2) < 0.0002,
        ),
      );
      const info = node("media_file_info", { url: file });
      await runtime.activate(info);
      const rows = runtime.cook(info, 0, () => undefined).value.rows;
      check(
        "Media metadata reports decoded duration and channel count",
        Math.abs(
          Number(rows.find((r) => r[0] === "duration")[1]) - 16384 / 48000,
        ) < 0.0001 && rows.find((r) => r[0] === "channels")[1] === "2",
      );
      const exporter = node("media_audio_file_out", { filename: "stereo.wav" });
      const download = await runtime.activate(exporter, pcm);
      const bytes = await (await fetch(download.download.url)).arrayBuffer();
      check(
        "WAV export returns a downloadable real RIFF file",
        new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
          bytes.byteLength === 44 + 16384 * 4,
      );
      const player = node("media_audio_play", { loop: true, volume: 0 });
      await runtime.activate(player, pcm);
      check(
        "AudioBufferSource playback can explicitly start and stop",
        runtime.status(player.id).active,
      );
      runtime.stop(player.id);
      check(
        "Stopped audio node releases active state",
        !runtime.status(player.id).active,
      );
      const output = node("media_audio_device_out", { volume: 0 });
      await runtime.activate(output, pcm);
      runtime.cook(output, 0, () => pcm);
      check(
        "Device output schedules real typed PCM blocks",
        runtime.status(output.id).active,
      );
      runtime.stop(output.id);
      const stream = node("media_audio_stream_out");
      const offer = await runtime.activate(stream, pcm);
      check(
        "WebRTC sender creates real audio SDP",
        JSON.parse(offer.localDescription).sdp.includes("m=audio"),
      );
      const receiving = node("media_audio_stream_in", {
        mode: "webrtc",
        remote_sdp: offer.localDescription,
        volume: 0,
      });
      const answer = await receiver.activate(receiving);
      stream.data.params.remote_sdp = answer.localDescription;
      await runtime.activate(stream, pcm);
      for (
        let i = 0;
        i < 60 && runtime.status(stream.id).connection !== "connected";
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      check(
        "WebRTC audio sender and receiver establish a real peer connection",
        runtime.status(stream.id).connection === "connected" &&
          receiver.status(receiving.id).connection === "connected",
      );
      let amplitude = 0;
      for (let i = 0; i < 12; i++) {
        const chunk = { ...pcm, start: 16384 * (i + 1), timeSlice: true };
        runtime.cook(stream, i * 0.1, () => chunk);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const result = receiver.cook(receiving, i * 0.1, () => undefined).value;
        amplitude = Math.max(
          amplitude,
          ...result.channels.flatMap((c) => c.samples.map(Math.abs)),
        );
      }
      check(
        "WebRTC receiver exposes actual transmitted audio samples",
        amplitude > 0.01,
      );
      return {
        checks,
        decodedSampleRate: read.sampleRate,
        webrtcPeak: amplitude,
      };
    } finally {
      runtime.dispose();
      receiver.dispose();
      urls.forEach((url) => URL.revokeObjectURL(url));
    }
  });
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    path.join(artifacts, "audio-runtime-browser-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: report.checks.length,
        rate: report.decodedSampleRate,
        webrtcPeak: report.webrtcPeak,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
