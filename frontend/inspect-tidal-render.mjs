/** Replays actual generated project assets through the production StudioEngine. */
import { chromium, expect as baseExpect } from "@playwright/test";
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts"),
  project = JSON.parse(
    await fs.readFile(
      path.join(artifacts, "tidal-muse-generated-project.json"),
      "utf8",
    ),
  ),
  stage = project.nodes.find((n) => n.type === "pointcloud_stage_top");
process.env.TMPDIR = path.join(root, ".cache/tmp");
const html = `<!doctype html><html><meta charset="UTF-8"><body style="margin:0;background:#030a12"><button id="start" style="position:absolute;top:12px;right:12px;z-index:2">启用真实声部</button><canvas id="screen" width="1280" height="720" style="display:block;width:1280px;height:720px"></canvas><script type="module">
import {StudioEngine} from '/src/engine.ts';import {displacedPoint} from '/src/nodes/pointPerformance.ts';import {PointStage} from '/src/nodes/pointStage.ts';const project=${JSON.stringify(project)};const engine=new StudioEngine(project),canvas=document.getElementById('screen');window.lab={engine,project,canvas,displacedPoint,PointStage};let running=true;window.lab.render=(t)=>{engine.performance.captureTime=t;const frame=engine.render(t);canvas.getContext('2d').drawImage(frame,0,0,1280,720);return frame.toDataURL('image/png');};window.lab.pause=()=>running=false;document.getElementById('start').onclick=async()=>{await engine.startPerformance('${stage.id}');document.getElementById('start').hidden=true;window.lab.ready=true;};function tick(){if(running){engine.performance.captureTime=undefined;const frame=engine.render(performance.now()/1000);canvas.getContext('2d').drawImage(frame,0,0,1280,720);}requestAnimationFrame(tick)}tick();</script></body></html>`;
const server = await createServer({
  root: path.join(root, "frontend"),
  configFile: path.join(root, "frontend/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 5214,
    strictPort: true,
    watch: { usePolling: true, interval: 1000 },
    proxy: { "/api": { target: "http://127.0.0.1:8778", changeOrigin: false } },
  },
  plugins: [
    {
      name: "real-tidal-lab",
      configureServer(server) {
        server.middlewares.use("/tidal-validation.html", (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(html);
        });
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({
    executablePath: process.env.TD_CHROMIUM,
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
    env: process.env,
  }),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
  errors = [],
  consoleErrors = [],
  expect = baseExpect.configure({ timeout: 45000 });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
try {
  await page.goto("http://127.0.0.1:5214/tidal-validation.html");
  await page.waitForFunction(
    () =>
      window.lab?.engine.values.get(
        window.lab.project.nodes.find(
          (n) => n.type === "model_to_pointcloud_sop",
        ).id,
      )?.mesh?.positions.length === 28000,
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: "启用真实声部" }).click();
  await page.waitForFunction(() => window.lab.ready);
  await page.waitForFunction(
    () => window.lab.engine.performance.time > 0.2,
    undefined,
    { timeout: 15000 },
  );
  await page.evaluate(() => window.lab.pause());
  const clock = await page.evaluate(async () => {
    const e = window.lab.engine;
    e.performance.captureTime = undefined;
    e.setPlaying(false);
    const paused = e.performance.time;
    await new Promise((r) => setTimeout(r, 150));
    const frozen = e.performance.time;
    e.setPlaying(true);
    await new Promise((r) => setTimeout(r, 650));
    const resumed = e.performance.time;
    return {
      paused,
      frozen,
      resumed,
      state: e.performance.context?.state,
      currentTime: e.performance.context?.currentTime,
      status: e.performance.status,
    };
  });
  console.log("CLOCK", clock);
  expect(clock.frozen).toBe(clock.paused);
  expect(clock.resumed).toBeGreaterThan(clock.frozen + 0.1);
  const traces = await page.evaluate(() => {
    const { engine, project, render } = window.lab;
    const id = project.nodes.find((n) => n.type === "pointcloud_dance_sop").id;
    return Array.from({ length: 32 }, (_, t) => {
      render(t);
      return { ...engine.values.get(id).pointDance };
    });
  });
  const independent = await page.evaluate((traces) => {
    const { engine, project, PointStage, render } = window.lab,
      danceNode = project.nodes.find((n) => n.type === "pointcloud_dance_sop"),
      stageNode = project.nodes.find((n) => n.type === "pointcloud_stage_top");
    const stage = new PointStage(),
      results = {};
    for (const track of ["vocals", "drums", "bass", "other"]) {
      const best = traces.reduce((a, b) => (a[track] > b[track] ? a : b));
      render(best.time);
      const spec = engine.values.get(danceNode.id),
        baseline = stage
          .render(spec, stageNode, engine.renderer)
          .getContext("2d")
          .getImageData(0, 0, 1280, 720).data;
      const modified = {
        ...spec,
        pointDance: {
          ...spec.pointDance,
          [track]: 0,
          ...(track === "drums" ? { hit: 0 } : {}),
        },
      };
      const pixels = stage
        .render(modified, stageNode, engine.renderer)
        .getContext("2d")
        .getImageData(0, 0, 1280, 720).data;
      let difference = 0;
      for (let i = 0; i < pixels.length; i += 4)
        for (let c = 0; c < 3; c++)
          difference += Math.abs(pixels[i + c] - baseline[i + c]);
      results[track] = {
        time: best.time,
        energy: best[track],
        meanPixelDifference: difference / (1280 * 720 * 3),
      };
    }
    stage.dispose();
    return results;
  }, traces);
  for (const result of Object.values(independent))
    expect(result.meanPixelDifference).toBeGreaterThan(0.01);
  let last;
  for (const t of [2, 6, 10, 15, 20, 25]) {
    last = await page.evaluate((t) => window.lab.render(t), t);
    await fs.writeFile(
      path.join(artifacts, "tidal-frame-" + t + ".png"),
      Buffer.from(last.split(",")[1], "base64"),
    );
  }
  const stats = await page.evaluate(() => {
    const { engine, project } = window.lab,
      cloud = engine.values.get(
        project.nodes.find((n) => n.type === "model_to_pointcloud_sop").id,
      ),
      dance = engine.values.get(
        project.nodes.find((n) => n.type === "pointcloud_dance_sop").id,
      );
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const p of cloud.mesh.positions)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    return {
      points: cloud.mesh.positions.length,
      bounds: [min, max],
      dance: dance.pointDance,
      errors: [...engine.errors.values()],
      performance: engine.performance.status,
    };
  });
  const ply = await page.evaluate(() =>
    window.lab.engine.exportPerformancePoints(
      window.lab.project.nodes.find((n) => n.type === "pointcloud_stage_top")
        .id,
    ),
  );
  await fs.writeFile(path.join(artifacts, "tidal-muse-points.ply"), ply);
  expect(ply).toContain("element vertex 28000");
  expect(ply).not.toMatch(/NaN|Infinity/);
  expect(stats.points).toBe(28000);
  expect(stats.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await fs.writeFile(
    path.join(artifacts, "tidal-render-inspection.json"),
    JSON.stringify(
      { stats, clock, traces, independent, errors, consoleErrors },
      null,
      2,
    ),
  );
  console.log(
    "PASS real point cloud, shared clock and four independent controls",
    JSON.stringify(independent),
  );
  if (process.argv.includes("--video")) {
    const music = project.nodes
      .find((n) => n.type === "local_music")
      .data.params.result_url.split("/")
      .pop();
    const encoder = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-framerate",
        "24",
        "-vcodec",
        "png",
        "-i",
        "pipe:0",
        "-i",
        path.join(root, ".cache/tidal-qa/assets", music),
        "-c:v",
        "libx264",
        "-threads",
        "4",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        path.join(artifacts, "tidal-muse-performance.mp4"),
      ],
      { stdio: ["pipe", "ignore", "inherit"] },
    );
    encoder.on("error", (e) => consoleErrors.push(e.message));
    const finished = once(encoder, "close");
    for (let frame = 0; frame < 768; frame++) {
      const png = await page.evaluate((t) => window.lab.render(t), frame / 24);
      if (!encoder.stdin.write(Buffer.from(png.split(",")[1], "base64")))
        await once(encoder.stdin, "drain");
      if (frame % 48 === 0) console.log("VIDEO", frame, "/ 768");
    }
    encoder.stdin.end();
    const [code] = await finished;
    expect(code).toBe(0);
    console.log(
      "PASS 32-second 1280x720 video with actual generated soundtrack",
    );
  }
  const stopped = await page.evaluate(() => {
    const p = window.lab.engine.performance;
    p.captureTime = undefined;
    p.stop();
    p.setPlaying(true);
    return p.status;
  });
  expect(stopped.ready).toBe(false);
  expect(stopped.playing).toBe(false);
} finally {
  await browser.close();
  await server.close();
}
