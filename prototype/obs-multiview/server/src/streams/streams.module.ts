import { Module } from '@nestjs/common';
import { StreamsController } from './streams.controller';
import { StreamsService } from './streams.service';
import { MediaProxyController } from './media-proxy.controller';

@Module({
  controllers: [StreamsController, MediaProxyController],
  providers: [StreamsService],
})
export class StreamsModule {}
