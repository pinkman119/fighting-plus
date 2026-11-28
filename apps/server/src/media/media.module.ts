import { Module } from '@nestjs/common';
import { LocalRtmpService } from './local-rtmp.service';

/** 内置流媒体服务（RTMP 推流 + HTTP-FLV 播放），不依赖 Docker */
@Module({
  providers: [LocalRtmpService],
})
export class MediaModule {}
