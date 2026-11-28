/**
 * fighting-plus 共享协议类型
 * 服务端(apps/server)、Web 端(apps/frontend)、桌面客户端(apps/client) 共用。
 */

/** 小队人数上限 */
export const ROOM_MAX_MEMBERS = 3;

/** 房间码前缀与长度（不含前缀） */
export const ROOM_CODE_PREFIX = 'FP-';
export const ROOM_CODE_LENGTH = 6;

/** 画面排列方式 */
export type Orientation = 'landscape' | 'portrait';

/** 成员呼号：按加入顺序分配 */
export const CALLSIGNS = ['A', 'B', 'C'] as const;
export type Callsign = (typeof CALLSIGNS)[number];

/** 默认昵称与画面标签（按席位） */
export const DEFAULT_NICKNAMES = ['猎手', '猎隼', '夜枭'] as const;
export const DEFAULT_FEED_LABELS = ['OBS 采集画面', '战术地图', '第一视角'] as const;

/** SRS 流的实时信息 */
export interface StreamInfo {
  /** 是否正在推流 */
  online: boolean;
  /** 推流开始时间（服务端首次探测到的时间戳，毫秒） */
  onlineSince: number | null;
  /** 码率（kbps） */
  bitrateKbps: number | null;
  /** 视频编码，如 h264 */
  videoCodec: string | null;
  /** 音频编码，如 aac */
  audioCodec: string | null;
}

/** 成员（对房间内所有人可见，不含串流密钥） */
export interface MemberDto {
  id: string;
  callsign: Callsign;
  nickname: string;
  /** 画面标签，如「战术地图」 */
  feedLabel: string;
  /** 是否已连接 WebSocket */
  online: boolean;
  /** 房间创建者 */
  isCreator: boolean;
  joinedAt: number;
  /** 只读拉流令牌：通过 /live/<playToken>.flv 播放，不会暴露可推流的串流密钥 */
  playToken: string;
  stream: StreamInfo;
}

/** 当前登录成员（仅本人可见，含串流密钥） */
export interface SelfDto {
  id: string;
  callsign: Callsign;
  nickname: string;
  feedLabel: string;
  /** 后续连接使用的凭证 */
  token: string;
  /** OBS 串流密钥（同时是 SRS 的流名） */
  streamKey: string;
  /** OBS 推流服务器地址（按当前请求的 Host 推导） */
  rtmpServer: string;
}

/** 房间 */
export interface RoomDto {
  code: string;
  /** 房间密码（原型中与房间码一致） */
  passcode: string;
  /** OBS 推流服务器地址 */
  rtmpServer: string;
  maxMembers: number;
  createdAt: number;
  /** SRS 流媒体服务是否可达 */
  srsOnline: boolean;
  members: MemberDto[];
}

/* ---------------- REST ---------------- */

export interface CreateRoomBody {
  memberId?: string;
  nickname?: string;
}

export interface JoinRoomBody {
  memberId?: string;
  nickname?: string;
  /** 重新加入时携带，用于找回原有席位 */
  token?: string;
}

export interface RoomJoinResponse {
  room: RoomDto;
  self: SelfDto;
}

export interface HealthResponse {
  ok: true;
  /** SRS 流媒体服务是否可达 */
  srsOnline: boolean;
  time: string;
}

/* ---------------- WebSocket 消息 ---------------- */

/** 客户端 → 服务端 */
export type ClientMessage =
  | { t: 'room:join'; code: string; memberId: string; token: string }
  | { t: 'room:leave' }
  | { t: 'marker'; x: number; y: number; target: string; label?: string }
  | { t: 'stream:stop' }
  | { t: 'ping'; ts: number };

/** 服务端 → 客户端 */
export type ServerMessage =
  | { t: 'room:joined'; self: SelfDto; room: RoomDto }
  | { t: 'room:left' }
  | { t: 'room:update'; room: RoomDto }
  | { t: 'marker'; from: string; x: number; y: number; target: string; label?: string }
  | { t: 'pong'; ts: number }
  | { t: 'error'; message: string };

/** WebSocket 路径 */
export const WS_PATH = '/ws';

/** 媒体代理路径前缀：/live/<playToken>.flv */
export const MEDIA_PATH = '/live';

/** 标点在画面上停留的时长（毫秒） */
export const MARKER_TTL = 1100;
