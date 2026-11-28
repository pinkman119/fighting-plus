import { Inject, Injectable } from '@nestjs/common';
import { SrsService } from '../srs/srs.service';

/** 预定义的三路流（同时也是 OBS 推流码），供合流页 /composite 使用 */
export const STREAM_KEYS = ['A', 'B', 'C'] as const;

export interface StreamStatus {
  key: string;
  online: boolean;
  /** 拉流地址（同源代理到 SRS） */
  flvUrl: string;
  hlsUrl: string;
  /** OBS 端使用的推流地址与推流码 */
  rtmpPush: { server: string; key: string };
}

/**
 * 合流用的固定三路流状态。在线流快照统一由 SrsService 维护。
 */
@Injectable()
export class StreamsService {
  private readonly rtmpServer = process.env.RTMP_PUSH_SERVER || 'rtmp://localhost:1935/live';

  constructor(@Inject(SrsService) private readonly srs: SrsService) {}

  /** 实际的推流地址要带局域网 IP，由 Controller 用请求 Host 推导，这里做兜底 */
  buildRtmpServer(host?: string): string {
    if (host) return `rtmp://${host.split(':')[0]}:1935/live`;
    return this.rtmpServer;
  }

  /** 返回当前的在线流名集合（`live/<key>` 形式） */
  getOnlineStreamNames(): { srsOnline: boolean; names: Set<string> } {
    return this.srs.getOnlineStreamNames();
  }

  isOnline(names: Set<string>, key: string): boolean {
    return this.srs.isOnline(names, key);
  }

  async getStatus(rtmpServer: string): Promise<StreamStatus[]> {
    const snap = await this.srs.fresh();
    return STREAM_KEYS.map((key) => ({
      key,
      online: this.srs.isOnline(new Set(snap.streams.keys()), key),
      flvUrl: `/live/${key}.flv`,
      hlsUrl: `/live/${key}.m3u8`,
      rtmpPush: { server: rtmpServer, key },
    }));
  }
}
