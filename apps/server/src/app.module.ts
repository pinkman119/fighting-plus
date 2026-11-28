import { Module } from '@nestjs/common';
import { StreamsModule } from './streams/streams.module';
import { ObsModule } from './obs/obs.module';
import { CompositeModule } from './composite/composite.module';
import { SrsModule } from './srs/srs.module';
import { MediaModule } from './media/media.module';
import { RoomsModule } from './rooms/rooms.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [SrsModule, MediaModule, StreamsModule, ObsModule, CompositeModule, RoomsModule],
  controllers: [HealthController],
})
export class AppModule {}
