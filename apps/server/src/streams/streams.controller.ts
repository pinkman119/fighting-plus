import { Controller, Get, Inject, Req } from '@nestjs/common';
import { Request } from 'express';
import { StreamsService } from './streams.service';

@Controller('api/streams')
export class StreamsController {
  constructor(@Inject(StreamsService) private readonly streams: StreamsService) {}

  /** GET /api/streams — 三路流的在线状态 + 推流/拉流地址 */
  @Get()
  async list(@Req() req: Request) {
    const host = (req.headers['host'] as string) || 'localhost:3118';
    const rtmpServer = this.streams.buildRtmpServer(host);
    const list = await this.streams.getStatus(rtmpServer);
    return {
      rtmpServer,
      streams: list,
      time: new Date().toISOString(),
    };
  }
}
