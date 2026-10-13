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
    args: ["--no-sandbox"],
    env: { ...process.env, TMPDIR: temp },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/channel-data-qa.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Channel and table runtime checks</title>",
    }),
  );
  await page.goto(server.resolvedUrls.local[0] + "channel-data-qa.html");
  const report = await page.evaluate(async () => {
    const { cookChannelDataNode: cook } =
      await import("/src/nodes/channelDataRuntime.ts");
    const { channelDataCatalog: catalog } =
      await import("/src/nodes/channelDataCatalog.ts");
    const checks = [];
    const check = (name, condition) => {
      if (!condition) throw new Error(name);
      checks.push(name);
    };
    const node = (type, params = {}) => ({
      id: type,
      type,
      position: { x: 0, y: 0 },
      data: {
        label: type,
        params: {
          ...Object.fromEntries(
            catalog
              .find((spec) => spec.type === type)
              .params.map((p) => [p.key, p.default]),
          ),
          ...params,
        },
      },
    });
    const run = (type, params, input, state = new Map(), time = 0) => {
      const result = cook(node(type, params), time, () => input, state);
      if (!result.handled) throw new Error("Unhandled " + type);
      return result.value;
    };
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(64, 0, 64, 128);
    const pixels = run("top_to_channels", { width: 2, height: 1 }, canvas);
    check(
      "TOP to CHOP emits independent RGBA arrays",
      JSON.stringify(pixels.channels.map((ch) => ch.samples)) ===
        JSON.stringify([
          [1, 0],
          [0, 0],
          [0, 1],
          [1, 1],
          [0.2126, 0.0722],
        ]),
    );
    const paint = (shift = 0) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#fff";
      ctx.fillRect(20 + shift, 10, 20, 20);
      ctx.fillRect(80, 80, 30, 30);
    };
    paint();
    const state = new Map(),
      first = run("channel_blob_track", { resolution: 128 }, canvas, state, 0);
    check(
      "Blob Track separates connected components",
      first.channels[0].samples.length === 2,
    );
    const x = first.channels.find((ch) => ch.name === "x").samples,
      area = first.channels.find((ch) => ch.name === "area").samples;
    check(
      "Blob Track measures normalized centroids",
      Math.abs(x[0] - 95 / 128) < 1e-8 && Math.abs(x[1] - 30 / 128) < 1e-8,
    );
    check(
      "Blob Track measures area",
      Math.abs(area[0] - 900 / 16384) < 1e-8 &&
        Math.abs(area[1] - 400 / 16384) < 1e-8,
    );
    paint(4);
    const second = run(
      "channel_blob_track",
      { resolution: 128 },
      canvas,
      state,
      1,
    );
    check(
      "Blob IDs remain stable during motion",
      JSON.stringify(first.channels[0].samples) ===
        JSON.stringify(second.channels[0].samples),
    );
    const xml = run("xml_dat", {
      xml: '<scene><item name="a">A &amp; B</item><item name="b"><![CDATA[c < d]]></item></scene>',
      tag: "item",
    });
    check(
      "XML preserves entity decoding and CDATA",
      xml.rows.length === 3 &&
        xml.rows[1][3] === "A & B" &&
        xml.rows[2][3] === "c < d",
    );
    check(
      "XML returns stable paths and attributes",
      xml.rows[1][0] === "/scene[1]/item[1]" &&
        xml.rows[1][2] === '{"name":"a"}',
    );
    let invalid = false;
    try {
      run("xml_dat", { xml: "<a><b></a>" });
    } catch {
      invalid = true;
    }
    check("Malformed XML raises an operator error", invalid);
    const numeric = run(
      "dat_to_channels",
      { sample_rate: 48000, header: true },
      {
        kind: "table",
        rows: [
          ["left", "right"],
          ["1", "-1"],
          ["0.5", "-0.5"],
        ],
      },
    );
    const table = run("channels_to_dat", {}, numeric);
    check(
      "Browser table/channel round trip keeps named samples",
      table.rows[0].join(",") === "left,right" && table.rows[2][1] === "-0.5",
    );
    return { checks, catalogNodes: catalog.length };
  });
  if (errors.length) throw new Error(errors.join("\n"));
  await fs.writeFile(
    path.join(artifacts, "channel-data-browser-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        passed: report.checks.length,
        nodes: report.catalogNodes,
        report: "data/artifacts/channel-data-browser-check.json",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
