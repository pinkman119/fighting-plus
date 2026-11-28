import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RealtimeService } from './realtime.service';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService, RealtimeService],
  exports: [RoomsService, RealtimeService],
})
export class RoomsModule {}
