/**
 * @deprecated Replaced by continueFromItem() in ../continueFromItem.ts
 *
 * Original image-only implementation of useCurrentAsReference (store action).
 * Preserved here as legacy reference — not imported by production code.
 *
 * Limitations:
 * - Only supports images (no video frame extraction)
 * - No video continuity lineage
 * - No prompt transfer
 * - No video topic loading
 *
 * Replaced by continueFromItem() which unifies the gallery "여기서 이어서"
 * and the composer "이어가기" buttons into a single code path that handles
 * both image and video items.
 */

export const LEGACY_USE_CURRENT_AS_REFERENCE = `
useCurrentAsReference: async () => {
  const cur = get().currentImage;
  if (!cur) {
    get().showToast(t("toast.noCurrentImageForRef"), true);
    return;
  }
  if (get().referenceImages.length >= MAX_REFERENCE_IMAGES) {
    get().showToast(t("toast.refSlotFull"), true);
    return;
  }
  let dataUrl: string;
  try {
    dataUrl = await compressReferenceSource(cur.image, cur.filename || "current-reference.png");
  } catch {
    get().showToast(t("toast.currentImageLoadFailed"), true);
    return;
  }
  set((s) => ({
    referenceImages: [...s.referenceImages, dataUrl].slice(0, MAX_REFERENCE_IMAGES),
  }));
  get().showToast(t("toast.addedCurrentAsRef"));
},
`;
