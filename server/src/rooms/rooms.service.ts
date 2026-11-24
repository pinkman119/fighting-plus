import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { randomInt } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const MAX_ROOM_MEMBERS = 6

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  private genInviteCode(): string {
    let code = ''
    for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
    return code
  }

  async create(userId: string, name?: string) {
    // 邀请码碰撞重试
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = this.genInviteCode()
      const existing = await this.prisma.room.findUnique({ where: { inviteCode } })
      if (existing) continue
      const room = await this.prisma.room.create({
        data: { inviteCode, hostId: userId, name: name?.trim() || '未命名对局' }
      })
      return room
    }
    throw new ConflictException('邀请码生成失败，请重试')
  }

  async join(userId: string, inviteCode: string) {
    const room = await this.prisma.room.findUnique({ where: { inviteCode: inviteCode.toUpperCase() } })
    if (!room || room.status !== 'active') {
      throw new NotFoundException('房间不存在或已结束')
    }
    const existing = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } }
    })
    if (existing) return room

    const count = await this.prisma.roomMember.count({ where: { roomId: room.id } })
    if (count >= MAX_ROOM_MEMBERS) {
      throw new ConflictException('房间已满（上限 6 人）')
    }
    await this.prisma.roomMember.create({ data: { roomId: room.id, userId, color: '' } })
    return room
  }

  async getRoom(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { members: { include: { user: true } } }
    })
    if (!room) throw new NotFoundException('房间不存在')
    return room
  }
}
