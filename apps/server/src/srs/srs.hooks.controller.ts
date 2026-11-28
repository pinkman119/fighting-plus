import { Body, Controller, Inject, Logger, Post } from '@nestjs/common';
import { SrsService } from './srs.service';

/**
 * SRS HTTP 回调（http_hooks：on_publish / on_unpublish）。
 * 收到回调后立即刷新快照，成员的推流状态无需等待轮询即可同步到房间。
 * 无论处理结果如何都返回 code 0，避免影响 SRS 推流。
 */
@Controller('api/srs/hooks')
export class SrsHooksController {
  private readonly logger = new Logger(SrsHooksController.name);

  constructor(@Inject(SrsService) private readonly srs: SrsService) {}

  private async handle(body: unknown) {
    const b = (body || {}) as { action?: string; stream?: string; app?: string };
    this.logger.log(`SRS 回调 ${b.action || 'unknown'}: ${b.app || ''}/${b.stream || ''}`);
    try {
      await this.srs.poll();
    } catch (err) {
      this.logger.warn(`处理 SRS 回调失败: ${String(err)}`);
    }
    return { code: 0 };
  }

  @Post('publish')
  publish(@Body() body: unknown) {
    return this.handle(body);
  }

  @Post('unpublish')
  unpublish(@Body() body: unknown) {
    return this.handle(body);
  }
}
