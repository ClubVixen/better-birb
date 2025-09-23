// File: electron-app/src/server/tag-validation/tag-validation.controller.ts

import { Controller, Post, Body, Logger } from '@nestjs/common';
import { TagValidationService, SiteTagValidation } from './tag-validation.service';
import { IsArray, IsString } from 'class-validator';

export class ValidateTagsDto {
  @IsArray()
  @IsString({ each: true })
  tags: string[];

  @IsArray()
  @IsString({ each: true })
  sites: string[];
}

@Controller('api/tag-validation')
export class TagValidationController {
  private readonly logger = new Logger(TagValidationController.name);

  constructor(private readonly tagValidation: TagValidationService) {}

  @Post('validate-for-sites')
  async validateTagsForSites(
    @Body() body: ValidateTagsDto
  ): Promise<{ validations: SiteTagValidation[] }> {
    this.logger.log('--- ENTERING validateTagsForSites ---');
    this.logger.log(`Received body: ${JSON.stringify(body)}`);
    
    if (!body || !body.tags || !body.sites) {
        this.logger.warn('Invalid body received.');
        return { validations: [] };
    }
    
    try {
      this.logger.log('Calling TagValidationService...');
      const results = await Promise.all(
        body.sites.map(site => 
          this.tagValidation.validateTagsForSite(body.tags, site)
        )
      );
      
      this.logger.log(`Service returned results: ${JSON.stringify(results)}`);
      
      return { validations: results };
    } catch (error) {
      this.logger.error('--- ERROR in validateTagsForSites ---', error.stack);
      return { 
        validations: body.sites.map(site => ({
          site,
          validTags: body.tags,
          discardedTags: []
        }))
      };
    } finally {
        this.logger.log('--- EXITING validateTagsForSites ---');
    }
  }
}
