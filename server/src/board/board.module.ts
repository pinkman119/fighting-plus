import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { BoardGateway } from './board.gateway'
import { BoardService } from './board.service'

@Module({
  imports: [AuthModule],
  providers: [BoardGateway, BoardService],
  exports: [BoardService]
})
export class BoardModule {}
