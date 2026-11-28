import { apiBase } from '@/platform';
import type { CreateRoomBody, HealthResponse, JoinRoomBody, RoomDto, RoomJoinResponse } from '../../../../packages/shared/protocol';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function extractMessage(data: unknown, status: number): string {
  const msg = (data as { message?: unknown } | null)?.message;
  if (Array.isArray(msg) && msg.length) return String(msg[0]);
  if (typeof msg === 'string' && msg) return msg;
  return `请求失败 (${status})`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ApiError(0, '无法连接服务器，请确认服务端已启动');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, extractMessage(data, res.status));
  return data as T;
}

export const api = {
  health: () => request<HealthResponse>('GET', '/api/health'),
  createRoom: (body: CreateRoomBody) => request<RoomJoinResponse>('POST', '/api/rooms', body),
  inspectRoom: (code: string) => request<RoomDto>('GET', `/api/rooms/${encodeURIComponent(code)}`),
  joinRoom: (code: string, body: JoinRoomBody) =>
    request<RoomJoinResponse>('POST', `/api/rooms/${encodeURIComponent(code)}/join`, body),
  leaveRoom: (code: string, memberId: string) =>
    request<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/leave`, { memberId }),
};
