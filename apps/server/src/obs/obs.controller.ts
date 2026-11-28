import { Body, Controller, Get, HttpException, HttpStatus, Inject, Logger, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ObsWebsocketService } from './obs-websocket.service';

export interface MultiviewBody {
  /** 合流页面地址，默认用请求 Host 推导 */
  url?: string;
  /** 目标场景名，默认取当前节目场景 */
  sceneName?: string;
  /** 浏览器源尺寸 */
  width?: number;
  height?: number;
  /** 源已存在时是否先删除再创建 */
  recreate?: boolean;
}

@Controller('api/obs')
export class ObsController {
  private readonly logger = new Logger(ObsController.name);
  private readonly wsUrl = process.env.OBS_WS_URL || 'ws://127.0.0.1:4455';
  private readonly password = process.env.OBS_WS_PASSWORD || '';

  constructor(@Inject(ObsWebsocketService) private readonly obs: ObsWebsocketService) {}

  /** GET /api/obs/status — 检测导播 OBS 的 WebSocket 是否可连 */
  @Get('status')
  async status() {
    try {
      await this.obs.connect(this.wsUrl, this.password, 2000);
      const scenes = await this.obs.request<{ scenes?: { sceneName: string }[] }>('GetSceneList');
      this.obs.close();
      return {
        connected: true,
        wsUrl: this.wsUrl,
        scenes: (scenes.scenes || []).map((s) => s.sceneName),
      };
    } catch (err) {
      this.obs.close();
      return { connected: false, wsUrl: this.wsUrl, error: String((err as Error).message || err) };
    }
  }

  /**
   * POST /api/obs/multiview — 通过 obs-websocket 在导播 OBS 的当前场景中
   * 自动创建名为「多人合流」的浏览器源，内容即本服务的 /composite 合流页面。
   */
  @Post('multiview')
  async addMultiview(@Body() body: MultiviewBody, @Req() req: Request) {
    const host = (req.headers['host'] as string) || 'localhost:3118';
    const url = body.url || `http://${host}/composite`;
    const width = Number(body.width) || 1920;
    const height = Number(body.height) || 1080;
    const inputName = '多人合流-MultiView';

    try {
      await this.obs.connect(this.wsUrl, this.password);
    } catch (err) {
      throw new HttpException(
        String((err as Error).message || err),
        HttpStatus.BAD_GATEWAY,
      );
    }

    try {
      const sceneList = await this.obs.request<{
        currentProgramSceneName?: string;
        scenes?: { sceneName: string }[];
      }>('GetSceneList');
      const sceneName =
        body.sceneName ||
        sceneList.currentProgramSceneName ||
        sceneList.scenes?.[0]?.sceneName;
      if (!sceneName) throw new Error('OBS 中没有任何场景');

      if (body.recreate) {
        try {
          await this.obs.request('RemoveInput', { inputName });
          this.logger.log(`已删除旧的浏览器源: ${inputName}`);
        } catch {
          /* 不存在则忽略 */
        }
      }

      const created = await this.obs.request('CreateInput', {
        sceneName,
        inputName,
        inputKind: 'browser_source',
        inputSettings: {
          url,
          width,
          height,
          reroute_audio: true,
          css: 'body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }',
        },
      });

      return {
        success: true,
        message: `已在 OBS 场景「${sceneName}」创建浏览器源「${inputName}」`,
        scene: sceneName,
        inputName,
        browserSourceUrl: url,
        size: { width, height },
        inputUuid: created.inputUuid,
        sceneItemId: created.sceneItemId,
        tip: '切换到 OBS 即可看到三路合流画面，可直接继续推流到最终平台',
      };
    } catch (err) {
      throw new HttpException(
        String((err as Error).message || err),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      this.obs.close();
    }
  }
}
