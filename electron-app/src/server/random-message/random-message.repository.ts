// random-message.repository.ts
import RandomMessageEntity from './models/random-message.entity';
import PersistedDatabase from 'src/server/database/databases/persisted.database';
import MemoryDatabase from 'src/server/database/databases/memory.database';

export const RandomMessageRepositoryToken = 'RandomMessageRepositoryToken';
export type RandomMessageRepository =
  | PersistedDatabase<RandomMessageEntity, RandomMessageEntity>
  | MemoryDatabase<RandomMessageEntity, RandomMessageEntity>;
