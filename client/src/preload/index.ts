import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  /** Overlay 点击穿透切换 */
  setClickThrough: (enabled: boolean): void => ipcRenderer.send('overlay:set-click-through', enabled),
  /** Token 安全存储（safeStorage） */
  tokens: {
    get: () => ipcRenderer.invoke('tokens:get') as Promise<{ accessToken: string; refreshToken: string } | null>,
    set: (tokens: { accessToken: string; refreshToken: string }) =>
      ipcRenderer.invoke('tokens:set', tokens) as Promise<void>,
    clear: () => ipcRenderer.invoke('tokens:clear') as Promise<void>
  },
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

export type ElectronAPI = typeof electronAPI

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
