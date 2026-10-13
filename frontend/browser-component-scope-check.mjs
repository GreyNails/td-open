import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  temp = path.join(root, ".cache/tmp"),
  artifacts = path.join(root, "data/artifacts");
await fs.mkdir(temp, { recursive: true });
const server = await createServer({
  root: import.meta.dirname,
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
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage({
      viewport: { width: 1420, height: 920 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/component-scope-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;padding:35px;background:#11121b;color:#f1edfc;font-family:Arial,sans-serif"><p style="letter-spacing:3px;color:#bca1ef;font-size:12px">TD OPEN · COMPONENT SCOPES</p><h1>可执行的时间域、关键帧与复制实例</h1><p style="color:#aaa4b5">所有画面直接来自内置引擎；每个副本拥有独立节点标识、状态和编号。</p><div id="gallery" style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px"></div></body></html>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "component-scope-qa.html");
  const results = await page.evaluate(async () => {
    const { makeNode, byType } = await import("/src/catalog.ts"),
      { StudioEngine } = await import("/src/engine.ts");
    const checks = [],
      projects = [];
    const node = (id, type, params = {}) => {
        const n = makeNode(type);
        n.id = id;
        n.data.params = { ...n.data.params, ...params };
        return n;
      },
      graph = (id, nodes, edges = []) => ({
        id,
        name: id,
        version: 1,
        nodes,
        edges,
      }),
      edge = (source, target, handle = "in") => ({
        id: source + "_" + target + "_" + handle,
        source,
        target,
        sourceHandle: "out",
        targetHandle: handle,
      });
    const mark = (name, condition, detail) => {
      checks.push({ name, ok: !!condition, detail });
      if (!condition) throw Error(name + ": " + JSON.stringify(detail));
    };
    const pixel = (canvas, x = 320, y = 180) =>
        [...canvas.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 3),
      snapshot = (canvas) => {
        const copy = document.createElement("canvas");
        copy.width = 640;
        copy.height = 360;
        copy.getContext("2d").drawImage(canvas, 0, 0, 640, 360);
        return copy;
      };
    const show = (title, canvas, caption) => {
      const card = document.createElement("div");
      card.style.cssText =
        "border:1px solid #343045;background:#1d1c29;border-radius:12px;overflow:hidden";
      const image = document.createElement("img");
      image.src = canvas.toDataURL("image/png");
      image.style.cssText = "width:100%;display:block";
      card.append(image);
      const label = document.createElement("div");
      label.style.cssText = "padding:14px 18px";
      label.innerHTML = `<b>${title}</b><p style="color:#aaa4b5;font-size:13px;margin-bottom:0">${caption}</p>`;
      card.append(label);
      document.querySelector("#gallery").append(card);
    };
    const timeShader = `#version 300 es\nprecision highp float;uniform float uTime;in vec2 vUV;out vec4 fragColor;void main(){vec3 c=0.5+0.5*cos(vec3(0.,2.,4.)+uTime+vUV.x*8.);fragColor=vec4(c,1.);}`;
    const clock = node("local_clock", "time_comp", { rate: 2, offset: 1 });
    clock.data.graph = graph(
      "clock_network",
      [
        node("shader", "ref_top_glsl", { code: timeShader }),
        node("out", "network_out_top"),
      ],
      [edge("shader", "out")],
    );
    const timed = graph(
        "component_local_clock",
        [clock, node("output", "output")],
        [edge("local_clock", "output")],
      ),
      engine = new StudioEngine(timed);
    try {
      const local = snapshot(engine.render(0.25));
      mark("Time COMP uses local 2t+1 domain", engine.errors.size === 0, [
        ...engine.errors,
      ]);
      const direct = new StudioEngine(
        graph(
          "clock_reference",
          [
            node("shader", "ref_top_glsl", { code: timeShader }),
            node("output", "output"),
          ],
          [edge("shader", "output")],
        ),
      );
      try {
        const expected = snapshot(direct.render(1.5)),
          normal = snapshot(direct.render(0.25));
        mark(
          "Nested time pixels equal direct shader at transformed time",
          JSON.stringify(pixel(local)) === JSON.stringify(pixel(expected)),
          { local: pixel(local), expected: pixel(expected) },
        );
        mark(
          "Local clock differs from unchanged global time",
          JSON.stringify(pixel(local)) !== JSON.stringify(pixel(normal)),
          { local: pixel(local), global: pixel(normal) },
        );
      } finally {
        direct.dispose();
      }
      show(
        "独立时间域：2 × t + 1",
        local,
        "全局 0.25 秒时，内部着色器运行在 1.5 秒。",
      );
      projects.push(timed);
    } finally {
      engine.dispose();
    }
    const animation = node("animation", "animation_comp", {
        keys: '{"x":[[0,0],[0.5,1],[1,-0.5],[2,0]],"y":[[0,0.7],[1,-0.7],[2,0.7]]}',
        mode: "smooth",
        samples: 120,
        sample_rate: 60,
        loop: true,
      }),
      animated = graph(
        "component_keyframes",
        [
          animation,
          node("viewer", "ref_top_op_viewer", { source: "/animation" }),
          node("output", "output"),
        ],
        [edge("viewer", "output")],
      ),
      animationEngine = new StudioEngine(animated);
    try {
      const canvas = snapshot(animationEngine.render(0)),
        value = animationEngine.values.get("animation");
      mark(
        "Animation COMP returns two real sampled channels",
        value?.kind === "channels" &&
          value.channels.length === 2 &&
          value.channels[0].samples.length === 120,
        { kind: value?.kind, channels: value?.channels.length },
      );
      mark(
        "Animation keyframe value is exact at t=0.5",
        Math.abs(value.channels[0].samples[30] - 1) < 1e-9,
        value.channels[0].samples[30],
      );
      show(
        "关键帧驱动命名采样通道",
        canvas,
        "平滑插值生成 x/y 两条真实曲线，采样率为 60 Hz。",
      );
      projects.push(animated);
    } finally {
      animationEngine.dispose();
    }
    const replicaShader = `#version 300 es\nprecision highp float;uniform float uTime,uMod;in vec2 vUV;out vec4 fragColor;void main(){vec3 c=0.5+0.5*cos(vec3(0.,2.,4.)+uMod*1.45);float rings=0.68+0.32*cos(length(vUV-.5)*(20.+uMod*5.)-uTime*2.);fragColor=vec4(c*rings,1.);}`;
    const replica = node("replicas", "replicator_comp", { count: 4 });
    replica.data.graph = graph(
      "replica_template",
      [
        node("index", "replica_index_chop"),
        node("shader", "ref_top_glsl", { code: replicaShader }),
        node("out", "network_out_top"),
      ],
      [edge("index", "shader", "mod"), edge("shader", "out")],
    );
    mark(
      "GLSL public schema declares CHOP modulation port",
      byType.ref_top_glsl.inputs.some(
        (p) => p.id === "mod" && p.kind === "CHOP",
      ),
    );
    const replicated = graph(
        "component_replicator",
        [replica, node("output", "output")],
        [edge("replicas", "output")],
      ),
      replicaEngine = new StudioEngine(replicated);
    try {
      const canvas = snapshot(replicaEngine.render(0.5)),
        indices = replicaEngine.project.nodes
          .filter((n) => n.type === "replica_index_chop")
          .map(
            (n) => replicaEngine.values.get(n.id)?.channels?.[0]?.samples?.[0],
          );
      mark(
        "Four instances cook unique 0..3 indices",
        JSON.stringify(indices) === "[0,1,2,3]",
        indices,
      );
      mark("Replicator cooks without errors", replicaEngine.errors.size === 0, [
        ...replicaEngine.errors,
      ]);
      const centers = [
        [160, 90],
        [480, 90],
        [160, 270],
        [480, 270],
      ].map(([x, y]) => pixel(canvas, x, y));
      mark(
        "Tiled render contains four distinct instance outputs",
        new Set(centers.map((p) => p.join(","))).size === 4,
        centers,
      );
      const gpuFrames = replicaEngine.project.nodes
        .filter((n) => n.type === "ref_top_glsl")
        .map((n) => replicaEngine.values.get(n.id));
      mark(
        "Copies own distinct output canvas objects",
        new Set(gpuFrames).size === 4,
      );
      show(
        "四份独立子网络实例",
        canvas,
        "Replica Index 调制 GLSL，使每份副本具有不同颜色与环形频率。",
      );
      projects.push(replicated);
      const updated = structuredClone(replicated);
      updated.nodes.find(
        (n) => n.type === "replicator_comp",
      ).data.params.count = 2;
      replicaEngine.setProject(updated);
      replicaEngine.render(0.75);
      mark(
        "Reducing count removes stale copied nodes and values",
        replicaEngine.project.nodes.filter(
          (n) => n.type === "replica_index_chop",
        ).length === 2 && !replicaEngine.values.has("replicas/_copy3/index"),
      );
    } finally {
      replicaEngine.dispose();
    }
    const nestedReplica = node("inner", "replicator_comp", { count: 3 });
    nestedReplica.data.graph = structuredClone(replica.data.graph);
    const outer = node("outer", "replicator_comp", { count: 2 });
    outer.data.graph = graph(
      "outer_template",
      [nestedReplica, node("out", "network_out_top")],
      [edge("inner", "out")],
    );
    const nested = graph(
        "component_nested_replicators",
        [outer, node("output", "output")],
        [edge("outer", "output")],
      ),
      nestedEngine = new StudioEngine(nested);
    try {
      const canvas = snapshot(nestedEngine.render(0.5)),
        indices = nestedEngine.project.nodes
          .filter((n) => n.type === "replica_index_chop")
          .map(
            (n) => nestedEngine.values.get(n.id)?.channels?.[0]?.samples?.[0],
          );
      mark(
        "Nested copies each restart local indices at zero",
        JSON.stringify(indices) === "[0,1,2,0,1,2]",
        indices,
      );
      mark(
        "Nested Replicator graph has no cook errors",
        nestedEngine.errors.size === 0,
        [...nestedEngine.errors],
      );
      show(
        "嵌套复制保持独立编号",
        canvas,
        "每个父实例中，子实例编号都从 0 重新开始。",
      );
      projects.push(nested);
    } finally {
      nestedEngine.dispose();
    }
    return { checks, projects };
  });
  const folder = path.join(artifacts, "component-scope-examples");
  await fs.mkdir(folder, { recursive: true });
  for (const project of results.projects)
    await fs.writeFile(
      path.join(folder, project.id + ".tdopen.json"),
      JSON.stringify(project, null, 2) + "\n",
    );
  await page.screenshot({
    path: path.join(root, "docs/images/component-scopes.png"),
    fullPage: true,
  });
  const report = {
    checks: results.checks,
    errors,
    ok: errors.length === 0 && results.checks.every((c) => c.ok),
  };
  await fs.writeFile(
    path.join(artifacts, "component-scope-browser.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
