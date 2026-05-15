import type { GenerateItem } from "../types";

export function getGalleryItemKey(item: Pick<GenerateItem, "filename" | "image">): string {
  return item.filename || item.image;
}

export function isGalleryVisibleItem(item: Pick<GenerateItem, "canvasVersion">): boolean {
  return !item.canvasVersion;
}

export function uniqueGalleryItems(items: GenerateItem[]): GenerateItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getGalleryItemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
