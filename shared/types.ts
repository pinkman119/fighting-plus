/**
 * fighting-plus 客户端/服务端共享类型定义。
 * 注意：本文件仅包含类型（type-only），两端均以 `import type` 引用，
 * 运行时常量（如调色板）由各端自行定义，避免跨工程构建问题。
 */

// ---------- 标注 ----------

export type AnnotationType = 'pin' | 'arrow' | 'zone'

export interface PinPayload {
  x: number
  y: number
}

export interface ArrowPayload {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ZonePayload {
  shape: 'rect' | 'circle'
  x: number
  y: number
  w: number
  h: number
}

export type AnnotationPayload = PinPayload | ArrowPayload | ZonePayload

export interface Annotation {
  id: string
  type: AnnotationType
  payload: AnnotationPayload
  note?: string | null
  authorId: string
  authorNickname: string
  color: string
  /** epoch ms */
  createdAt: number
  updatedAt: number
}

// ---------- 地图 ----------

export interface MapInfo {
  url: string
  width: number
  height: number
}

// ---------- 房间与成员 ----------

export interface RoomMemberInfo {
  userId: string
  nickname: string
  avatar: string
  color: string
  isHost: boolean
  online: boolean
}

export interface RoomInfo {
  id: string
  name: string
  inviteCode: string
  hostId: string
  status: 'active' | 'archived'
  createdAt: string
}

export interface BoardSnapshot {
  roomId: string
  name: string
  inviteCode: string
  hostId: string
  map: MapInfo | null
  annotations: Annotation[]
  members: RoomMemberInfo[]
  lastSeq: number
}

// ---------- 实时事件（服务端 -> 客户端，均带 seq 保序） ----------

export interface SrvEnvelope<T> {
  seq: number
  roomId: string
  data: T
}

export interface SrvAnnotationAdd {
  annotation: Annotation
}
export interface SrvAnnotationUpdate {
  id: string
  patch: { note?: string | null }
}
export interface SrvAnnotationRemove {
  id: string
}
export interface SrvAnnotationRestore {
  annotations: Annotation[]
}
export interface SrvBoardClear {
  removedIds: string[]
}
export interface SrvMapChange {
  map: MapInfo
}
export interface SrvMemberOnline {
  member: RoomMemberInfo
}
export interface SrvMemberOffline {
  userId: string
}
export interface SrvHostChange {
  hostId: string
}
export interface SrvRoomArchived {
  matchId: string
}

export type SrvEventName =
  | 'annotation:add'
  | 'annotation:update'
  | 'annotation:remove'
  | 'annotation:restore'
  | 'board:clear'
  | 'map:change'
  | 'member:online'
  | 'member:offline'
  | 'host:change'
  | 'room:archived'

// ---------- 客户端 -> 服务端事件负载 ----------

export interface CliAnnotationAdd {
  type: AnnotationType
  payload: AnnotationPayload
  note?: string | null
}

export interface CliAnnotationUpdate {
  id: string
  note?: string | null
}

export interface CliAnnotationRemove {
  id: string
}

export interface CliAnnotationRestore {
  ids: string[]
}

export interface CliMapChange {
  url: string
  width: number
  height: number
}

export interface CliHostTransfer {
  targetUserId: string
}

// ---------- 账号 ----------

export interface UserInfo {
  id: string
  email: string
  nickname: string
  avatar: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthResult extends AuthTokens {
  user: UserInfo
}

// ---------- 历史局 ----------

export interface MatchSummary {
  id: string
  name: string
  endedAt: string
  participants: { userId: string; nickname: string; color: string }[]
}

export interface MatchDetail extends MatchSummary {
  map: MapInfo | null
  annotations: Annotation[]
  startedAt: string
}
