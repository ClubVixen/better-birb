// random-message/models/random-message.entity.ts
import Entity from 'src/server/database/models/entity.model';
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export default class RandomMessageEntity extends Entity {
  @IsString()
  @IsNotEmpty()
  title: string; // Some label, e.g. "Twitter random set #1"

  @IsArray()
  @IsNotEmpty()
  messages: string[]; // The pool of random messages

  @IsString()
  @IsOptional()
  reply?: string; // Optional single reply message

  constructor(partial?: Partial<RandomMessageEntity>) {
    super(partial);
  }
}
