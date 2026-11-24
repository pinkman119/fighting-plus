import { Module } from '@nestjs/common';
import { StreamsModule } from './streams/streams.module';
import { ObsModule } from './obs/obs.module';
import { CompositeModule } from './composite/composite.module';

@Module({
  imports: [StreamsModule, ObsModule, CompositeModule],
})
export class AppModule {}
