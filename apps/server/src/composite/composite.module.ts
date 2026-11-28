import { Controller, Get, Module, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { join } from 'node:path';

@Controller()
export class CompositeController {
  /** 根路径直接跳到合流页 */
  @Get()
  root(@Res() res: Response) {
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
