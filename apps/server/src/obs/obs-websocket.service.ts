import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { createHash } from 'node:crypto';

/**
 * 极简 obs-websocket v5 协议客户端（JSON over WebSocket）。
 * 仅实现本原型需要的部分：Identify（含鉴权）+ Request/RequestResponse。
 * OBS 端需开启：工具 → WebSocket 服务器（默认端口 4455）。
 */

type WsMessage = {
  op: number;
  d?: Record<string, unknown>;
};

interface PendingRequest {
  resolve: (responseData: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class ObsWebsocketService {
  private readonly logger = new Logger(ObsWebsocketService.name);

  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<string, PendingRequest>();

  /** 连接并完成 Identify 握手（op0 Hello → op1 Identify → op2 Identified） */
  connect(url: string, password: string, timeoutMs = 5000): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error(`连接 OBS 超时（${url}），请确认 OBS 已启动并开启了 WebSocket 服务器`));
        this.close();
      }, timeoutMs);

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`无法连接 OBS WebSocket（${url}）：${err.message}`));
        this.close();
      });

      ws.on('message', (raw) => this.handleMessage(raw.toString()));

      ws.on('close', () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('OBS WebSocket 连接已关闭'));
        }
        this.pending.clear();
      });

      const identify = (challenge?: string, salt?: string) => {
        const d: Record<string, unknown> = { rpcVersion: 1 };
        if (challenge && salt && password) {
          d.authentication = this.encodeAuth(password, salt, challenge);
        }
        ws.send(JSON.stringify({ op: 1, d }));
      };

      // 等待 op0 Hello
      const onHello = (raw: { toString(): string }) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsMessage;
          if (msg.op === 0) {
            const auth = msg.d?.authentication as
              | { challenge?: string; salt?: string }
              | undefined;
            identify(auth?.challenge, auth?.salt);
            ws.off('message', onHello);
            ws.on('message', (raw2) => this.handleMessage(raw2.toString()));
            clearTimeout(timer);
            resolve();
          }
        } catch {
          /* 忽略非 JSON */
        }
      };

      const onIdentified = (raw: { toString(): string }) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsMessage;
          if (msg.op === 2) {
            clearTimeout(timer);
            resolve();
          }
        } catch {
          /* ignore */
        }
      };

      ws.on('message', onHello as never);
      ws.on('message', onIdentified as never);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
  }

  /** 发送一次请求并等待 RequestResponse（op6 → op7） */
  request<T = Record<string, unknown>>(
    requestType: string,
    requestData?: Record<string, unknown>,
    timeoutMs = 8000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('OBS WebSocket 未连接'));
        return;
      }
      const requestId = `req-${this.nextId++}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS 请求超时: ${requestType}`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (responseData) => resolve(responseData as T),
        reject,
        timer,
      });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  private handleMessage(text: string) {
    try {
      const msg = JSON.parse(text) as WsMessage;
      if (msg.op !== 7) return; // 只处理 RequestResponse
      const d = msg.d as {
        requestId?: string;
        requestStatus?: { result?: boolean; code?: number; comment?: string };
        responseData?: Record<string, unknown>;
      };
      const pending = d.requestId ? this.pending.get(d.requestId) : undefined;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(d.requestId!);
      const status = d.requestStatus;
      if (!status?.result) {
        pending.reject(
          new Error(
            `OBS 请求失败: ${String(status?.comment || status?.code || '未知错误')}`,
          ),
        );
      } else {
        pending.resolve(d.responseData || {});
      }
    } catch (err) {
      this.logger.warn(`解析 OBS 消息失败: ${String(err)}`);
    }
  }

  /** obs-websocket v5 鉴权算法 */
  private encodeAuth(password: string, salt: string, challenge: string): string {
    const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    const b64 = (s: string) => Buffer.from(s, 'hex').toString('base64');
    const secret = b64(sha256(password + salt));
    return b64(sha256(secret + challenge));
  }
}
