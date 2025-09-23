// File: electron-app/src/server/tag-validation/tag-validation.service.ts

import { Injectable } from '@nestjs/common';
// import Http from '../http/http.util'; // This was moved to be lazy-loaded to prevent startup crash

export interface TagValidationResult {
  tag: string;
  valid: boolean;
  usage: number;
  reason?: string;
}

export interface SiteTagValidation {
  site: string;
  validTags: string[];
  discardedTags: TagValidationResult[];
  _allResultsForLogging?: TagValidationResult[]; // Optional property for detailed logging
}

let Http: any = null;

@Injectable()
export class TagValidationService {
  private readonly MIN_TAG_USAGE = 100;
  private tagCache = new Map<string, TagValidationResult>();
  private lastRequestTime = new Map<string, number>();
  private readonly RATE_LIMIT_DELAY = 600; // ms between requests (safe for both sites)
  
  constructor() {}
  
  private _getHttp() {
    if (!Http) {
      Http = require('../http/http.util').default;
    }
    return Http;
  }

  async validateTagsForSite(
    tags: string[], 
    site: string
  ): Promise<SiteTagValidation> {
    const siteName = site.split('-')[0].toLowerCase();
    const supportedSites = ['derpibooru', 'e621'];
    // Only validate for booru sites
    if (!supportedSites.includes(siteName)) {
      return {
        site,
        validTags: tags,
        discardedTags: [],
        _allResultsForLogging: tags.map(t => ({ tag: t, valid: true, usage: -1, reason: 'Site not validated' }))
      };
    }

    const allResults: TagValidationResult[] = [];
    const validTags: string[] = [];
    const discardedTags: TagValidationResult[] = [];
    
    // First apply transformations
    const transformedTags = this.transformTags(tags, siteName);
    
    for (const tag of transformedTags) {
      // Rate limiting
      await this.enforceRateLimit(siteName);
      
      const validation = await this.validateSingleTag(tag, siteName);
      allResults.push(validation);
      
      if (validation.valid) {
        validTags.push(tag);
      } else {
        discardedTags.push(validation);
      }
    }
    
    return { site, validTags, discardedTags, _allResultsForLogging: allResults };
  }

  private async enforceRateLimit(site: string): Promise<void> {
    const now = Date.now();
    const lastRequest = this.lastRequestTime.get(site) || 0;
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      const waitTime = this.RATE_LIMIT_DELAY - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime.set(site, Date.now());
  }

