import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { RoomsModule } from './rooms/rooms.module'
import { MapsModule } from './maps/maps.module'
import { MatchesModule } from './matches/matches.module'
import { BoardModule } from './board/board.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 全局限流：每分钟 120 次；认证接口另有更严限制
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'auth', ttl: 60_000, limit: 10 }
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    MapsModule,
    MatchesModule,
    BoardModule
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
})
export class AppModule {}
