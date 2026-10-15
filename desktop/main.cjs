"use strict";
const { app, BrowserWindow, Menu, dialog, shell, session, desktopCapturer } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { sameOrigin, externalURL } = require("./security.cjs");

// No privileged renderer bridge: the exact browser UI talks to its owned backend.
const smokePath = process.env.TD_DESKTOP_SMOKE_REPORT;
if (smokePath) {
  const angle = process.env.TD_DESKTOP_SMOKE_ANGLE || (process.platform === "darwin" ? "default" : "swiftshader");
  if (angle !== "default") {
    app.commandLine.appendSwitch("use-gl", "angle");
    app.commandLine.appendSwitch("use-angle", angle);
    if (angle.startsWith("swiftshader")) app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  }
}
app.setName("TD Open");
app.setPath("userData", process.env.TD_DESKTOP_USER_DATA ? path.resolve(process.env.TD_DESKTOP_USER_DATA) : path.join(app.getPath("appData"), "TD Open"));
let backend, mainWindow, origin, quitting = false, allowQuit = false, ownedPID;
const workspace = path.join(app.getPath("userData"), "workspace");
fs.mkdirSync(path.join(workspace, "logs"), { recursive: true });
const logPath = path.join(workspace, "logs", "desktop.log");
if (fs.existsSync(logPath) && fs.statSync(logPath).size > 4 * 1024 * 1024) fs.renameSync(logPath, logPath + ".previous");
const log = fs.createWriteStream(logPath, { flags: "a" });
const token = crypto.randomBytes(32).toString("hex");
function logLine(text) { log.write(new Date().toISOString() + " " + String(text).replaceAll(token, "[redacted]") + "\n"); }

function resources() {
  return process.env.TD_DESKTOP_RESOURCES || (app.isPackaged
    ? path.join(process.resourcesPath, "td-runtime") : path.resolve(__dirname, "../build/desktop/resources"));
}
async function exportMCPConfig() {
  const root = resources(), manifest = JSON.parse(fs.readFileSync(path.join(root, "runtime.json"), "utf8"));
  const config = { mcpServers: { "td-open": {
    command: path.join(root, manifest.python),
    args: [path.join(root, "application/backend/desktop_mcp.py"), "--session", path.join(workspace, ".desktop-session.json")],
  } } };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: "导出给外部 AI 的 MCP 配置", defaultPath: "TD-Open-MCP.json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!canceled && filePath) {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
    await dialog.showMessageBox(mainWindow, { message: "MCP 配置已导出", detail: "将 mcpServers 中的 td-open 项加入 AI 客户端的配置。连接时保持 TD Open 开启。配置不包含 API 密钥。" });
  }
}
async function startBackend() {
  const root = resources();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "runtime.json"), "utf8"));
  const resolve = (name) => path.join(root, manifest[name]);
  const env = { ...process.env, TD_WORKSPACE_DIR: workspace, TD_DATA_DIR: "data", TD_LOCAL_AI_DIR: "data/local-ai",
    TD_DESKTOP_TOKEN: token, TD_NODE_BINARY: resolve("node"), TD_CHROMIUM: resolve("chromium"),
    PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1", PYTHONNOUSERSITE: "1",
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, "browsers"),
    PATH: [path.dirname(resolve("node")), path.dirname(resolve("python")), path.dirname(resolve("ffmpeg")), process.env.PATH || ""].join(path.delimiter) };
  // Avoid inherited Python configuration redirecting the bundled interpreter.
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  backend = spawn(resolve("python"), ["-m", "backend.desktop"], {
    cwd: path.join(root, "application"), env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
  });
  ownedPID = backend.pid;
  backend.stderr.on("data", chunk => logLine(chunk.toString()));
  const lines = readline.createInterface({ input: backend.stdout });
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("本地引擎启动超时，请查看日志")), 90000);
    backend.once("error", error => { clearTimeout(timer); reject(error); });
    backend.once("exit", (code, signal) => {
      clearTimeout(timer); logLine(`Backend exited: ${code} ${signal}`);
      if (!origin) reject(new Error(`本地引擎未能启动 (${code})`));
      else if (!quitting) {
        dialog.showErrorBox("本地引擎已停止", "请重新打开 TD Open。作品已自动保存在用户目录。\n日志：" + logPath);
        app.quit();
      }
    });
    lines.on("line", line => {
      try {
        const message = JSON.parse(line);
        if (message.event === "ready" && message.pid === ownedPID && Number.isInteger(message.port) && message.port > 0 && message.port < 65536) {
          clearTimeout(timer); origin = `http://127.0.0.1:${message.port}`; resolveReady(origin); return;
        }
      } catch {}
      logLine(line);
    });
  });
}

