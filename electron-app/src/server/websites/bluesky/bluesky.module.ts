import { Module } from '@nestjs/common';
import { Bluesky } from './bluesky.service';
import { BlueskyController } from './bluesky.controller';
import { RandomMessageModule } from 'src/server/random-message/random-message.module';

@Module({
  imports: [
    RandomMessageModule
  ],
  providers: [Bluesky],
  controllers: [BlueskyController],
  exports: [Bluesky],
})
export class BlueskyModule {}
