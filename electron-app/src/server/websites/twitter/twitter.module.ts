import { Module } from '@nestjs/common';
import { TwitterAPIService } from './twitter-api.service';
import { TwitterController } from './twitter.controller';
import { Twitter } from './twitter.service';
import { RandomMessageModule } from 'src/server/random-message/random-message.module';

@Module({
  controllers: [TwitterController],
  imports: [
      RandomMessageModule
    ],
  providers: [Twitter, TwitterAPIService],
  exports: [Twitter],
})
export class TwitterModule {}
