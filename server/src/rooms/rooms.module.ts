import { Module } from '@nestjs/common'
import { RoomsController } from './rooms.controller'
import { RoomsService } from './rooms.service'
import { BoardModule } from '../board/board.module'

@Module({
  imports: [BoardModule],
  controllers: [RoomsController],
  providers: [RoomsService]
})
export class RoomsModule {}
