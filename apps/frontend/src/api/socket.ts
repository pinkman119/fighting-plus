import type { ClientMessage, ServerMessage } from '../../../../packages/shared/protocol';
import { wsUrl } from '@/platform';

export interface SocketHandlers {
  onOpen(): void;
  onClose(): void;
  onMessage(msg: ServerMessage): void;
  /** 往返延迟（毫秒） */
  onRtt(rtt: number): void;
}

const PING_INTERVAL_MS = 5000;
const MAX_BACKOFF_MS = 5000;

/**
 * 房间实时通道客户端：自动重连、心跳（同时测量往返延迟）。
 */
export class RoomSocket {
  private ws?: WebSocket;
  private handlers: SocketHandlers;
  private attempt = 0;
  private reconnectTimer?: number;
  private pingTimer?: number;
  private closedByUser = false;

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByUser = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
  }

  private open(): void {
    window.clearTimeout(this.reconnectTimer);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.startPing();
      this.handlers.onOpen();
    };
    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        msg = null;
      }
      if (msg && typeof msg.t === 'string') this.handlers.onMessage(msg);
    };
    ws.onerror = () => {
      /* onclose 会随后触发 */
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.pingTimer = undefined;
      this.handlers.onClose();
      if (!this.closedByUser) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const delay = Math.min(MAX_BACKOFF_MS, 800 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 4);
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    window.clearInterval(this.pingTimer);
    const ping = () => this.send({ t: 'ping', ts: Date.now() });
    ping();
    this.pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
  }
}
