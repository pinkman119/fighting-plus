import {
  BadGatewayException,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Server, Socket } from 'socket.io'
import type {
  CliAnnotationAdd,
  CliAnnotationRemove,
  CliAnnotationRestore,
  CliAnnotationUpdate,
  CliHostTransfer,
  CliMapChange,
  BoardSnapshot,
  SrvEnvelope
} from '../../../shared/types'
import { AuthService } from '../auth/auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { BoardService } from './board.service'

/** 全员离线后自动归档阈值（30 分钟） */
const AUTO_ARCHIVE_IDLE_MS = 30 * 60 * 1000

interface AuthedSocket extends Socket {
  data: { userId: string; roomId?: string }
}

type Ack<T> = { ok: true; data: T } | { ok: false; error: string }

@WebSocketGateway({
  namespace: 'board',
  cors: { origin: process.env.FRONTEND_ORIGIN || true, credentials: true },
  // 心跳：pingTimeout 5s 内断连判定，满足“10 秒内标记离线”
  pingInterval: 5000,
  pingTimeout: 5000
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server

  /** roomId -> userId -> socketIds（同一用户主窗口 + Overlay 窗口可能多连接） */
  private roomSockets = new Map<string, Map<string, Set<string>>>()
  /** roomId -> 事件序号（服务端统一编号，保证各端应用顺序一致） */
  private seq = new Map<string, number>()

  constructor(
    private readonly boardService: BoardService,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService
  ) {}

  // ---------- 连接生命周期 ----------

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined
      if (!token) throw new Error('no token')
      const payload = await this.authService.verifyAccessToken(token)
      client.data.userId = payload.sub
    } catch {
      client.disconnect(true)
    }
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    const { userId, roomId } = client.data
    if (!roomId || !userId) return
    this.removeSocket(roomId, userId, client.id)
  }

  // ---------- 房间 ----------

  @SubscribeMessage('room:join')
  async joinRoom(client: AuthedSocket, payload: { roomId: string }): Promise<Ack<BoardSnapshot>> {
    const userId = client.data.userId
    const roomId = payload?.roomId
    if (!userId) return { ok: false, error: 'unauthorized' }
    if (!roomId) return { ok: false, error: 'roomId required' }

    const [room, member] = await Promise.all([
      this.prisma.room.findUnique({ where: { id: roomId } }),
      this.prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId, userId } }
      })
    ])
    if (!room || room.status !== 'active' || !member) {
      return { ok: false, error: 'room-not-available' }
    }

    // 分配颜色（首次入房）并刷新活跃时间
    await this.boardService.ensureColors(roomId)
    await this.boardService.touchActivity(roomId)

    await client.join(roomId)
    client.data.roomId = roomId
    this.addSocket(roomId, userId, client.id)

    const [base, members] = await Promise.all([
      this.boardService.getSnapshot(roomId),
      this.boardService.getMembers(roomId)
    ])
    const fullMembers = members.map((m) => ({
      ...m,
      isHost: m.userId === base.hostId,
      online: this.isUserOnline(roomId, m.userId)
    }))
    const snapshot: BoardSnapshot = {
      ...base,
      members: fullMembers,
      lastSeq: this.seq.get(roomId) ?? 0
    }

    const me = fullMembers.find((m) => m.userId === userId)
    if (me) {
      this.emitToRoomExcept(roomId, client.id, 'member:online', { member: me })
    }
    return { ok: true, data: snapshot }
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(client: AuthedSocket): Promise<Ack<null>> {
    const { userId, roomId } = client.data
    if (roomId && userId) {
      await client.leave(roomId)
      this.removeSocket(roomId, userId, client.id)
      client.data.roomId = undefined
    }
    return { ok: true, data: null }
  }

  @SubscribeMessage('host:transfer')
  async transferHost(client: AuthedSocket, payload: CliHostTransfer): Promise<Ack<{ hostId: string }>> {
    const roomId = this.requireRoom(client)
    try {
      const hostId = await this.boardService.transferHost(roomId, client.data.userId, payload.targetUserId)
      await this.boardService.touchActivity(roomId)
      this.emitToRoomExcept(roomId, client.id, 'host:change', { hostId })
      return { ok: true, data: { hostId } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---------- 标注 ----------

  @SubscribeMessage('annotation:add')
  async addAnnotation(client: AuthedSocket, payload: CliAnnotationAdd): Promise<Ack<{ id: string }>> {
    const roomId = this.requireRoom(client)
    const annotation = await this.boardService.createAnnotation(
      roomId,
      client.data.userId,
      payload.type,
      payload.payload,
      payload.note ?? null
    )
    await this.boardService.touchActivity(roomId)
    this.emitToRoomExcept(roomId, client.id, 'annotation:add', { annotation })
    return { ok: true, data: { id: annotation.id } }
  }

  @SubscribeMessage('annotation:update')
  async updateAnnotation(
    client: AuthedSocket,
    payload: CliAnnotationUpdate
  ): Promise<Ack<{ id: string }>> {
    const roomId = this.requireRoom(client)
    try {
      await this.boardService.updateAnnotation(roomId, client.data.userId, payload.id, payload.note ?? null)
      await this.boardService.touchActivity(roomId)
      this.emitToRoomExcept(roomId, client.id, 'annotation:update', { id: payload.id, patch: { note: payload.note ?? null } })
      return { ok: true, data: { id: payload.id } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  @SubscribeMessage('annotation:remove')
  async removeAnnotation(client: AuthedSocket, payload: CliAnnotationRemove): Promise<Ack<null>> {
    const roomId = this.requireRoom(client)
    await this.boardService.removeAnnotation(roomId, payload.id)
    await this.boardService.touchActivity(roomId)
    this.emitToRoomExcept(roomId, client.id, 'annotation:remove', { id: payload.id })
    return { ok: true, data: null }
  }

  @SubscribeMessage('annotation:restore')
  async restoreAnnotations(
    client: AuthedSocket,
    payload: CliAnnotationRestore
  ): Promise<Ack<{ count: number }>> {
    const roomId = this.requireRoom(client)
    const annotations = await this.boardService.restoreAnnotations(roomId, payload.ids ?? [])
    await this.boardService.touchActivity(roomId)
    this.emitToRoomExcept(roomId, client.id, 'annotation:restore', { annotations })
    return { ok: true, data: { count: annotations.length } }
  }

  @SubscribeMessage('board:clear')
  async clearBoard(client: AuthedSocket): Promise<Ack<{ removedIds: string[] }>> {
    const roomId = this.requireRoom(client)
    const removedIds = await this.boardService.clearBoard(roomId)
    await this.boardService.touchActivity(roomId)
    this.emitToRoomExcept(roomId, client.id, 'board:clear', { removedIds })
    return { ok: true, data: { removedIds } }
  }

  // ---------- 地图 ----------

  @SubscribeMessage('map:change')
  async changeMap(client: AuthedSocket, payload: CliMapChange): Promise<Ack<null>> {
    const roomId = this.requireRoom(client)
    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000'
    // 仅接受本服务上传的地图，防止任意外链
    if (!payload.url.startsWith(`${publicUrl}/uploads/`)) {
      return { ok: false, error: 'invalid-map-url' }
    }
    await this.boardService.setMap(roomId, {
      url: payload.url,
      width: payload.width,
      height: payload.height
    })
    await this.boardService.touchActivity(roomId)
    this.emitToRoomExcept(roomId, client.id, 'map:change', {
      map: { url: payload.url, width: payload.width, height: payload.height }
    })
    return { ok: true, data: null }
  }

  // ---------- 定时任务：全员离线 30 分钟自动归档 ----------

  @Cron(CronExpression.EVERY_MINUTE)
  async autoArchiveIdleRooms(): Promise<void> {
    const idleRoomIds = await this.boardService.findIdleActiveRooms(AUTO_ARCHIVE_IDLE_MS)
    for (const roomId of idleRoomIds) {
      // 仍有在线连接的不归档（活跃时间仅是兜底）
      if (this.isRoomOnline(roomId)) continue
      try {
        const matchId = await this.boardService.archiveRoom(roomId)
        this.emitToRoom(roomId, 'room:archived', { matchId })
        this.roomSockets.delete(roomId)
        this.seq.delete(roomId)
        console.log(`[board] room ${roomId} auto-archived -> match ${matchId}`)
      } catch (e) {
        // 房间可能刚好被手动归档等，忽略
      }
    }
  }

  // ---------- 内部工具 ----------

  private requireRoom(client: AuthedSocket): string {
    const roomId = client.data.roomId
    if (!roomId) throw new BadGatewayException('尚未加入房间')
    return roomId
  }

  private isRoomOnline(roomId: string): boolean {
    const users = this.roomSockets.get(roomId)
    if (!users) return false
    for (const sockets of users.values()) {
      if (sockets.size > 0) return true
    }
    return false
  }

  private isUserOnline(roomId: string, userId: string): boolean {
    return (this.roomSockets.get(roomId)?.get(userId)?.size ?? 0) > 0
  }

  private addSocket(roomId: string, userId: string, socketId: string): void {
    if (!this.roomSockets.has(roomId)) this.roomSockets.set(roomId, new Map())
    const users = this.roomSockets.get(roomId)!
    if (!users.has(userId)) users.set(userId, new Set())
    users.get(userId)!.add(socketId)
  }

  private removeSocket(roomId: string, userId: string, socketId: string): void {
    const users = this.roomSockets.get(roomId)
    if (!users) return
    const sockets = users.get(userId)
    if (!sockets) return
    sockets.delete(socketId)
    let wentOffline = false
    if (sockets.size === 0) {
      users.delete(userId)
      wentOffline = true
    }
    if (users.size === 0) {
      this.roomSockets.delete(roomId)
    }
    if (wentOffline) {
      // 同一用户所有窗口（主窗口+Overlay）都断开后才标记离线
      this.emitToRoom(roomId, 'member:offline', { userId })
    }
  }

  private nextSeq(roomId: string): number {
    const s = (this.seq.get(roomId) ?? 0) + 1
    this.seq.set(roomId, s)
    return s
  }

  private envelope<T>(roomId: string, data: T): SrvEnvelope<T> {
    return { seq: this.nextSeq(roomId), roomId, data }
  }

  private emitToRoom<T>(roomId: string, event: string, data: T): void {
    this.server.to(roomId).emit(event, this.envelope(roomId, data))
  }

  private emitToRoomExcept<T>(roomId: string, exceptSocketId: string, event: string, data: T): void {
    const payload = this.envelope(roomId, data)
    this.server.to(roomId).except(exceptSocketId).emit(event, payload)
  }
}
