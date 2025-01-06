interface AiTagResult {
  tags: string[];
  rating: string;
}

export async function getAutoTagsNoUI(imagePath: string): Promise<AiTagResult> {
  // Now call the function exposed by preload
  return (window as any).aiTaggerApi.autoTagImage(imagePath);
}
