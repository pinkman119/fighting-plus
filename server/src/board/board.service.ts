import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import type {
  Annotation,
  AnnotationPayload,
  AnnotationType,
  BoardSnapshot,
  MapInfo
} from '../../../shared/types'
import { PrismaService } from '../prisma/prisma.service'
import { MEMBER_COLORS } from './colors'

type AnnotationRow = {
  id: string
  roomId: string
  type: string
  payload: unknown
  note: string | null
  authorId: string
  createdAt: Date
  updatedAt: Date
  user: { nickname: string }
}

function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    type: row.type as AnnotationType,
    payload: row.payload as AnnotationPayload,
    note: row.note,
    authorId: row.authorId,
    authorNickname: row.user.nickname,
    color: '',
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  }
}

@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 快照 ----------

  async getSnapshot(roomId: string): Promise<Omit<BoardSnapshot, 'members'>> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { annotations: { where: { removedAt: null }, include: { user: true } } }
    })
    if (!room) throw new NotFoundException('房间不存在')
    if (room.status !== 'active') throw new NotFoundException('房间已结束')

    const map: MapInfo | null =
      room.mapUrl && room.mapWidth && room.mapHeight
        ? { url: room.mapUrl, width: room.mapWidth, height: room.mapHeight }
        : null

    return {
      roomId: room.id,
      name: room.name,
      inviteCode: room.inviteCode,
      hostId: room.hostId,
      map,
      annotations: room.annotations.map(toAnnotation),
      lastSeq: 0
    }
  }

  async getMembers(roomId: string) {
    const members = await this.prisma.roomMember.findMany({
      where: { roomId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' }
    })
    return members.map((m) => ({
      userId: m.userId,
      nickname: m.user.nickname,
      avatar: m.user.avatar,
      color: m.color,
      isHost: false,
      online: false
    }))
  }

  /** 入房时为无颜色成员分配调色板颜色（去重） */
  async ensureColors(roomId: string): Promise<void> {
    const members = await this.prisma.roomMember.findMany({ where: { roomId } })
    const used = new Set(members.filter((m) => m.color).map((m) => m.color))
    for (const m of members) {
      if (m.color) continue
      const available = MEMBER_COLORS.find((c) => !used.has(c)) ?? MEMBER_COLORS[0]
      await this.prisma.roomMember.update({ where: { id: m.id }, data: { color: available } })
      used.add(available)
    }
  }

  async getMemberColor(roomId: string, userId: string): Promise<string> {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } }
    })
    return member?.color ?? MEMBER_COLORS[0]
  }

  // ---------- 标注 ----------

  async createAnnotation(
    roomId: string,
    userId: string,
    type: AnnotationType,
    payload: AnnotationPayload,
    note: string | null
  ): Promise<Annotation> {
    const row = await this.prisma.annotation.create({
      data: { roomId, type, payload: payload as object, note, authorId: userId },
      include: { user: true }
    })
    return { ...toAnnotation(row), color: await this.getMemberColor(roomId, userId) }
  }

  /** 仅创建者可编辑 */
  async updateAnnotation(
    roomId: string,
    userId: string,
    annotationId: string,
    note: string | null
  ): Promise<Annotation> {
    const row = await this.prisma.annotation.findFirst({
      where: { id: annotationId, roomId, removedAt: null },
      include: { user: true }
    })
    if (!row) throw new NotFoundException('标注不存在')
    if (row.authorId !== userId) throw new ForbiddenException('只有创建者可以编辑该标注')
    const updated = await this.prisma.annotation.update({
      where: { id: annotationId },
      data: { note },
      include: { user: true }
    })
    return { ...toAnnotation(updated), color: await this.getMemberColor(roomId, userId) }
  }

  /** 任何成员可删除（软删除） */
  async removeAnnotation(roomId: string, annotationId: string): Promise<void> {
    await this.prisma.annotation.updateMany({
      where: { id: annotationId, roomId, removedAt: null },
      data: { removedAt: new Date() }
    })
  }

  /** 恢复（撤销删除/清空用）：清空 removedAt */
  async restoreAnnotations(roomId: string, ids: string[]): Promise<Annotation[]> {
    if (ids.length === 0) return []
    await this.prisma.annotation.updateMany({
      where: { id: { in: ids }, roomId, removedAt: { not: null } },
      data: { removedAt: null }
    })
    const rows = await this.prisma.annotation.findMany({
      where: { id: { in: ids }, roomId },
      include: { user: true }
    })
    // 恢复后按创建顺序排序
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    return Promise.all(
      rows.map(async (r) => ({
        ...toAnnotation(r),
        color: await this.getMemberColor(roomId, r.authorId)
      }))
    )
  }

  async clearBoard(roomId: string): Promise<string[]> {
    const live = await this.prisma.annotation.findMany({
      where: { roomId, removedAt: null },
      select: { id: true }
    })
    if (live.length === 0) return []
    await this.prisma.annotation.updateMany({
      where: { id: { in: live.map((a) => a.id) } },
      data: { removedAt: new Date() }
    })
    return live.map((a) => a.id)
  }

  // ---------- 地图 ----------

  async setMap(roomId: string, map: MapInfo): Promise<void> {
    await this.prisma.room.update({
      where: { id: roomId },
      data: { mapUrl: map.url, mapWidth: map.width, mapHeight: map.height }
    })
  }

  // ---------- 房主与归档 ----------

  async transferHost(roomId: string, currentUserId: string, targetUserId: string): Promise<string> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } })
    if (!room || room.status !== 'active') throw new NotFoundException('房间不存在或已结束')
    if (room.hostId !== currentUserId) throw new ForbiddenException('只有房主可以移交')
    if (targetUserId === currentUserId) throw new ForbiddenException('不能移交给自己')
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } }
    })
    if (!member) throw new NotFoundException('目标成员不在房间内')
    await this.prisma.room.update({ where: { id: roomId }, data: { hostId: targetUserId } })
    return targetUserId
  }

  /** 归档：手动（房主校验）或自动（byUserId 为空跳过校验） */
  async archiveRoom(roomId: string, byUserId?: string): Promise<string> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: { include: { user: true } },
        annotations: { where: { removedAt: null }, include: { user: true } }
      }
    })
    if (!room || room.status !== 'active') throw new NotFoundException('房间不存在或已结束')
    if (byUserId && room.hostId !== byUserId) throw new ForbiddenException('只有房主可以结束对局')

    const now = new Date()
    const annotations = await Promise.all(
      room.annotations.map(async (r) => ({
        ...toAnnotation(r),
        color: await this.getMemberColor(roomId, r.authorId)
      }))
    )

    const match = await this.prisma.match.create({
      data: {
        roomId: room.id,
        name: room.name,
        mapUrl: room.mapUrl,
        mapWidth: room.mapWidth,
        mapHeight: room.mapHeight,
        startedAt: room.createdAt,
        endedAt: now,
        snapshot: { annotations },
        participants: {
          create: room.members.map((m) => ({
            userId: m.userId,
            nickname: m.user.nickname,
            color: m.color
          }))
        }
      }
    })
    await this.prisma.room.update({ where: { id: roomId }, data: { status: 'archived', archivedAt: now } })
    return match.id
  }

  /** 房间活跃心跳：任何事件后刷新，供自动归档判定 */
  async touchActivity(roomId: string): Promise<void> {
    await this.prisma.room.update({
      where: { id: roomId },
      data: { lastActivityAt: new Date() }
    })
  }

  /** 供定时任务查询：超过阈值无任何活动的活跃房间 */
  async findIdleActiveRooms(idleThresholdMs: number): Promise<string[]> {
    const rooms = await this.prisma.room.findMany({
      where: { status: 'active', lastActivityAt: { lt: new Date(Date.now() - idleThresholdMs) } },
      select: { id: true }
    })
    return rooms.map((r) => r.id)
  }
}
