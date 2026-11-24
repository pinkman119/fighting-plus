import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { RefreshDto } from './dto/refresh.dto'
import { LogoutDto } from './dto/logout.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(201)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken)
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken)
  }
}
