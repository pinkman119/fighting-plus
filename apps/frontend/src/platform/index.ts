/**
 * 运行平台抽象：
 * - Web 端（PC / 平板 / 手机）：同源请求
 * - 桌面客户端（Electron）：通过 preload 注入的 window.fp 访问原生能力
 */
export interface DesktopBridge {
  readonly isDesktop: true;
  readonly appVersion: string;
  /** 服务端地址，如 http://localhost:3118 */
  readonly serverUrl: string;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximized(callback: (maximized: boolean) => void): void;
  };
  config: {
    getServerUrl(): Promise<string>;
    setServerUrl(url: string): Promise<string>;
    reload(): void;
  };
}

export const desktop: DesktopBridge | undefined =
  typeof window !== 'undefined' ? (window as { fp?: DesktopBridge }).fp : undefined;

export const isDesktop = Boolean(desktop?.isDesktop);

/** 客户端 / 页面版本 */
export const APP_VERSION = desktop?.appVersion || '1.0.4';

/** REST 基地址（Web 端为同源空串） */
export function apiBase(): string {
  return (desktop?.serverUrl || '').replace(/\/+$/, '');
}

/** WebSocket 地址 */
export function wsUrl(): string {
  const base = apiBase();
  if (base) return `${base.replace(/^http/, 'ws')}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** 媒体 / 静态资源地址（同源代理到 SRS） */
export function mediaUrl(path: string): string {
  return `${apiBase()}${path}`;
}
