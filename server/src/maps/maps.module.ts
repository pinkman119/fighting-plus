import { Module } from '@nestjs/common'
import { MapsController } from './maps.controller'
import { StorageService } from './storage.service'

@Module({
  controllers: [MapsController],
  providers: [StorageService],
  exports: [StorageService]
})
export class MapsModule {}
