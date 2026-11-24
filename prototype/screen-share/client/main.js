const { app, BrowserWindow, desktopCapturer, session } = require('electron')
const path = require('node:path')

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '屏幕共享原型',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.loadFile(path.join(__dirname, 'index.html'))
}

void app.whenReady().then(() => {
  // 原型简化：请求屏幕共享时跳过系统选择弹窗，直接采集主显示器
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length === 0) return callback({})
        callback({ video: sources[0] })
      })
      .catch(() => callback({}))
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
