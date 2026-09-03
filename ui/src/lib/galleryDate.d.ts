export type GalleryDateItem = {
  createdAt?: number;
  filename?: string;
};

export function compareGalleryItemsNewestFirst(
  a: GalleryDateItem,
  b: GalleryDateItem,
): number;

export function galleryDateBucket(
  createdAt: number | undefined,
  now?: number,
): string;
