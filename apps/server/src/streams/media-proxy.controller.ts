import { All, Controller, Inject, Logger, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { RoomsService } from '../rooms/rooms.service';

/** 允许的文件名：<name>.flv | <name>.m3u8 | <name>-<seq>.ts */
const FILE_RE = /^([\w.-]+?)(\.flv|\.m3u8|-\d+\.ts)$/;

/**
 * 媒体代理：把 /live/** 透明转发到 SRS 的 HTTP 服务（默认 127.0.0.1:8080）。
 * 好处：页面与 SRS 同源，避免浏览器 CORS 限制，且外部只需暴露一个端口。
 *
 * 房间成员使用只读拉流令牌 /live/<playToken>.flv，
 * 这里把令牌映射回真实流名，串流密钥不会暴露给其他成员。
 */
@Controller('live')
export class MediaProxyController {
  private readonly logger = new Logger(MediaProxyController.name);
  private readonly srsHttpUrl = process.env.SRS_HTTP_URL || 'http://127.0.0.1:8080';

  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @All(':file')
  async proxy(@Param('file') file: string, @Req() req: Request, @Res() res: Response) {
    const match = FILE_RE.exec(file);
    if (!match) {
      res.status(400).end('bad media path');
      return;
    }
    const name = this.rooms.resolveStreamName(match[1]) ?? match[1];
    const target = `${this.srsHttpUrl}/live/${name}${match[2]}`;
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    try {
      const upstream = await fetch(target, {
        method: 'GET',
        headers: { 'user-agent': 'fighting-plus-proxy' },
        signal: abort.signal,
        // FLV 是长连接直播流，禁用缓存
        cache: 'no-store',
      });

      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      const cacheControl = upstream.headers.get('cache-control');
      if (cacheControl) res.setHeader('cache-control', cacheControl);
      res.setHeader('access-control-allow-origin', '*');

      if (!upstream.body) {
        res.end();
        return;
      }
      // 浏览器先发 Range 探测的情况：SRS 不支持 Range，直接 200 流式输出
      // 必须监听流的 error（客户端断开/上游中断会触发 AbortError），否则未捕获错误会击垮整个进程
      const nodeStream = Readable.fromWeb(upstream.body as never);
      nodeStream.on('error', (err) => {
        this.logger.warn(`流中断 ${target}: ${String(err)}`);
        nodeStream.destroy();
        if (!res.writableEnded) res.end();
      });
      res.on('close', () => {
        if (!nodeStream.destroyed) nodeStream.destroy();
      });
      nodeStream.pipe(res);
    } catch (err) {
      if (!res.headersSent) res.status(502);
      res.end(`proxy error: ${String(err)}`);
      this.logger.warn(`代理失败 ${target}: ${String(err)}`);
    }
  }
}
