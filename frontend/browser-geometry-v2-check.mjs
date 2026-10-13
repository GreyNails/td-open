import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  output = path.join(root, "data/artifacts/geometry-v2-browser.json"),
  temp = path.join(root, ".cache/tmp");
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
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.route("**/geometry-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><meta charset="utf-8"><body style="background:#10111a;color:white;font-family:sans-serif"><h1>TD Open · Mesh / Materials / Scene</h1><div id="gallery" style="display:flex;flex-wrap:wrap;gap:12px"></div></body></html>',
    }),
  );
  await page.route("**/test-mesh.obj", (route) =>
    route.fulfill({
      contentType: "text/plain",
      body: "v -1 -1 0\nv 1 -1 0\nv 0 1 0\nf 1 2 3\n",
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "geometry-qa.html");
  const report = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js"),
      { geometryV2Catalog, materialCatalog, sceneCatalog } =
        await import("/src/nodes/geometryV2Catalog.ts"),
      { cookGeometryV2Node: cook } =
        await import("/src/nodes/geometryV2Runtime.ts"),
      { buildScene } = await import("/src/nodes/sceneRuntime.ts"),
      { loadSceneModel } = await import("/src/nodes/sceneModelLoader.ts");
    const catalog = [...geometryV2Catalog, ...materialCatalog, ...sceneCatalog],
      node = (type, params = {}) => ({
        id: type,
        type,
        position: { x: 0, y: 0 },
        data: {
          label: type,
          params: {
            ...Object.fromEntries(
              catalog
                .find((n) => n.type === type)
                .params.map((p) => [p.key, p.default]),
            ),
            ...params,
          },
        },
      }),
      run = (type, input, params = {}, extra = {}, time = 0.5) => {
        const result = cook(
          node(type, params),
          time,
          (key = "in") => (key === "in" ? input : extra[key]),
          new Map(),
        );
        if (!result.handled) throw Error(type);
        return result.value;
      };
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(240, 180);
    renderer.setClearColor("#12151f");
    const checks = [],
      camera = {
        projection: "perspective",
        position: [3, 2, 4],
        target: [0, 0, 0],
        fov: 45,
        near: 0.01,
        far: 100,
        zoom: 1,
      },
      lights = [
        {
          type: "ambient",
          color: "#d9e4ff",
          intensity: 2,
          position: [0, 0, 0],
        },
        {
          type: "directional",
          color: "#ffffff",
          intensity: 3,
          position: [3, 4, 5],
        },
      ];
    function render(label, geometry, material) {
      const bundle = buildScene(
        { kind: "scene", objects: [{ geometry, material }], lights, camera },
        240,
        180,
      );
      renderer.render(bundle.scene, bundle.camera);
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 180;
      canvas.getContext("2d").drawImage(renderer.domElement, 0, 0);
      const bytes = canvas.getContext("2d").getImageData(0, 0, 240, 180).data;
      let count = 0;
      for (let i = 0; i < bytes.length; i += 4)
        if (bytes[i] > 40 || bytes[i + 1] > 40 || bytes[i + 2] > 40) count++;
      const card = document.createElement("div");
      card.style.background = "#202333";
      card.innerHTML = `<p style="padding:0 10px">${label}</p>`;
      card.append(canvas);
      document.querySelector("#gallery").append(card);
      bundle.dispose();
      checks.push({ label, visiblePixels: count, ok: count > 50 });
    }
    const box = { shape: "box", detail: 1 },
      pbr = run("pbr_mat", undefined),
      image = document.createElement("canvas");
    image.width = 64;
    image.height = 64;
    const ctx = image.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fill();
    render(
      "BSP Boolean",
      run(
        "boolean_sop",
        box,
        { operation: "subtract" },
        {
          in2: {
            shape: "sphere",
            detail: 12,
            radius: 1,
            position: [0.6, 0.5, 0.6],
          },
        },
      ),
      pbr,
    );
    render(
      "Text Geometry",
      run("text_sop", undefined, { text: "OPEN", size: 0.5 }),
      pbr,
    );
    render(
      "Gyroid",
      run("iso_surface_sop", undefined, { resolution: 14 }),
      pbr,
    );
    const raster = run("raster_sop", image),
      trace = run("trace_sop", image);
    checks.push(
      {
        label: "raster actual height",
        ok:
          Math.max(...raster.mesh.positions.map((p) => p[1])) > 0.8 &&
          Math.min(...raster.mesh.positions.map((p) => p[1])) < 0.1,
      },
      { label: "trace actual boundary", ok: trace.mesh.lines.length > 20 },
    );
    render("Raster", raster, pbr);
    render("Trace", trace, run("line_mat", undefined));
    for (const type of [
      "constant_mat",
      "pbr_mat",
      "phong_mat",
      "glsl_mat",
      "wireframe_mat",
      "point_sprite_mat",
    ]) {
      const material = run(type, undefined, {}, { map: image }),
        geometry =
          type === "point_sprite_mat"
            ? run("sprinkle_sop", box, { count: 800 })
            : box;
      render(type, geometry, material);
    }
    const loaded = await loadSceneModel("/test-mesh.obj");
    let triangles = 0;
    loaded.traverse((child) => {
      if (child.isMesh)
        triangles += child.geometry.getAttribute("position").count / 3;
    });
    checks.push({ label: "OBJ real parser", ok: triangles === 1 });
    loaded.traverse((child) => {
      child.geometry?.dispose();
      if (child.material)
        for (const m of Array.isArray(child.material)
          ? child.material
          : [child.material])
          m.dispose();
    });
    renderer.dispose();
    return {
      checks,
      counts: {
        sop: geometryV2Catalog.filter((n) => n.family === "SOP").length,
        mat: materialCatalog.length,
        comp: sceneCatalog.length,
      },
    };
  });
  await page.screenshot({
    path: path.join(root, "data/artifacts/geometry-v2-browser.png"),
    fullPage: true,
  });
  report.errors = errors;
  report.ok = errors.length === 0 && report.checks.every((c) => c.ok);
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
