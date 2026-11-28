import { Module } from '@nestjs/common';
import { RoomsModule } from '../rooms/rooms.module';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { MediaProxyController } from './media-proxy.controller';

@Module({
  imports: [RoomsModule],
  controllers: [StreamsController, MediaProxyController],
  providers: [StreamsService],
})
export class StreamsModule {}
