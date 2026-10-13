import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts"),
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
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage({
      viewport: { width: 1400, height: 960 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/compatibility-top-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:30px;background:#14131c;color:#eee;font-family:Arial,sans-serif"><p style="color:#bba1ed;letter-spacing:4px">TD OPEN · RGBA8 IMAGE OPERATORS</p><h1>八类可验证的图像运算</h1><p style="color:#aaa">RGB 范围 · 镜头模型 · 色阶与 HSV · 通道重排 · 遮罩合成 · 卷积</p><div id="gallery" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px"></div>',
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "compatibility-top-qa.html");
  const checks = await page.evaluate(async () => {
    const { compatibilityTopCatalog } =
        await import("/src/nodes/compatibilityTopCatalog.ts"),
      { cookCompatibilityTopNode } =
        await import("/src/nodes/compatibilityTopRuntime.ts"),
      { makeNode } = await import("/src/catalog.ts"),
      { StudioEngine } = await import("/src/engine.ts");
    const checks = [];
    const assert = (name, condition, detail) => {
      checks.push({ name, ok: !!condition, detail });
      if (!condition) throw Error(name + ": " + JSON.stringify(detail));
    };
    const canvas = (width = 64, height = 64) => {
      const result = document.createElement("canvas");
      result.width = width;
      result.height = height;
      return result;
    };
    const solid = (rgba) => {
      const result = canvas(1, 1),
        ctx = result.getContext("2d"),
        image = ctx.createImageData(1, 1);
      image.data.set(rgba);
      ctx.putImageData(image, 0, 0);
      return result;
    };
    const pixel = (source, x = 0, y = 0) => [
      ...source.getContext("2d").getImageData(x, y, 1, 1).data,
    ];
    const close = (actual, expected, tolerance = 2) =>
      actual.every(
        (value, index) => Math.abs(value - expected[index]) <= tolerance,
      );
    const run = (type, params, input, input2, input3, state = new Map()) => {
      const output = canvas(input?.width ?? 1, input?.height ?? 1),
        node = makeNode(type);
      node.data.params = { ...node.data.params, ...params };
      const handled = cookCompatibilityTopNode({
        node,
        input,
        input2,
        input3,
        canvas: output,
        ctx: output.getContext("2d"),
        width: output.width,
        height: output.height,
        state,
        time: 0,
        mod: 0,
      });
      assert(type + " canvas cook", handled, {
        width: output.width,
        height: output.height,
      });
      return output;
    };
    assert(
      "RGB range selects green and rejects red",
      pixel(
        run("compat_rgb_key", { green_min: 0.5 }, solid([255, 0, 0, 255])),
      )[3] === 0,
      "Independent range",
    );
    assert(
      "Level gamma + opacity numeric output",
      close(
        pixel(
          run(
            "compat_level",
            { gamma: 2, opacity: 0.5 },
            solid([64, 64, 64, 255]),
          ),
        ),
        [128, 128, 128, 128],
      ),
      "sqrt(64/255), alpha/2",
    );
    assert(
      "Reorder alpha as RGB and constants",
      close(
        pixel(
          run(
            "compat_reorder",
            { r: "A", g: "0", b: "1", a: "1" },
            solid([100, 20, 60, 128]),
          ),
        ),
        [128, 0, 255, 255],
      ),
      "A/0/1/1",
    );
    assert(
      "HSV hue rotation changes red to green",
      close(
        pixel(run("compat_hsv_adjust", { hue: 120 }, solid([255, 0, 0, 255]))),
        [0, 255, 0, 255],
      ),
      "RGB→HSV→RGB",
    );
    assert(
      "Matte uses real third input background",
      close(
        pixel(
          run(
            "compat_matte",
            {},
            solid([255, 0, 0, 255]),
            solid([0, 0, 0, 128]),
            solid([0, 0, 255, 255]),
          ),
        ),
        [128, 0, 127, 255],
      ),
      "Red foreground + blue background",
    );
    assert(
      "Inside uses green luminance rather than alpha",
      close(
        pixel(
          run(
            "compat_inside",
            { channel: "luminance", affect: "alpha" },
            solid([255, 0, 0, 255]),
            solid([0, 255, 0, 255]),
          ),
        ),
        [255, 0, 0, 182],
      ),
      "Rec.709 green coefficient",
    );
    const line = canvas(3, 1),
      image = line.getContext("2d").createImageData(3, 1);
    image.data.set([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]);
    line.getContext("2d").putImageData(image, 0, 0);
    assert(
      "Blur filters premultiplied alpha without dark fringes",
      close(
        pixel(run("compat_blur", { method: "box", radius: 1 }, line), 1),
        [255, 0, 0, 85],
      ),
      "Red remains 255 at alpha 1/3",
    );
    const source = canvas(160, 120),
      ctx = source.getContext("2d"),
      gradient = ctx.createLinearGradient(0, 0, 160, 120);
    gradient.addColorStop(0, "#ff5f86");
    gradient.addColorStop(0.5, "#3aebc8");
    gradient.addColorStop(1, "#7054ed");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 160, 120);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    for (let x = 0; x <= 160; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 120);
      ctx.stroke();
    }
    for (let y = 0; y <= 120; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(160, y);
      ctx.stroke();
    }
    const distorted = run(
      "compat_lens_distort",
      {
        k1: 0.3,
        k2: 0.2,
        k3: 0.1,
        p1: 0.12,
        p2: -0.07,
        fx: 0.5,
        fy: 0.5,
        cx: 0.4,
        cy: 0.6,
        boundary: "transparent",
      },
      source,
    );
    assert(
      "Full lens model changes grid and exposes transparent outside",
      pixel(distorted, 0, 0)[3] === 0 &&
        JSON.stringify(pixel(distorted, 100, 80)) !==
          JSON.stringify(pixel(source, 100, 80)),
      { source: pixel(source, 100, 80), distorted: pixel(distorted, 100, 80) },
    );
    const stencil = canvas(160, 120),
      stencilCtx = stencil.getContext("2d");
    stencilCtx.fillStyle = "white";
    stencilCtx.beginPath();
    stencilCtx.arc(80, 60, 50, 0, Math.PI * 2);
    stencilCtx.fill();
    const choices = {
      compat_rgb_key: {
        green_min: 0.4,
        green_soft_low: 0.2,
        red_max: 0.85,
        red_soft_high: 0.15,
      },
      compat_lens_distort: {
        k1: 0.3,
        k2: 0.2,
        k3: 0.1,
        p1: 0.12,
        p2: -0.07,
        fx: 0.5,
        fy: 0.5,
        boundary: "transparent",
      },
      compat_level: { black: 0.2, white: 0.9, gamma: 1.4, contrast: 1.15 },
      compat_reorder: { r: "B", g: "R", b: "G" },
      compat_hsv_adjust: { hue: 120, saturation: 1.5 },
      compat_matte: {},
      compat_inside: { invert: true },
      compat_blur: { radius: 6, sigma: 3 },
    };
    for (const spec of compatibilityTopCatalog) {
      const state = new Map(),
        output = run(
          spec.type,
          choices[spec.type],
          source,
          stencil,
          solid([32, 20, 65, 255]),
          state,
        );
      const card = document.createElement("div");
      card.style.cssText =
        "background:repeating-conic-gradient(#23212e 0% 25%,#1b1924 0% 50%) 0/16px 16px;border:1px solid #393341;border-radius:10px;overflow:hidden";
      output.style.cssText = "width:100%;aspect-ratio:4/3;display:block";
      card.append(output);
      const title = document.createElement("p");
      title.textContent = spec.english;
      title.style.cssText =
        "margin:0;padding:13px;background:#22202c;font-weight:bold";
      card.append(title);
      document.querySelector("#gallery").append(card);
      run(
        spec.type,
        choices[spec.type],
        source,
        stencil,
        solid([32, 20, 65, 255]),
        state,
      );
      assert(
        spec.type + " scratch resources remain bounded",
        state.size <= 3,
        state.size,
      );
    }
    // Verify the catalog registration and real StudioEngine routing, particularly in3.
    const foreground = makeNode("solid"),
      maskNode = makeNode("solid"),
      background = makeNode("solid"),
      matte = makeNode("compat_matte"),
      output = makeNode("output");
    foreground.data.params = { ...foreground.data.params, color: "#ff0000" };
    maskNode.data.params = { ...maskNode.data.params, color: "#808080" };
    background.data.params = { ...background.data.params, color: "#0000ff" };
    matte.data.params.channel = "luminance";
    const nodes = [foreground, maskNode, background, matte, output],
      edge = (a, b, port = "in") => ({
        id: a.id + b.id + port,
        source: a.id,
        target: b.id,
        sourceHandle: "out",
        targetHandle: port,
      });
    const engine = new StudioEngine({
      id: "compatibility_matte_three_inputs",
      name: "Matte integration",
      version: 1,
      nodes,
      edges: [
        edge(foreground, matte),
        edge(maskNode, matte, "in2"),
        edge(background, matte, "in3"),
        edge(matte, output),
      ],
    });
    try {
      const frame = engine.render(0);
      assert(
        "StudioEngine routes third background into Matte",
        engine.errors.size === 0 &&
          close(pixel(frame, 320, 180), [128, 0, 127, 255], 3),
        { errors: [...engine.errors], pixel: pixel(frame, 320, 180) },
      );
    } finally {
      engine.dispose();
    }
    return checks;
  });
  await page.screenshot({
    path: path.join(root, "docs/images/compatibility-top-operators.png"),
    fullPage: true,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    checks,
    errors,
    ok: checks.every((check) => check.ok) && errors.length === 0,
  };
  await fs.writeFile(
    path.join(artifacts, "compatibility-top-browser.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ ok: report.ok, checks: checks.length, errors }, null, 2),
  );
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
