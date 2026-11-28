import { Controller, Get, Inject } from '@nestjs/common';
import { SrsService } from '../srs/srs.service';
import type { HealthResponse } from '../../../../packages/shared/protocol';

/** GET /api/health — 服务端存活 + SRS 可达性 */
@Controller('api/health')
export class HealthController {
  constructor(@Inject(SrsService) private readonly srs: SrsService) {}

  @Get()
  async health(): Promise<HealthResponse> {
    const snap = await this.srs.fresh(5000);
    return { ok: true, srsOnline: snap.online, time: new Date().toISOString() };
  }
}
