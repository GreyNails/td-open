/** A real browser against Vite; every backend request uses an in-memory fixture. */
import { chromium, expect as baseExpect } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  artifacts = path.join(root, "data/artifacts");
process.env.TMPDIR = path.join(root, ".cache/tmp");
await fs.mkdir(process.env.TMPDIR, { recursive: true });
await fs.mkdir(artifacts, { recursive: true });
const server = await createServer({
  root: path.join(root, "frontend"),
  configFile: path.join(root, "frontend/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
    watch: { usePolling: true, interval: 1000 },
  },
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
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
});
const page = await context.newPage(),
  errors = [],
  checks = [],
  sent = [];
const expect = baseExpect.configure({ timeout: 20000 });
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
const mark = (name) => {
  checks.push({ name, passed: true });
  console.log("PASS " + name);
};
let project = {
  id: "guide_qa_fixture",
  name: "文档测试隔离作品",
  version: 1,
  nodes: [],
  edges: [],
};
let mcp = {
  id: "docs_fixture",
  name: "文档测试服务",
  url: "http://127.0.0.1:3000/mcp",
  token: "fixture-token-not-a-real-secret",
  allowed_tools: ["echo", "read_value"],
};
const mask = () => {
  const { token, ...rest } = mcp;
  return { ...rest, has_token: Boolean(token) };
};
await page.route("**/api/**", async (route) => {
  const request = route.request(),
    url = new URL(request.url()),
    pathname = url.pathname;
  let body = {};
  if (pathname === "/api/health") body = { status: "ok" };
  else if (pathname === "/api/providers") body = [];
  else if (pathname === "/api/projects" && request.method() === "GET")
    body = [{ id: project.id, name: project.name }];
  else if (pathname === "/api/projects" && request.method() === "POST")
    body = project = request.postDataJSON();
  else if (pathname.startsWith("/api/projects/")) body = project;
  else if (pathname === "/api/mcp/servers") {
    if (request.method() === "POST") {
      const payload = request.postDataJSON();
      sent.push(payload);
      mcp = {
        ...payload,
        token: payload.token == null ? mcp.token : payload.token,
      };
      body = mask();
    } else body = [mask()];
  } else if (pathname.endsWith("/tools"))
    body = {
      tools: [
        {
          name: "echo",
          description: "Fixture only",
          inputSchema: { type: "object" },
        },
      ],
    };
  else
    throw new Error(
      "Unexpected API request in documentation test: " + pathname,
    );
  await route.fulfill({ json: body });
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        window.__guideClipboard = text;
      },
    },
  });
});
try {
  let docsRequested = false;
  page.on("request", (request) => {
    if (request.url().includes("DocsCenter.tsx")) docsRequested = true;
  });
  await page.goto("http://127.0.0.1:5199", { waitUntil: "networkidle" });
  await expect(page.locator(".save-state")).toHaveText(
    /已连接|已保存|已自动保存/,
  );
  expect(docsRequested).toBe(false);
  mark("Documentation is lazy-loaded after the editor starts");
  await page.getByTitle("入门指南", { exact: true }).click();
  const help = page.getByRole("dialog", { name: "入门指南" });
  const entry = help.getByRole("button", { name: "API 接入文档", exact: true });
  await entry.click();
  const dialog = page.getByRole("dialog", {
    name: "API 接入文档",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(docsRequested).toBe(true);
  await expect(page).toHaveURL(/#guide\/start$/);
  const sections = [
    ["start", "接入总览", "API_GUIDE.md"],
    ["ai", "AI 服务", "AI_API.md"],
    ["mcp", "MCP 与 AI 对话", "MCP_GUIDE.md"],
    ["http", "项目 HTTP API", "HTTP_API.md"],
    ["io", "设备与实时协议", "IO_GUIDE.md"],
    ["local", "本地模型与 ComfyUI", "LOCAL_AI.md"],
  ];
  for (const [id, label, file] of sections) {
    await dialog
      .getByRole("navigation", { name: "API 文档章节" })
      .getByRole("button")
      .filter({ has: page.locator("strong", { hasText: label }) })
      .click();
    await expect(page).toHaveURL(new RegExp("#guide/" + id + "$"));
    const source = await fs.readFile(path.join(root, "docs", file), "utf8");
    await expect(dialog.locator("article h1")).toHaveText(
      source
        .split("\n")
        .find((line) => line.startsWith("# "))
        .slice(2),
    );
    expect(await dialog.locator("article h2").count()).toBeGreaterThan(2);
  }
  mark("All six chapter tabs render the corresponding repository Markdown");
  await dialog.getByRole("textbox", { name: "搜索 API 文档" }).fill("OSC");
  await expect(dialog.locator(".guide-results")).toContainText(
    "设备与实时协议",
  );
  await dialog
    .locator(".guide-results button")
    .filter({ hasText: "设备与实时协议" })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "搜索 API 文档" }),
  ).toHaveValue("");
  await expect(page).toHaveURL(/#guide\/io$/);
  await dialog.locator('article a[href="#guide/mcp"]').first().click();
  await expect(page).toHaveURL(/#guide\/mcp$/);
  mark("Global search and relative links navigate between actual documents");
  await dialog
    .getByRole("navigation", { name: "API 文档章节" })
    .getByRole("button")
    .filter({ hasText: "接入总览" })
    .click();
  await dialog
    .locator("article a")
    .filter({ hasText: "AI 文档中的本地演练" })
    .click();
  await expect(page).toHaveURL(/#guide\/ai$/);
  await expect(
    dialog.locator('[id="无需密钥的本地接入演练"]'),
  ).toBeInViewport();
  expect(
    await dialog.locator("article").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(100);
  await dialog
    .getByRole("navigation", { name: "API 文档章节" })
    .getByRole("button")
    .filter({ hasText: "MCP 与 AI 对话" })
    .click();
  mark("Chinese heading anchors resolve after switching documents");
  const outline = dialog.getByRole("complementary", { name: "本页目录" });
  await outline.getByRole("button").nth(4).click();
  expect(
    await dialog.locator("article").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(50);
  mark("Page outline scrolls to rendered headings");
  const code = dialog.locator(".guide-code").first();
  const expectedCode = (await code.locator("pre").textContent()).replace(
    /\n$/,
    "",
  );
  await code.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(code.getByRole("button", { name: "代码已复制" })).toBeVisible();
  expect(await page.evaluate(() => window.__guideClipboard)).toBe(expectedCode);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载 Markdown" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("MCP_GUIDE.md");
  expect(await fs.readFile(await download.path(), "utf8")).toBe(
    await fs.readFile(path.join(root, "docs/MCP_GUIDE.md"), "utf8"),
  );
  mark("Code copies exactly and Markdown download preserves the source");
  const external = dialog.locator('article a[href^="https://"]').first();
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeVisible();
  await expect(entry).toBeFocused();
  mark(
    "Esc closes only the guide, restores focus, and external links open safely",
  );
  await page.keyboard.press("Escape");
  await page.getByTitle("连接 AI 与 MCP", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "连接设置" });
  await settings.getByRole("button", { name: "接入指南", exact: true }).click();
  await expect(page).toHaveURL(/#guide\/ai$/);
  await page.keyboard.press("Escape");
  await settings.getByRole("button", { name: "MCP 连接", exact: true }).click();
  await settings.getByRole("button", { name: "接入指南", exact: true }).click();
  await expect(page).toHaveURL(/#guide\/mcp$/);
  await page.keyboard.press("Escape");
  mark("Connection center opens the guide for its active AI or MCP tab");
  await settings
    .getByRole("button", { name: "编辑 MCP 连接 文档测试服务" })
    .click();
  await expect(settings.getByLabel("服务 ID", { exact: true })).toHaveValue(
    "docs_fixture",
  );
  await expect(
    settings.getByRole("combobox", { name: "工具权限", exact: true }),
  ).toHaveValue("selected");
  await expect(
    settings.getByRole("textbox", { name: "允许的工具名称", exact: true }),
  ).toHaveValue("echo, read_value");
  await settings.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(Object.hasOwn(sent[0], "token")).toBe(false);
  expect(sent[0].allowed_tools).toEqual(["echo", "read_value"]);
  expect(mcp.token).toBe("fixture-token-not-a-real-secret");
  await settings
    .getByRole("textbox", { name: "允许的工具名称", exact: true })
    .fill("echo，read_value\necho");
  await settings.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].allowed_tools).toEqual(["echo", "read_value"]);
  await settings
    .getByRole("combobox", { name: "工具权限", exact: true })
    .selectOption("none");
  await settings.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2].allowed_tools).toEqual([]);
  await settings
    .getByRole("combobox", { name: "工具权限", exact: true })
    .selectOption("all");
  await settings.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3].allowed_tools).toBe(null);
  await settings
    .getByRole("combobox", { name: "工具权限", exact: true })
    .selectOption("selected");
  await settings
    .getByRole("textbox", { name: "允许的工具名称", exact: true })
    .fill("");
  await settings.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("请填写至少一个工具名");
  expect(sent.length).toBe(4);
  await settings
    .getByRole("combobox", { name: "工具权限", exact: true })
    .selectOption("all");
  await settings
    .getByPlaceholder("填写新 Token 可替换已保存凭证")
    .fill("fixture-new-token");
  await settings.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect.poll(() => sent.length).toBe(5);
  expect(sent[4].token).toBe("fixture-new-token");
  await settings.getByRole("button", { name: "新增连接", exact: true }).click();
  await expect(settings.getByLabel("服务 ID", { exact: true })).not.toHaveValue(
    "docs_fixture",
  );
  mark(
    "MCP editing preserves blank credentials and saves all three tool policies",
  );
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  for (const [id] of sections) {
    await page.evaluate((id) => {
      window.location.hash = "guide/" + id;
    }, id);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("article")).toBeVisible();
  }
  await page.reload({ waitUntil: "networkidle" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("article h1")).toContainText("本地模型");
  mark("Six hash deep links and page reload open their document directly");
  await page.screenshot({ path: path.join(root, "docs/images/api-guide.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const jump = dialog.getByRole("combobox", { name: "跳转到文档章节" });
  await jump.selectOption({ index: 4 });
  expect(
    await dialog.locator("article").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(100);
  await page.screenshot({ path: path.join(artifacts, "api-guide-mobile.png") });
  mark(
    "390px view keeps wide tables and code contained and provides a mobile outline",
  );
  expect(errors).toEqual([]);
  mark("No browser JavaScript errors");
} finally {
  await fs.writeFile(
    path.join(artifacts, "api-guide-browser.json"),
    JSON.stringify(
      {
        checks,
        errors,
        apiIsolation:
          "All /api requests intercepted; no real configuration or projects touched",
      },
      null,
      2,
    ),
  );
  await browser.close();
  await server.close();
}
