import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';

/** 单路流在 SRS 上的实时信息 */
export interface SrsStreamInfo {
  /** 归一化后的流名，固定为 `live/<stream>` */
  name: string;
  app: string;
  /** 推流客户端 id，用于踢断推流 */
  clientId: number | null;
  /** 是否正在推流 */
  publishing: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  /** 推流码率（kbps） */
  bitrateKbps: number | null;
}

/** 一次 SRS 状态快照 */
export interface SrsSnapshot {
  /** SRS HTTP API 是否可达 */
  online: boolean;
  /** 快照时间 */
  at: number;
  /** key 为 `live/<stream>` */
  streams: Map<string, SrsStreamInfo>;
}

interface SrsApiStream {
  id?: number;
  name?: string;
  app?: string;
  publish?: { active?: boolean; cid?: number };
  video?: { codec?: string };
  audio?: { codec?: string };
  kbps?: { recv30s?: number; send30s?: number };
}

/** SRS 在线流发生变化（有流上线 / 下线 / 服务可达性变化 / 码率变化） */
export interface SrsChange {
  previous: SrsSnapshot;
  current: SrsSnapshot;
}

const EMPTY: SrsSnapshot = { online: false, at: 0, streams: new Map() };

/** 内置 RTMP 服务提供的在线流来源 */
export interface LocalMediaProvider {
  snapshot(): Map<string, SrsStreamInfo>;
  kick(clientId: number): Promise<void>;
}

/**
 * 轮询 SRS HTTP API，维护在线流快照。
 * 快照被所有模块共享，避免每个请求都去查询 SRS。
 */
@Injectable()
export class SrsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SrsService.name);
  private readonly srsApiUrl = process.env.SRS_API_URL || 'http://127.0.0.1:1985';
  private readonly pollIntervalMs = Number(process.env.SRS_POLL_INTERVAL_MS || 2000);

  private snapshot: SrsSnapshot = EMPTY;
  private inflight: Promise<SrsSnapshot> | null = null;
  private timer?: NodeJS.Timeout;
  private localProvider?: LocalMediaProvider;

  /** 在线流变化通知 */
  readonly changes = new Subject<SrsChange>();

  /** 切换到内置 RTMP 服务（无需 Docker/SRS） */
  setLocalProvider(provider: LocalMediaProvider): void {
    this.localProvider = provider;
    this.logger.log('在线流来源已切换为内置 RTMP 服务');
    void this.poll();
  }

  onModuleInit() {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.changes.complete();
  }

  /** 最近一次快照（可能已过期） */
  current(): SrsSnapshot {
    return this.snapshot;
  }

  /** 在线流名集合（`live/<stream>`），兼容旧接口 */
  getOnlineStreamNames(): { srsOnline: boolean; names: Set<string> } {
    return { srsOnline: this.snapshot.online, names: new Set(this.snapshot.streams.keys()) };
  }

  isOnline(names: Set<string>, key: string): boolean {
    return names.has(key) || names.has(`live/${key}`);
  }

  /** 按串流密钥查找流 */
  find(streamKey: string): SrsStreamInfo | undefined {
    const snap = this.snapshot;
    return snap.streams.get(`live/${streamKey}`) ?? snap.streams.get(streamKey);
  }

  /** 立即刷新（SRS 回调、踢流后调用） */
  async poll(): Promise<SrsSnapshot> {
    if (this.inflight) return this.inflight;
    this.inflight = this.fetch()
      .then((snap) => {
        this.apply(snap);
        return snap;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** 快照足够新鲜时直接返回，否则刷新 */
  async fresh(maxAgeMs = 1500): Promise<SrsSnapshot> {
    if (this.snapshot.at && Date.now() - this.snapshot.at < maxAgeMs) return this.snapshot;
    return this.poll();
  }

  /** 断开某个推流客户端（用于停止某位成员的推流） */
  async kickClient(clientId: number): Promise<void> {
    if (this.localProvider) {
      await this.localProvider.kick(clientId);
      return;
    }
    const res = await fetch(`${this.srsApiUrl}/api/v1/clients/${clientId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`SRS 踢流失败 (${res.status})`);
    await this.poll();
  }

  private apply(next: SrsSnapshot) {
    const previous = this.snapshot;
    this.snapshot = next;

    if (previous !== EMPTY && previous.online !== next.online) {
      this.logger.log(next.online ? '流媒体服务已连接' : '流媒体服务不可达，等待服务启动');
    }
    if (previous === EMPTY) return;

    // 码率每次都会变化，因此只要快照有更新且在线流非空就通知
    const membershipChanged =
      previous.online !== next.online ||
      previous.streams.size !== next.streams.size ||
      [...next.streams.keys()].some((k) => !previous.streams.has(k)) ||
      [...previous.streams.keys()].some((k) => !next.streams.has(k));
    if (membershipChanged || (next.online && next.streams.size > 0)) {
      this.changes.next({ previous, current: next });
    }
  }

  private async fetch(): Promise<SrsSnapshot> {
    if (this.localProvider) {
      return { online: true, at: Date.now(), streams: this.localProvider.snapshot() };
    }
    try {
      const res = await fetch(`${this.srsApiUrl}/api/v1/streams`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`SRS API ${res.status}`);
      const body = (await res.json()) as { code?: number; streams?: SrsApiStream[] };
      const streams = new Map<string, SrsStreamInfo>();
      for (const s of body.streams || []) {
        const rawName = String(s.name ?? '');
        if (!rawName) continue;
        const app = String(s.app ?? '');
        const name = rawName.includes('/') ? rawName : app ? `${app}/${rawName}` : rawName;
        streams.set(name, {
          name,
          app,
          clientId: typeof s.id === 'number' ? s.id : null,
          publishing: Boolean(s.publish?.active),
          videoCodec: s.video?.codec || null,
          audioCodec: s.audio?.codec || null,
          bitrateKbps: Number(s.kbps?.recv30s) || null,
        });
      }
      return { online: true, at: Date.now(), streams };
    } catch {
      return { online: false, at: Date.now(), streams: new Map() };
    }
  }
}
