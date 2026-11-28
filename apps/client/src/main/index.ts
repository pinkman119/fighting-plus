import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * fighting-plus 桌面客户端主进程：
 * - 无边框窗口 + 自定义标题栏（窗口控制通过 IPC）
 * - 服务端地址配置（userData/config.json，可用环境变量 FP_SERVER_URL 覆盖）
 */

const DEFAULT_SERVER_URL = 'http://localhost:3118';
const CONFIG_FILE = 'config.json';

interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface AppConfig {
  serverUrl: string;
  bounds?: WindowBounds;
}

let mainWindow: BrowserWindow | null = null;

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

function normalizeUrl(input: string): string {
  const url = String(input || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[\w.\-:\[\]]+$/i.test(url)) {
    throw new Error(`服务端地址格式不正确: ${input}`);
  }
  return url;
}

function loadConfig(): AppConfig {
  const fallback: AppConfig = { serverUrl: process.env.FP_SERVER_URL || DEFAULT_SERVER_URL };
  const file = configPath();
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
    return {
      serverUrl: parsed.serverUrl || fallback.serverUrl,
      bounds: parsed.bounds,
    };
  } catch {
    return fallback;
  }
}

function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...loadConfig(), ...patch };
  try {
    const file = configPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('[fighting-plus] 写入配置失败', err);
  }
  return next;
}

function registerIpc(): void {
  ipcMain.on('fp:window:minimize', () => mainWindow?.minimize());
  ipcMain.on('fp:window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('fp:window:close', () => mainWindow?.close());
  ipcMain.handle('fp:window:is-maximized', () => Boolean(mainWindow?.isMaximized()));

  ipcMain.handle('fp:config:get-server-url', () => loadConfig().serverUrl);
  ipcMain.handle('fp:config:set-server-url', (_event, url: string) => saveConfig({ serverUrl: normalizeUrl(url) }).serverUrl);
  ipcMain.on('fp:config:reload', () => mainWindow?.webContents.reloadIgnoringCache());

}

function createWindow(): void {
  const config = loadConfig();
  const bounds = config.bounds;
  const win = new BrowserWindow({
    width: bounds?.width || 1460,
    height: bounds?.height || 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#0e0f0d',
    title: 'fighting-plus · 战术协作系统',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--fp-server-url=${config.serverUrl}`, `--fp-app-version=${app.getVersion()}`],
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());

  const rememberBounds = () => {
    if (win.isMaximized() || win.isMinimized()) return;
    saveConfig({ bounds: win.getBounds() });
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);

  const sendMaximized = () => win.webContents.send('fp:window:maximized', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // 安全：禁止页面内导航到外部地址，外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.setName('fighting-plus');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 页面不采集摄像头/屏幕，所有权限一律拒绝
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
