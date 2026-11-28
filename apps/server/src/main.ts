import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { webDistDir, webIndexFile } from './web-dist';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT || 3118);
  app.enableCors();

  // 托管 Web 端构建产物（apps/frontend/dist）；开发模式下由 Vite 开发服务器提供页面
  const hasWeb = Boolean(webIndexFile());
  if (hasWeb) {
    app.useStaticAssets(webDistDir(), { index: false, redirect: false });
  }

  await app.init();

  // SPA 兜底必须挂在所有 API 路由之后
  if (hasWeb) {
    const express = app.getHttpAdapter().getInstance();
    express.use((req: { path?: string; method?: string }, res: any, next: () => void) => {
      const index = webIndexFile();
      const path = String(req.path || '/');
      if (!index || path === '/composite' || path.startsWith('/api') || path.startsWith('/live')) {
        next();
        return;
      }
      res.sendFile(join(index));
    });
  }

  await app.listen(port, '0.0.0.0');
  console.log(`[fighting-plus] HTTP 服务已启动: http://localhost:${port}${hasWeb ? '' : '（未找到 Web 构建产物）'}`);
  console.log(`[fighting-plus] 合流页: http://localhost:${port}/composite`);
}

bootstrap();
