import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["frontend/star-raster-harness.ts"],
  bundle: true,
  format: "iife",
  globalName: "StarCheck",
  outfile: ".cache/star-render-check.js",
});
const root = process.cwd();
process.env.TMPDIR = root + "/.cache/tmp";
const browser = await chromium.launch({
  executablePath: process.env.TD_CHROMIUM,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
  env: process.env,
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8782");
  await page.addScriptTag({
    content: await fs.readFile(".cache/star-render-check.js", "utf8"),
  });
  const project = JSON.parse(
    await fs.readFile("examples/star-points.tdopen.json", "utf8"),
  );
  const result = await page.evaluate((p) => StarCheck.verify(p), project);
  await fs.writeFile(
    "frontend/public/examples/star-points.webp",
    Buffer.from(result.webp.split(",")[1], "base64"),
  );
  await fs.writeFile(
    "docs/images/star-pointcloud.png",
    Buffer.from(result.png.split(",")[1], "base64"),
  );
  await fs.writeFile("data/artifacts/star-pointcloud.ply", result.ply);
  delete result.webp;
  delete result.png;
  delete result.ply;
  await fs.writeFile(
    "data/artifacts/star-raster-validation.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
