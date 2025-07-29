// File: electron-app/src/server/tag-validation/tag-validation.module.ts

import { Module, HttpModule } from '@nestjs/common';
import { TagValidationService } from './tag-validation.service';
import { TagValidationController } from './tag-validation.controller';

@Module({
  imports: [HttpModule],
  controllers: [TagValidationController],
  providers: [TagValidationService],
  exports: [TagValidationService]
})
export class TagValidationModule {}