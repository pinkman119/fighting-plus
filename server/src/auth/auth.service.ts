import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { createHash } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'

export interface JwtPayload {
  sub: string
  email: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private async issueTokens(userId: string, email: string) {
    const accessToken = this.jwt.sign({ sub: userId, email } satisfies JwtPayload)

    const refreshToken = this.jwt.sign(
      { sub: userId, kind: 'refresh' },
      { expiresIn: `${this.config.get<number>('REFRESH_EXPIRES_DAYS', 7)}d` }
    )

    const expiresAt = new Date(
      Date.now() + (this.config.get<number>('REFRESH_EXPIRES_DAYS', 7) ?? 7) * 24 * 3600 * 1000
    )
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(refreshToken), expiresAt }
    })

    return { accessToken, refreshToken }
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) {
      throw new ConflictException('该邮箱已被注册')
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        nickname: dto.nickname
      }
    })
    const tokens = await this.issueTokens(user.id, user.email)
    return {
      ...tokens,
      user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar }
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new UnauthorizedException('邮箱或密码错误')
    const ok = await bcrypt.compare(dto.password, user.passwordHash)
    if (!ok) throw new UnauthorizedException('邮箱或密码错误')

    const tokens = await this.issueTokens(user.id, user.email)
    return {
      ...tokens,
      user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar }
    }
  }

  async refresh(refreshToken: string) {
    let payload: { sub?: string; kind?: string }
    try {
      payload = await this.jwt.verifyAsync(refreshToken)
    } catch {
      throw new UnauthorizedException('refresh token 无效')
    }
    if (!payload.sub || payload.kind !== 'refresh') {
      throw new UnauthorizedException('refresh token 无效')
    }

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) }
    })
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('refresh token 已失效')
    }

    // 轮换：吊销旧的，签发新的
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() }
    })
    const user = await this.prisma.user.findUnique({ where: { id: record.userId } })
    if (!user) throw new UnauthorizedException('用户不存在')

    const tokens = await this.issueTokens(user.id, user.email)
    return {
      ...tokens,
      user: { id: user.id, email: user.email, nickname: user.nickname, avatar: user.avatar }
    }
  }

  async logout(refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) }
    })
    if (record && !record.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() }
      })
    }
    return { success: true }
  }

  /** Socket 握手 / Guard 共用的 JWT 校验 */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token)
      if (!payload.sub) throw new Error('no sub')
      return payload
    } catch {
      throw new UnauthorizedException('access token 无效')
    }
  }
}
