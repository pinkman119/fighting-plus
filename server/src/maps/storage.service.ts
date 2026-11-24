import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { join } from 'path'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

@Injectable()
export class StorageService {
  private uploadDir(): string {
    const dir = process.env.UPLOAD_DIR || './uploads'
    fs.mkdirSync(dir, { recursive: true })
    return join(process.cwd(), dir)
  }

  /**
   * 保存地图图片（文件类型已通过魔数嗅探校验，由调用方保证）。
   * 预留 S3 适配点：后续将本方法替换为对象存储实现即可。
   */
  save(buffer: Buffer, ext: string): string {
    const filename = `${randomUUID()}${ext}`
    fs.writeFileSync(join(this.uploadDir(), filename), buffer)
    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000'
    return `${publicUrl}/uploads/${filename}`
  }

  contentTypeFor(ext: string): string {
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
  }
}