function secureWindow(win) {
  win.webContents.on("will-navigate", (event, url) => {
    if (!sameOrigin(url, origin)) { event.preventDefault(); if (externalURL(url)) void shell.openExternal(url); }
  });
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, origin)) {
      const child = new BrowserWindow({ width: 1000, height: 720, parent: mainWindow,
        webPreferences: { session: session.defaultSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
      secureWindow(child); void child.loadURL(url);
    } else if (externalURL(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

async function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  const exited = new Promise(resolve => backend.once("exit", resolve));
  backend.stdin.on("error", () => {});
  backend.stdin.end("shutdown\n");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 12000))]);
  if (backend.exitCode === null) {
    if (process.platform === "win32") await new Promise(resolve => execFile("taskkill", ["/pid", String(ownedPID), "/T", "/F"], { windowsHide: true }, resolve));
    else { try { process.kill(-ownedPID, "SIGKILL"); } catch {} }
  }
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.on("before-quit", event => {
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void stopBackend().finally(() => { allowQuit = true; app.quit(); });
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(async () => {
    mainWindow = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1100, minHeight: 700,
      title: "TD Open", backgroundColor: "#15171d", show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    mainWindow.once("ready-to-show", () => mainWindow.show());
    await mainWindow.loadFile(path.join(__dirname, "loading.html"));
    await startBackend();
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      // Includes the matching ws origin for bridge connections, never remote hosts.
      const normalized = details.url.replace(/^ws:/, "http:");
      if (sameOrigin(normalized, origin)) headers["x-td-desktop-token"] = token;
      callback({ requestHeaders: headers });
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
      sameOrigin(requestingOrigin, origin) && ["media", "midi", "midiSysex", "clipboard-sanitized-write", "fullscreen", "display-capture"].includes(permission));
    session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback) => {
      if (!contents || !sameOrigin(contents.getURL(), origin)) return callback(false);
      if (["fullscreen", "clipboard-sanitized-write", "display-capture"].includes(permission)) return callback(true);
      if (!["media", "midi", "midiSysex"].includes(permission)) return callback(false);
      const result = await dialog.showMessageBox(mainWindow, { type: "question", buttons: ["允许", "取消"], defaultId: 1, cancelId: 1,
        message: permission === "media" ? "允许工作台使用摄像头或麦克风？" : "允许工作台访问 MIDI 设备？" });
      callback(result.response === 0);
    });
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!sameOrigin(request.securityOrigin, origin)) return callback({});
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
        let chosen = false;
        Menu.buildFromTemplate([
          { label: "选择要共享的屏幕或窗口", enabled: false },
          ...sources.map(source => ({ label: source.name, click: () => {
            chosen = true;
            callback({ video: source, ...(request.audioRequested && process.platform === "win32" ? { audio: "loopback" } : {}) });
          }})),
          { type: "separator" }, { label: "取消", click: () => {} },
        ]).popup({ window: mainWindow, callback: () => { if (!chosen) callback({}); } });
      } catch (error) { logLine(error); callback({}); }
    }, { useSystemPicker: true });
    secureWindow(mainWindow);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu", label: "TD Open" }] : []),
      { label: "文件", submenu: [{ label: "打开作品与模型目录", click: () => shell.openPath(path.join(workspace, "data")) },
        { label: "导出 MCP 接入配置…", click: () => exportMCPConfig().catch(error => dialog.showErrorBox("配置导出失败", String(error))) },
        { label: "打开运行日志", click: () => shell.openPath(path.dirname(logPath)) }, { type: "separator" }, { role: "quit", label: "退出" }] },
      { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "视图", submenu: [{ role: "reload", label: "重新加载工作台" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
      { label: "帮助", submenu: [{ label: "使用文档", click: () => shell.openExternal("https://github.com/GreyNails/td-open/blob/main/docs/DESKTOP.md") },
        { label: "关于 TD Open", click: () => dialog.showMessageBox(mainWindow, { message: `TD Open ${app.getVersion()}`, detail: "与网页版共享节点、工作流及 Python 引擎。\n用户数据：" + workspace }) }] },
    ]));
    await mainWindow.loadURL(origin);
    if (smokePath) {
      await require("./smoke.cjs").smoke(mainWindow, { origin, workspace, report: smokePath, backendPID: ownedPID });
      app.quit();
    }
  }).catch(async error => {
    logLine(error.stack || error);
    if (smokePath) {
      fs.mkdirSync(path.dirname(smokePath), { recursive: true });
      let partial = {};
      try { partial = JSON.parse(fs.readFileSync(smokePath, "utf8")); } catch {}
      fs.writeFileSync(smokePath, JSON.stringify({ ...partial, passed: false, error: String(error), logPath }));
    }
    else dialog.showErrorBox("TD Open 启动失败", String(error.message || error) + "\n日志：" + logPath);
    process.exitCode = 1; app.quit();
  });
}
