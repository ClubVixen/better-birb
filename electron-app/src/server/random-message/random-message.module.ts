// random-message.module.ts
import { Module } from '@nestjs/common';
import { RandomMessageService } from './random-message.service';
import { RandomMessageController } from './random-message.controller';
import { RandomMessageRepositoryToken } from './random-message.repository';
import { DatabaseFactory } from 'src/server/database/database.factory';
import RandomMessageEntity from './models/random-message.entity';

@Module({
  imports: [],
  controllers: [RandomMessageController],
  providers: [
    RandomMessageService,
    // Create a new DB
    DatabaseFactory.forProvider(RandomMessageRepositoryToken, {
      entity: RandomMessageEntity,
      databaseName: 'random-message', // => random-message.db
    }),
  ],
  exports: [RandomMessageService],
})
export class RandomMessageModule {}
