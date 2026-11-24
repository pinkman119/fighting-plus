import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { MatchesService } from './matches.service'

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  list(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId
    return this.matchesService.listByUser(userId)
  }

  @Get(':id')
  detail(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as { userId: string }).userId
    return this.matchesService.getDetail(userId, id)
  }
}
