import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateRoomDto } from './dto/create-room.dto'
import { JoinRoomDto } from './dto/join-room.dto'
import { RoomsService } from './rooms.service'
import { BoardService } from '../board/board.service'

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly boardService: BoardService
  ) {}

  @Post()
  @HttpCode(201)
  create(@Req() req: Request, @Body() dto: CreateRoomDto) {
    const userId = (req.user as { userId: string }).userId
    return this.roomsService.create(userId, dto.name)
  }

  @Post('join')
  @HttpCode(200)
  join(@Req() req: Request, @Body() dto: JoinRoomDto) {
    const userId = (req.user as { userId: string }).userId
    return this.roomsService.join(userId, dto.inviteCode)
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const room = await this.roomsService.getRoom(id)
    return {
      id: room.id,
      name: room.name,
      inviteCode: room.inviteCode,
      hostId: room.hostId,
      status: room.status,
      createdAt: room.createdAt,
      memberCount: room.members.length
    }
  }

  /** 房主手动归档 */
  @Post(':id/archive')
  @HttpCode(200)
  async archive(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as { userId: string }).userId
    const matchId = await this.boardService.archiveRoom(id, userId)
    return { matchId }
  }
}
