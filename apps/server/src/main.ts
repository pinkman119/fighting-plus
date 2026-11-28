import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT || 3200);
  app.enableCors();
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[obs-multiview] HTTP 服务已启动: http://localhost:${port}/composite`);
}
bootstrap();
