import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { StorageService } from './storage.service'
import { IMAGE_EXT, sniffImage } from './sniff'

const MAX_MAP_SIZE = 10 * 1024 * 1024 // 10MB

@Controller('maps')
@UseGuards(JwtAuthGuard)
export class MapsController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MAP_SIZE, files: 1 }
    })
  )
  upload(@UploadedFile() file?: Express.Multer.File): { url: string } {
    if (!file) throw new BadRequestException('缺少文件')
    if (file.size > MAX_MAP_SIZE) throw new BadRequestException('文件超过 10MB 限制')

    const sniffed = sniffImage(file.buffer)
    if (!sniffed) throw new BadRequestException('仅支持 jpg / png / webp 图片')

    const url = this.storage.save(file.buffer, IMAGE_EXT[sniffed])
    return { url }
  }
}
