import { Injectable, Logger } from '@nestjs/common';

/** 预定义的三路流（同时也是 OBS 推流码） */
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

interface SrsApiStream {
  id?: number;
  name?: string;
  app?: string;
  [k: string]: unknown;
}

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);
  private readonly srsApiUrl = process.env.SRS_API_URL || 'http://127.0.0.1:1985';
  private readonly rtmpServer = process.env.RTMP_PUSH_SERVER || 'rtmp://localhost:1935/live';

  /** 实际的推流地址要带局域网 IP，由 Controller 用请求 Host 推导，这里做兜底 */
  buildRtmpServer(host?: string): string {
    if (host) return `rtmp://${host.split(':')[0]}:1935/live`;
    return this.rtmpServer;
  }

  /** 查询 SRS HTTP API，返回在线的流名字集合 */
  async getOnlineStreamNames(): Promise<{ srsOnline: boolean; names: Set<string> }> {
    try {
      const res = await fetch(`${this.srsApiUrl}/api/v1/streams`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`SRS API ${res.status}`);
      const body = (await res.json()) as {
        code?: number;
        streams?: SrsApiStream[];
      };
      const names = new Set<string>();
      for (const s of body.streams || []) {
        // 兼容 SRS 不同版本：name 可能是 "A" 或 "live/A"
        const name = String(s.name ?? '');
        const app = String(s.app ?? '');
        if (name) names.add(name.includes('/') ? name : app ? `${app}/${name}` : name);
      }
      return { srsOnline: true, names };
    } catch (err) {
      this.logger.warn(`查询 SRS 状态失败: ${String(err)}`);
      return { srsOnline: false, names: new Set<string>() };
    }
  }

  isOnline(names: Set<string>, key: string): boolean {
    return names.has(key) || names.has(`live/${key}`);
  }

  async getStatus(rtmpServer: string): Promise<StreamStatus[]> {
    const { names } = await this.getOnlineStreamNames();
    return STREAM_KEYS.map((key) => ({
      key,
      online: this.isOnline(names, key),
      flvUrl: `/live/${key}.flv`,
      hlsUrl: `/live/${key}.m3u8`,
      rtmpPush: { server: rtmpServer, key },
    }));
  }
}
