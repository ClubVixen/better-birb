// random-message.controller.ts
import { Controller, Get, Post, Body, Patch, Delete, Param } from '@nestjs/common';
import { RandomMessageService } from './random-message.service';
import RandomMessageEntity from './models/random-message.entity';

@Controller('random-message')
export class RandomMessageController {
  constructor(private readonly service: RandomMessageService) {}

  @Get()
  async getAll() {
    return this.service.getAll();
  }

  @Post('create')
  async create(@Body() dto: RandomMessageEntity) {
    return this.service.create(dto);
  }

  @Patch('update')
  async update(@Body() dto: RandomMessageEntity) {
    return this.service.update(dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
