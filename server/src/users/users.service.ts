import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateProfileDto } from './dto/update-profile.dto'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('用户不存在')
    return { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: { nickname?: string; avatar?: string } = {}
    if (dto.nickname !== undefined) data.nickname = dto.nickname
    if (dto.avatar !== undefined) data.avatar = dto.avatar
    const user = await this.prisma.user.update({ where: { id: userId }, data })
    return { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar }
  }
}
