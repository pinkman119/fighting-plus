"use strict";
const electron = require("electron");
const node_fs = require("node:fs");
const node_path = require("node:path");
const DEFAULT_SERVER_URL = "http://localhost:3118";
const CONFIG_FILE = "config.json";
let mainWindow = null;
function configPath() {
  return node_path.join(electron.app.getPath("userData"), CONFIG_FILE);
}
function normalizeUrl(input) {
  const url = String(input || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[\w.\-:\[\]]+$/i.test(url)) {
    throw new Error(`服务端地址格式不正确: ${input}`);
  }
  return url;
}
function loadConfig() {
  const fallback = { serverUrl: process.env.FP_SERVER_URL || DEFAULT_SERVER_URL };
  const file = configPath();
  if (!node_fs.existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(node_fs.readFileSync(file, "utf8"));
    return {
      serverUrl: parsed.serverUrl || fallback.serverUrl,
      bounds: parsed.bounds
    };
  } catch {
    return fallback;
  }
}
function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try {
    const file = configPath();
    node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
    node_fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.error("[fighting-plus] 写入配置失败", err);
  }
  return next;
}
function registerIpc() {
  electron.ipcMain.on("fp:window:minimize", () => mainWindow?.minimize());
  electron.ipcMain.on("fp:window:toggle-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  electron.ipcMain.on("fp:window:close", () => mainWindow?.close());
  electron.ipcMain.handle("fp:window:is-maximized", () => Boolean(mainWindow?.isMaximized()));
  electron.ipcMain.handle("fp:config:get-server-url", () => loadConfig().serverUrl);
  electron.ipcMain.handle("fp:config:set-server-url", (_event, url) => saveConfig({ serverUrl: normalizeUrl(url) }).serverUrl);
  electron.ipcMain.on("fp:config:reload", () => mainWindow?.webContents.reloadIgnoringCache());
}
function createWindow() {
  const config = loadConfig();
  const bounds = config.bounds;
  const win = new electron.BrowserWindow({
    width: bounds?.width || 1460,
    height: bounds?.height || 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: "#0e0f0d",
    title: "fighting-plus · 战术协作系统",
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--fp-server-url=${config.serverUrl}`, `--fp-app-version=${electron.app.getVersion()}`]
    }
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  const rememberBounds = () => {
    if (win.isMaximized() || win.isMinimized()) return;
    saveConfig({ bounds: win.getBounds() });
  };
  win.on("resize", rememberBounds);
  win.on("move", rememberBounds);
  const sendMaximized = () => win.webContents.send("fp:window:maximized", win.isMaximized());
  win.on("maximize", sendMaximized);
  win.on("unmaximize", sendMaximized);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.setName("fighting-plus");
if (!electron.app.requestSingleInstanceLock()) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  electron.app.whenReady().then(() => {
    electron.session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    electron.session.defaultSession.setPermissionCheckHandler(() => false);
    registerIpc();
    createWindow();
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  electron.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") electron.app.quit();
  });
}
