import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { createServer } from 'node:net';
import { SrsService, type SrsStreamInfo } from '../srs/srs.service';

/**
 * node-media-server 没有类型声明，这里只描述本模块用到的最小接口。
 */
interface NmsSession {
  id: string;
  streamPath: string;
  inBytes: number;
  videoCodec?: string | number;
  audioCodec?: string | number;
  close?: () => void;
}
interface NmsInstance {
  on(event: string, listener: (session: NmsSession) => void): void;
  run(): void;
  stop(): Promise<void>;
}
type NmsConstructor = new (config: Record<string, unknown>) => NmsInstance;

/** 内置 RTMP 服务（无需 Docker）：
 *  1935 接收 OBS 推流，8080 输出 HTTP-FLV，由 /live/* 代理给页面。 */
@Injectable()
export class LocalRtmpService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(LocalRtmpService.name);
  private readonly rtmpPort = Number(process.env.RTMP_PORT || 1935);
  private readonly httpPort = Number(process.env.MEDIA_HTTP_PORT || 8080);
  private readonly engine = process.env.MEDIA_ENGINE || 'builtin';

  private nms?: NmsInstance;
  private publisher = new Map<string, NmsSession>();
  private clientIds = new Map<string, number>();
  private nextClientId = 1;
  private samples = new Map<string, { bytes: number; at: number }>();

  constructor(@Inject(SrsService) private readonly srs: SrsService) {}

  onModuleInit(): void {
    void this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.nms) await this.nms.stop().catch(() => undefined);
  }

  /** 端口空闲才启动内置服务；端口被占用时回退到外部 SRS */
  async start(): Promise<void> {
    if (this.engine === 'srs') {
      this.logger.log('MEDIA_ENGINE=srs：使用外部 SRS，跳过内置 RTMP 服务');
      return;
    }
    if (!(await this.portFree(this.rtmpPort))) {
      this.logger.warn(`端口 ${this.rtmpPort} 已被占用，跳过内置 RTMP 服务（若已运行 SRS 则无需处理）`);
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NodeMediaServer = require('node-media-server') as NmsConstructor;
      const nms = new NodeMediaServer({
        rtmp: {
          port: this.rtmpPort,
          chunk_size: 60000,
          gop_cache: true,
          ping: 30,
          ping_timeout: 60,
        },
        http: {
          port: this.httpPort,
          allow_origin: '*',
        },
      });

      nms.on('postPublish', (session) => {
        const path = normalizedPath(session.streamPath);
        if (!path) return;
        this.publisher.set(path, session);
        if (!this.clientIds.has(path)) this.clientIds.set(path, this.nextClientId++);
        this.samples.set(path, { bytes: Number(session.inBytes) || 0, at: Date.now() });
        this.logger.log(`OBS 推流上线: rtmp://localhost:${this.rtmpPort}${path}`);
        void this.srs.poll();
      });

      nms.on('donePublish', (session) => {
        const path = normalizedPath(session.streamPath);
        if (!path) return;
        this.publisher.delete(path);
        this.samples.delete(path);
        this.logger.log(`OBS 推流下线: ${path}`);
        void this.srs.poll();
      });

      nms.run();
      this.nms = nms;
      // 把快照来源切换到内置服务（SrsService 不再查询 SRS HTTP API）
      this.srs.setLocalProvider({
        snapshot: () => this.snapshot(),
        kick: (id) => this.kick(id),
      });
      this.logger.log(`内置 RTMP 服务已启动: rtmp://0.0.0.0:${this.rtmpPort}/live`);
      this.logger.log(`HTTP-FLV 播放地址: http://<host>:${this.httpPort}/live/<streamKey>.flv`);
    } catch (err) {
      this.logger.error(`内置 RTMP 服务启动失败: ${String(err)}`);
    }
  }

  /** 当前在线流快照（SrsService 轮询时调用） */
  private snapshot(): Map<string, SrsStreamInfo> {
    const result = new Map<string, SrsStreamInfo>();
    const now = Date.now();
    for (const [path, session] of this.publisher) {
      let bitrateKbps: number | null = null;
      const previous = this.samples.get(path);
      const bytes = Number(session.inBytes) || 0;
      if (previous && now > previous.at) {
        const delta = Math.max(0, bytes - previous.bytes);
        bitrateKbps = Math.round((delta * 8) / ((now - previous.at) / 1000) / 1000);
      }
      this.samples.set(path, { bytes, at: now });
      result.set(path, {
        name: path,
        app: path.split('/')[1] ?? 'live',
        clientId: this.clientIds.get(path) ?? null,
        publishing: true,
        videoCodec: normalizeCodec(session.videoCodec, 'video'),
        audioCodec: normalizeCodec(session.audioCodec, 'audio'),
        bitrateKbps,
      });
    }
    return result;
  }

  /** 断开推流客户端（RPC：停止战术直播） */
  private async kick(clientId: number): Promise<void> {
    for (const [path, id] of this.clientIds) {
      if (id !== clientId) continue;
      const session = this.publisher.get(path);
      session?.close?.();
      this.logger.log(`已断开 OBS 推流: ${path}`);
      await this.srs.poll();
      return;
    }
    throw new Error(`未找到推流会话 (${clientId})`);
  }

  private portFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '0.0.0.0', () => {
        probe.close(() => resolve(true));
      });
    });
  }
}

/** `/live/<key>` → `live/<key>`；其它流路径忽略 */
function normalizedPath(streamPath: string): string {
  const path = String(streamPath || '').replace(/^\/+/, '');
  if (!path.startsWith('live/') || path.length <= 5) return '';
  return path;
}

/** node-media-server 的 codec 是 RTMP 数值 ID，统一转成共享协议里的编码名 */
function normalizeCodec(value: string | number | null | undefined, kind: 'video' | 'audio'): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const names = kind === 'video' ? VIDEO_CODEC_IDS : AUDIO_CODEC_IDS;
    return names[value] ?? String(value);
  }
  const text = String(value).toLowerCase().trim();
  const aliases: Record<string, string> = {
    avc: 'h264',
    avc1: 'h264',
    h264: 'h264',
    hevc: 'h265',
    hvc1: 'h265',
    h265: 'h265',
    aac: 'aac',
    mp3: 'mp3',
  };
  return aliases[text] ?? (text || null);
}

const VIDEO_CODEC_IDS: Record<number, string> = {
  7: 'h264',
  12: 'h265',
  13: 'av1',
};

const AUDIO_CODEC_IDS: Record<number, string> = {
  2: 'mp3',
  10: 'aac',
};
