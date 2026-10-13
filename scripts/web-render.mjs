/** Isolated Chromium page capture; pages cannot call private machine APIs. */
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
let stdin = "";
for await (const chunk of process.stdin) {
  stdin += chunk;
  if (stdin.length > 1000000) throw new Error("Web Render request too large");
}
const request = JSON.parse(stdin),
  addresses = new Map();
const privateIP = (address) => {
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice(7);
    if (isIP(mapped) === 4) return privateIP(mapped);
    const words = mapped.split(":");
    if (words.length === 2) {
      const n = parseInt(words[0], 16) * 65536 + parseInt(words[1], 16);
      return privateIP(
        [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."),
      );
    }
  }
  return (
    address === "::1" ||
    address === "::" ||
    address === "0.0.0.0" ||
    address.startsWith("127.") ||
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    address.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(address) ||
    /^fe[89ab][0-9a-f]:/i.test(address)
  );
};
const privateHost = async (host) => {
  host = host.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  if (isIP(host)) return privateIP(host);
  if (!addresses.has(host))
    addresses.set(
      host,
      lookup(host, { all: true })
        .then((values) => values.some((item) => privateIP(item.address)))
        .catch(() => false),
    );
  return addresses.get(host);
};
const canonicalPath = (raw) => {
  for (let i = 0; i < 5; i++) {
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch { return null; }
    if (decoded === raw) break;
    raw = decoded;
  }
  const parts = [];
  for (const part of raw.replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
};
const browser = await chromium.launch({
  executablePath: process.env.TD_CHROMIUM || undefined,
  headless: true,
  args: ["--no-sandbox"],
  env: process.env,
});
try {
  const context = await browser.newContext({
    viewport: { width: request.width, height: request.height },
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()), path = canonicalPath(url.pathname);
    if (path === null) return route.abort("blockedbyclient");
    if (!["http:", "https:", "data:", "blob:", "about:"].includes(url.protocol))
      return route.abort("blockedbyclient");
    // An imported graph may contain arbitrary HTML. Loading that HTML never
    // authorizes it to run Python, delete projects, or read private local APIs.
    if (
      /^\/api\/(scripts|commands|projects|providers|mcp|ai|io|chat|web-render|integrations|upload|artifacts|evaluate)(\/|$)/.test(
        path,
      )
    )
      return route.abort("blockedbyclient");
    if (
      ["http:", "https:"].includes(url.protocol) &&
      path.startsWith("/api/") &&
      (await privateHost(url.hostname))
    ) {
      const publicImage =
        /^\/api\/(assets|exports)\/[A-Za-z0-9_.-]+$/.test(path) &&
        route.request().method() === "GET";
      if (!publicImage) return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on("dialog", (dialog) => dialog.dismiss());
  if (request.html)
    await page.setContent(request.html, { waitUntil: "domcontentloaded" });
  else
    await page.goto(request.url, {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
  for (const action of request.actions || []) {
    if (action.type === "click")
      await page.locator(action.selector).first().click();
    else if (action.type === "fill")
      await page
        .locator(action.selector)
        .first()
        .fill(String(action.value ?? ""));
    else if (action.type === "scroll")
      await page.mouse.wheel(Number(action.x) || 0, Number(action.y) || 0);
  }
  if (request.delay) await page.waitForTimeout(Math.min(3000, request.delay));
  await page.screenshot({ path: request.output, type: "png" });
  process.stdout.write(
    JSON.stringify({
      title: (await page.title()).slice(0, 2000),
      url: page.url().slice(0, 4096),
      width: request.width,
      height: request.height,
    }),
  );
} finally {
  await browser.close();
}
