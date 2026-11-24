import { app, BrowserWindow, globalShortcut, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

const OVERLAY_HOTKEY = process.env.OVERLAY_HOTKEY || 'Alt+Q'

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'fighting-plus',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Overlay：透明置顶窗口，绝不注入游戏进程 */
function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: 960,
    height: 640,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')

  if (process.env.ELECTRON_RENDERER_URL) {
    void overlayWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/overlay`)
  } else {
    void overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
  }
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function toggleOverlay(): void {
  if (!overlayWindow) createOverlayWindow()
  if (!overlayWindow) return
  if (overlayWindow.isVisible()) {
    overlayWindow.hide()
  } else {
    overlayWindow.show()
    overlayWindow.focus()
  }
}

// ---------- IPC ----------

/** Overlay 点击穿透切换（forward 保持 hover 事件供界面切换按钮使用） */
ipcMain.on('overlay:set-click-through', (_e, enabled: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(enabled, { forward: true })
})

/** Token 安全存储：safeStorage 加密后落盘（Windows DPAPI） */
function tokenFilePath(): string {
  return join(app.getPath('userData'), 'tokens.dat')
}

ipcMain.handle('tokens:get', () => {
  try {
    if (!existsSync(tokenFilePath())) return null
    const raw = readFileSync(tokenFilePath())
    const plain = safeStorage.decryptString(raw)
    return JSON.parse(plain) as { accessToken: string; refreshToken: string } | null
  } catch {
    return null
  }
})

ipcMain.handle('tokens:set', (_e, tokens: { accessToken: string; refreshToken: string }) => {
  const raw = safeStorage.encryptString(JSON.stringify(tokens))
  writeFileSync(tokenFilePath(), raw)
})

ipcMain.handle('tokens:clear', () => {
  try {
    if (existsSync(tokenFilePath())) unlinkSync(tokenFilePath())
  } catch {
    // ignore
  }
})

// ---------- 生命周期 ----------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    createMainWindow()

    // 全局热键：呼出/隐藏 Overlay（任务 5.2）
    try {
      globalShortcut.register(OVERLAY_HOTKEY, () => toggleOverlay())
    } catch (err) {
      console.error('register hotkey failed:', err)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    globalShortcut.unregisterAll()
    app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
