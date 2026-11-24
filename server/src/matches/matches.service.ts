import { Injectable, NotFoundException } from '@nestjs/common'
import type { Annotation, MapInfo, MatchDetail, MatchSummary } from '../../../shared/types'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 仅返回当前用户参与过的历史局，按结束时间倒序 */
  async listByUser(userId: string): Promise<MatchSummary[]> {
    const parts = await this.prisma.matchParticipant.findMany({
      where: { userId },
      include: {
        match: {
          include: {
            participants: { orderBy: { nickname: 'asc' } }
          }
        }
      },
      orderBy: { match: { endedAt: 'desc' } }
    })
    return parts.map((p) => ({
      id: p.match.id,
      name: p.match.name,
      endedAt: p.match.endedAt.toISOString(),
      participants: p.match.participants.map((x) => ({
        userId: x.userId,
        nickname: x.nickname,
        color: x.color
      }))
    }))
  }

  async getDetail(userId: string, matchId: string): Promise<MatchDetail> {
    const participation = await this.prisma.matchParticipant.findUnique({
      where: { matchId_userId: { matchId, userId } }
    })
    if (!participation) throw new NotFoundException('对局不存在')

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { participants: true }
    })
    if (!match) throw new NotFoundException('对局不存在')

    const map: MapInfo | null =
      match.mapUrl && match.mapWidth && match.mapHeight
        ? { url: match.mapUrl, width: match.mapWidth, height: match.mapHeight }
        : null

    const snapshot = (match.snapshot ?? { annotations: [] }) as { annotations: Annotation[] }

    return {
      id: match.id,
      name: match.name,
      endedAt: match.endedAt.toISOString(),
      startedAt: match.startedAt.toISOString(),
      map,
      annotations: snapshot.annotations ?? [],
      participants: match.participants.map((x) => ({
        userId: x.userId,
        nickname: x.nickname,
        color: x.color
      }))
    }
  }
}
