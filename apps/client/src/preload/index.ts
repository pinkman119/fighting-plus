import { contextBridge, ipcRenderer } from 'electron';

/**
 * 预加载脚本：以最小权限向渲染层暴露 window.fp。
 * 渲染层代码与 Web 端完全一致，通过 window.fp 是否存在来区分桌面环境。
 */
const SERVER_ARG = '--fp-server-url=';
const VERSION_ARG = '--fp-app-version=';

const argValue = (prefix: string): string | undefined => process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);

const serverUrl = argValue(SERVER_ARG) || 'http://localhost:3118';
const appVersion = argValue(VERSION_ARG) || '1.0.4';

contextBridge.exposeInMainWorld('fp', {
  isDesktop: true,
  appVersion,
  serverUrl,
  window: {
    minimize: () => ipcRenderer.send('fp:window:minimize'),
    toggleMaximize: () => ipcRenderer.send('fp:window:toggle-maximize'),
    close: () => ipcRenderer.send('fp:window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('fp:window:is-maximized'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      ipcRenderer.on('fp:window:maximized', (_event, maximized: boolean) => callback(maximized));
    },
  },
  config: {
    getServerUrl: (): Promise<string> => ipcRenderer.invoke('fp:config:get-server-url'),
    setServerUrl: (url: string): Promise<string> => ipcRenderer.invoke('fp:config:set-server-url', url),
    reload: () => ipcRenderer.send('fp:config:reload'),
  },
});
