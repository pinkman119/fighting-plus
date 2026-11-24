import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UsersService } from './users.service'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@Req() req: Request) {
    return this.usersService.getProfile((req.user as { userId: string }).userId)
  }

  @Patch('me')
  update(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile((req.user as { userId: string }).userId, dto)
  }
}
