import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import type {
  CreateRoomBody,
  JoinRoomBody,
  RoomDto,
  RoomJoinResponse,
} from '../../../../packages/shared/protocol';
import { RoomsService, normalizeRoomCode } from './rooms.service';

export interface LeaveBody {
  memberId?: string;
}

/** 从请求 Host 推导 OBS 推流地址，例如 rtmp://192.168.1.10:1935/live */
export function rtmpServerFromRequest(req: Request): string {
  if (process.env.RTMP_PUSH_SERVER) return process.env.RTMP_PUSH_SERVER;
  const host = (req.headers['host'] as string) || 'localhost';
  return `rtmp://${host.split(':')[0]}:1935/live`;
}

@Controller('api/rooms')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  /** POST /api/rooms — 创建房间并返回创建者的串流密钥 */
  @Post()
  create(@Body() body: CreateRoomBody, @Req() req: Request): RoomJoinResponse {
    return this.rooms.create({
      memberId: body?.memberId,
      nickname: body?.nickname,
      rtmpServer: rtmpServerFromRequest(req),
    });
  }

  /** GET /api/rooms/:code — 加入前查看房间（不含密钥） */
  @Get(':code')
  inspect(@Param('code') code: string, @Req() req: Request): RoomDto {
    try {
      return this.rooms.inspect(code, rtmpServerFromRequest(req));
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException('房间不存在或已关闭', HttpStatus.NOT_FOUND);
    }
  }

  /** POST /api/rooms/:code/join — 加入房间，分配席位与串流密钥 */
  @Post(':code/join')
  join(@Param('code') code: string, @Body() body: JoinRoomBody, @Req() req: Request): RoomJoinResponse {
    return this.rooms.join(code, {
      memberId: body?.memberId,
      nickname: body?.nickname,
      token: body?.token,
      rtmpServer: rtmpServerFromRequest(req),
    });
  }

  /** POST /api/rooms/:code/leave — 离开房间 */
  @Post(':code/leave')
  leave(@Param('code') code: string, @Body() body: LeaveBody): { ok: true } {
    const normalized = normalizeRoomCode(code);
    const found = normalized ? this.rooms.findByMember(String(body?.memberId ?? '')) : undefined;
    if (found && found.room.code === normalized) this.rooms.leave(found.member.id);
    return { ok: true };
  }
}
