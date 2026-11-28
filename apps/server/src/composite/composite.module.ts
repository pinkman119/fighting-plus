import { Controller, Get, Module, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { join } from 'node:path';
import { webDistDir, webIndexFile } from '../web-dist';

@Controller()
export class CompositeController {
  /**
   * 根路径：存在 Web 构建产物时进入 fighting-plus 应用，否则跳到合流页
   */
  @Get()
  root(@Res() res: Response) {
    if (webIndexFile()) {
      res.sendFile(webIndexFile()!);
      return;
    }
    res.redirect('/composite');
  }

  /** GET /composite — 合流展示页（作为 OBS 浏览器源使用） */
  @Get('composite')
  composite(@Req() req: Request, @Res() res: Response) {
    res.type('html').sendFile(join(__dirname, '..', '..', 'public', 'composite.html'));
  }
}

@Module({
  controllers: [CompositeController],
})
export class CompositeModule {}
