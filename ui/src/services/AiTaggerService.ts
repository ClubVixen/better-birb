// aiTaggerService.ts

import path from 'path';

export interface AiTagResult {
  tags: string[];
  rating: string;
  title: string; 
}




/**
 * Get tags + rating from deepbooru, then return them (leaving title empty).
 */
export async function getAutoTagsNoUI(imagePath: string): Promise<AiTagResult> {
  // FIRST get tags & rating from deepbooru
  const { tags, rating } = await (window as any).aiTaggerApi.autoTagImage(imagePath);
  return { tags, rating, title: '' };
}

/**
 * Get a title from Qwen2-VL (or DeepSeek‑VL) using the image path, tags, and rating.
 */
export async function getImageTitle(imagePath: string, tags: string[], rating: string): Promise<string> {
  const { title } = await (window as any).aiTaggerApi.generateTitle(imagePath, tags, rating);
  return title;
}
