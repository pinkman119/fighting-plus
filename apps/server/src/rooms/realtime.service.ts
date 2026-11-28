import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Duplex } from 'node:stream';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { Subject } from 'rxjs';
import WebSocket from 'ws';
import { WS_PATH, type ClientMessage, type ServerMessage } from '../../../../packages/shared/protocol';

/** 挂在 socket 上的会话信息 */
export interface SocketSession {
  memberId?: string;
  code?: string;
  lastSeen: number;
}

export type ClientSocket = WebSocket & { data: SocketSession };

/** 空闲超时：客户端应定期发送 ping（同时用于测量往返延迟） */
const IDLE_TIMEOUT_MS = 60_000;

/**
 * 原生 WebSocket 实时通道（与 HTTP 同端口，路径 /ws）。
 * 本服务只负责连接管理 / 编解码 / 投递，业务语义由 RoomsService 处理。
 */
@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private wss?: WebSocket.Server;
  private sweeper?: NodeJS.Timeout;

  /** 收到的客户端消息 */
  readonly inbound = new Subject<{ socket: ClientSocket; msg: ClientMessage }>();
  /** 连接关闭 */
  readonly closed = new Subject<ClientSocket>();

  constructor(@Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost) {}

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter?.getHttpServer() as HttpServer | undefined;
    if (!httpServer) {
      this.logger.warn('未找到 HTTP Server，实时通道未启动');
      return;
    }
    this.wss = new WebSocket.Server({ noServer: true });

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let pathname = '';
      try {
        pathname = new URL(req.url || '/', 'http://localhost').pathname;
      } catch {
        pathname = '';
      }
      if (pathname !== WS_PATH || !this.wss) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss!.emit('connection', ws, req));
    });

    this.wss.on('connection', (socket: WebSocket) => {
      const client = socket as ClientSocket;
      client.data = { lastSeen: Date.now() };
      client.on('message', (raw) => this.onMessage(client, raw));
      client.on('close', () => this.closed.next(client));
      client.on('error', (err) => this.logger.debug(`WebSocket 异常: ${String(err)}`));
    });

    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
    this.logger.log(`实时通道就绪: ws://<host>${WS_PATH}`);
  }

  onApplicationShutdown() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.inbound.complete();
    this.closed.complete();
    this.wss?.close();
  }

  /** 给单个连接发消息 */
  send(socket: ClientSocket | undefined, msg: ServerMessage): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
  }

  /** 给房间内所有已加入的连接广播 */
  broadcast(code: string, msg: ServerMessage, except?: ClientSocket): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients()) {
      if (client === except || client.data?.code !== code) continue;
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
    }
  }

  /** 当前连接数 */
  get connectionCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  /** 房间内已加入的连接 */
  socketsInRoom(code: string): ClientSocket[] {
    return [...this.clients()].filter((c) => c.data?.code === code);
  }

  private clients(): Set<ClientSocket> {
    return (this.wss?.clients ?? new Set()) as Set<ClientSocket>;
  }

  private onMessage(socket: ClientSocket, raw: WebSocket.RawData) {
    socket.data.lastSeen = Date.now();
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      this.send(socket, { t: 'error', message: '消息格式错误' });
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') {
      this.send(socket, { t: 'error', message: '消息格式错误' });
      return;
    }
    this.inbound.next({ socket, msg });
  }

  private sweep() {
    const now = Date.now();
    for (const client of this.clients()) {
      if (now - (client.data?.lastSeen ?? now) > IDLE_TIMEOUT_MS) client.terminate();
    }
  }
}
