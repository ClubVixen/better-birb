// File: electron-app/src/server/tag-validation/tag-validation.controller.ts

import { Controller, Post, Body } from '@nestjs/common';
import { TagValidationService, SiteTagValidation } from './tag-validation.service';

@Controller('tag-validation')
export class TagValidationController {
  constructor(private readonly tagValidation: TagValidationService) {}

  @Post('validate-for-sites')
  async validateTagsForSites(
    @Body() body: { tags: string[]; sites: string[] }
  ): Promise<{ validations: SiteTagValidation[] }> {
    console.log('[TagValidation] Received request:', {
      tags: body.tags,
      sites: body.sites
    });
    
    try {
      const results = await Promise.all(
        body.sites.map(site => 
          this.tagValidation.validateTagsForSite(body.tags, site)
        )
      );
      
      console.log('[TagValidation] Returning results:', results);
      
      return { validations: results };
    } catch (error) {
      console.error('[TagValidation] Error:', error);
      // Return empty validations on error
      return { 
        validations: body.sites.map(site => ({
          site,
          validTags: body.tags,
          discardedTags: []
        }))
      };
    }
  }
}