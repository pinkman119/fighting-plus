import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import * as fs from 'fs'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const useTls = process.env.USE_TLS === 'true'
  const httpsOptions =
    useTls && process.env.TLS_CERT && process.env.TLS_KEY
      ? {
          cert: fs.readFileSync(process.env.TLS_CERT),
          key: fs.readFileSync(process.env.TLS_KEY)
        }
      : undefined

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { httpsOptions })

  app.setGlobalPrefix('api/v1')
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN || true, credentials: true })
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  )

  // 地图图片静态目录
  const uploadDir = process.env.UPLOAD_DIR || './uploads'
  fs.mkdirSync(uploadDir, { recursive: true })
  app.useStaticAssets(join(process.cwd(), uploadDir), { prefix: '/uploads/' })

  const port = Number(process.env.PORT || 3000)
  await app.listen(port)
  console.log(`[fighting-plus] server listening on port ${port} (${useTls ? 'https' : 'http'})`)
}

void bootstrap()
