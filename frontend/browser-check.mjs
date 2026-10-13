import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, "data/artifacts");
await fs.mkdir(artifacts, { recursive: true });
process.env.TMPDIR = path.join(root, ".cache/tmp");
await fs.mkdir(process.env.TMPDIR, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.TD_CHROMIUM,
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
  env: { ...process.env, TMPDIR: path.join(root, ".cache/tmp") },
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(process.env.TD_BASE_URL || "http://127.0.0.1:8765", {
  waitUntil: "networkidle",
});
await page.waitForTimeout(2200);
await page.screenshot({
  path: path.join(artifacts, "studio-desktop.png"),
  fullPage: true,
});
const state = await page.evaluate(() => ({
  title: document.title,
  bodyWidth: document.body.scrollWidth,
  viewport: innerWidth,
  nodes: document.querySelectorAll(".studio-node").length,
  canvas: [...document.querySelectorAll("canvas")].map((c) => [
    c.width,
    c.height,
  ]),
  save: document.querySelector(".save-state")?.textContent,
  engine: document.querySelector(".statusbar")?.textContent,
}));
await fs.writeFile(
  path.join(artifacts, "browser-initial.json"),
  JSON.stringify({ state, errors }, null, 2),
);
console.log(JSON.stringify({ state, errors }, null, 2));
await browser.close();
