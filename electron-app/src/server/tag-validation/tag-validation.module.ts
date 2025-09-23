import { Module } from '@nestjs/common';
import { TagValidationService } from './tag-validation.service';
import { TagValidationController } from './tag-validation.controller';
import { TestController } from './test.controller';

@Module({
  imports: [],
  controllers: [],
  providers: [TagValidationService],
  exports: [TagValidationService]
})
export class TagValidationModule {}