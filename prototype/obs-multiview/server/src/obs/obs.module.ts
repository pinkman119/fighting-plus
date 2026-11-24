import { Module } from '@nestjs/common';
import { ObsController } from './obs.controller';
import { ObsWebsocketService } from './obs-websocket.service';

@Module({
  controllers: [ObsController],
  providers: [ObsWebsocketService],
})
export class ObsModule {}
