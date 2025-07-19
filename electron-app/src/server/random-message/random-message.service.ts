import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import RandomMessageEntity from './models/random-message.entity';
import {
  RandomMessageRepository,
  RandomMessageRepositoryToken,
} from './random-message.repository';
import { Events, RandomMessageEvent } from 'postybirb-commons';
import { EventsGateway } from 'src/server/events/events.gateway';

@Injectable()
export class RandomMessageService {
  private readonly logger = new Logger(RandomMessageService.name);

  constructor(
    @Inject(RandomMessageRepositoryToken)
    private repository: RandomMessageRepository,
    private readonly eventEmitter: EventsGateway,  // socket/broadcast handler
  ) {}

  async get(id: string) {
    const entity = await this.repository.findOne(id);
    if (!entity) {
      throw new NotFoundException(`RandomMessageEntity ${id} not found`);
    }
    return entity;
  }

  getAll() {
    return this.repository.find();
  }

  async create(dto: RandomMessageEntity) {
    this.logger.log(dto, 'Creating RandomMessageEntity');
    const rm = await this.repository.save(dto);
    // Emit a CREATED event, passing the entire new entity
    this.eventEmitter.emit(RandomMessageEvent.CREATED, rm);
    return rm;
  }

  async update(updateDto: RandomMessageEntity) {
    const exists = await this.repository.findOne(updateDto._id);
    if (!exists) {
      throw new NotFoundException(
        `RandomMessageEntity ${updateDto._id} does not exist.`,
      );
    }

    // Update fields
    exists.title = updateDto.title;
    exists.messages = updateDto.messages;
    exists.reply = updateDto.reply;

    await this.repository.update(exists);
    // Emit an UPDATED event, passing the updated entity
    this.eventEmitter.emit(RandomMessageEvent.UPDATED, exists);
    return exists;
  }

  async remove(id: string) {
    this.logger.log(id, 'Removing RandomMessageEntity');
    await this.repository.remove(id);
    // Emit a REMOVED event, passing just the ID
    this.eventEmitter.emit(RandomMessageEvent.REMOVED, id);
    return { success: true };
  }
}