  private async validateSingleTag(
    tag: string, 
    site: string
  ): Promise<TagValidationResult> {
    const siteName = site.split('-')[0].toLowerCase();
    const cacheKey = `${siteName}:${tag}`;
    
    if (this.tagCache.has(cacheKey)) {
      return this.tagCache.get(cacheKey)!;
    }
    
    try {
      const http = this._getHttp();
      const apiUrl = this.getTagApiUrl(tag, siteName);
      const headers = this.getHeaders(siteName);
      
      const res = await http.get(apiUrl, undefined, {
        headers,
        requestOptions: { json: true },
      });

      let response: any = null;
      if (res.error) {
        console.error(`Error validating tag "${tag}" on ${siteName}:`, res.error.message);
      } else {
        response = res.body;
      }
      
      let usage = 0;
      
      if (response) {
        if (siteName === 'e621' && Array.isArray(response) && response.length > 0) {
          usage = response[0].post_count || 0;
        } else if (siteName === 'derpibooru') {
          if (response && Array.isArray(response.tags) && response.tags.length > 0) {
            // Derpibooru returns an array of tags, even for an exact match.
            // The first result is the one we want. It also correctly handles aliases.
            usage = response.tags[0].images || 0;
          }
        }
      }
      
      const result = {
        tag,
        valid: usage >= this.MIN_TAG_USAGE,
        usage,
        reason: usage < this.MIN_TAG_USAGE 
          ? `Only ${usage} uses (min: ${this.MIN_TAG_USAGE})` 
          : undefined
      };
      
      this.tagCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Failed to validate tag "${tag}" on ${siteName}:`, error);
      const result = {
        tag,
        valid: false,
        usage: 0,
        reason: 'Failed to validate tag'
      };
      
      this.tagCache.set(cacheKey, result);
      return result;
    }
  }

  private getHeaders(site: string): any {
    const headers: any = {};
    
    if (site === 'e621') {
      // e621 requires a User-Agent header
      headers['User-Agent'] = 'PostyBirb/1.0 (by ClubVixen)';
    }
    
    // Add API keys if available (you'll need to implement settings for these)
    // if (site === 'derpibooru' && settings.derpibooruApiKey) {
    //   headers['Authorization'] = `Bearer ${settings.derpibooruApiKey}`;
    // }
    
    return headers;
  }

  private getTagApiUrl(tag: string, site: string): string {
    switch (site) {
      case 'e621': {
        const encodedTag = encodeURIComponent(tag);
        return `https://e621.net/tags.json?search[name]=${encodedTag}`;
      }
      case 'derpibooru': {
        // Derpibooru's standard search query uses standard URL encoding (%20 for spaces).
        const encodedTag = encodeURIComponent(tag);
        return `https://derpibooru.org/api/v1/json/search/tags?q=${encodedTag}`;
      }
      default:
        throw new Error(`Unsupported site: ${site}`);
    }
  }

  private transformTags(tags: string[], site: string): string[] {
    const siteName = site.split('-')[0].toLowerCase();
    const transformedTags = tags.map(tag => {
      const lowerTag = tag.toLowerCase();
      
      // Apply skin->fur transformations for pony content on booru sites
      if ((siteName === 'e621' || siteName === 'derpibooru') && this.hasPonyIndicator(tags)) {
        const skinColors = ['blue', 'green', 'yellow', 'pink', 'purple', 'orange', 'red', 'white', 'black', 'gray', 'grey', 'brown', 'tan'];
        for (const color of skinColors) {
          if (lowerTag === `${color}_skin` || lowerTag === `${color} skin`) {
            return `${color}_fur`;
          }
        }
        
        // Derpibooru-specific transformations
        if (siteName === 'derpibooru' && lowerTag === 'horse') {
          return 'pony';
        }
      }
      /*
      // MLP transformations
      if (site === 'derpibooru' && lowerTag === 'my_little_pony') {
        return 'my little pony: friendship is magic';
      }
      if (site === 'e621' && lowerTag === 'mlp') {
        return 'my_little_pony';
      }
      */
      return tag;
    });
    
    // Apply site-specific formatting
    return this.formatTagsForSite(transformedTags, siteName);
  }

  private formatTagsForSite(tags: string[], site: string): string[] {
    let formattedTags = [...tags];
    
    switch (site) {
      case 'e621':
        // e621 uses underscores and lowercase
        formattedTags = formattedTags.map(tag => 
          tag.toLowerCase().replace(/\s+/g, '_').replace(/:/g, '_')
        );
        break;
      case 'derpibooru':
        // Derpibooru uses spaces and lowercase.
        // Replace any combination of underscores and whitespace with a single space.
        formattedTags = formattedTags.map(tag =>
          tag.toLowerCase().replace(/[_\s]+/g, ' ').trim()
        );
        break;
    }
    
    // Remove duplicates
    return [...new Set(formattedTags)];
  }

  private hasPonyIndicator(tags: string[]): boolean {
    const ponyIndicators = [
      'pony', 'mlp', 'my_little_pony', 'my little pony',
      'equine', 'unicorn', 'pegasus', 'earth_pony', 'alicorn',
      'cutie_mark', 'fim', 'brony', 'equestria',
      'twilight_sparkle', 'rainbow_dash', 'fluttershy',
      'pinkie_pie', 'applejack', 'rarity'
    ];
    
    return tags.some(tag => 
      ponyIndicators.some(indicator => 
        tag.toLowerCase().replace(/[_\s]+/g, '').includes(
          indicator.replace(/[_\s]+/g, '')
        )
      )
    );
  }
}