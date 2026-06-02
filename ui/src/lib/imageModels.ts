import type { ImageModel, OpenAIImageModel, GeminiImageModel, Provider, UnsupportedImageModel, VideoModel } from "../types";

export const DEFAULT_IMAGE_MODEL: ImageModel = "gpt-5.4-mini";
export const IMAGE_MODEL_STORAGE_KEY = "ima2.imageModel";

export const IMAGE_MODEL_OPTIONS: Array<{
  value: ImageModel;
  shortLabel: string;
  fullLabelKey: string;
}> = [
  { value: "gpt-5.4-mini", shortLabel: "5.4m", fullLabelKey: "settings.imageModel.gpt54Mini" },
  { value: "gpt-5.4", shortLabel: "5.4", fullLabelKey: "settings.imageModel.gpt54" },
  { value: "gpt-5.5", shortLabel: "5.5", fullLabelKey: "settings.imageModel.gpt55" },
  { value: "grok-imagine-image", shortLabel: "grok", fullLabelKey: "settings.imageModel.grokImagine" },
  { value: "grok-imagine-image-quality", shortLabel: "grok+", fullLabelKey: "settings.imageModel.grokImagineQuality" },
  { value: "nano-banana-2", shortLabel: "agy", fullLabelKey: "settings.imageModel.nanoBanana2" },
];

const GEMINI_MODEL_VALUES = new Set<string>(["nano-banana-2"]);

export const OPENAI_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is { value: OpenAIImageModel; shortLabel: string; fullLabelKey: string } =>
    !option.value.startsWith("grok-") && !GEMINI_MODEL_VALUES.has(option.value),
);

export const GROK_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter((option) =>
  option.value.startsWith("grok-"),
);

export const GEMINI_IMAGE_MODEL_OPTIONS = IMAGE_MODEL_OPTIONS.filter(
  (option): option is { value: GeminiImageModel; shortLabel: string; fullLabelKey: string } =>
    GEMINI_MODEL_VALUES.has(option.value),
);

export const UNSUPPORTED_IMAGE_MODELS: Array<{
  value: UnsupportedImageModel;
  fullLabelKey: string;
}> = [
  { value: "gpt-5.3-codex-spark", fullLabelKey: "settings.imageModel.gpt53CodexSpark" },
];

export function isImageModel(value: unknown): value is ImageModel {
  return IMAGE_MODEL_OPTIONS.some((option) => option.value === value);
}

export function isGrokImageModel(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("grok-");
}

export function isGeminiImageModel(value: unknown): boolean {
  return typeof value === "string" && GEMINI_MODEL_VALUES.has(value);
}

export function getImageModelOptionsForProvider(provider: Provider) {
  if (provider === "grok") return GROK_IMAGE_MODEL_OPTIONS;
  if (provider === "agy") return GEMINI_IMAGE_MODEL_OPTIONS;
  return OPENAI_IMAGE_MODEL_OPTIONS;
}

export function getImageModelShortLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return IMAGE_MODEL_OPTIONS.find((option) => option.value === value)?.shortLabel ?? value;
}

// ── Grok video model (separate kind from image models) ───────────────────
export const VIDEO_MODEL_OPTIONS: Array<{ value: VideoModel; shortLabel: string; fullLabelKey: string }> = [
  { value: "grok-imagine-video", shortLabel: "grokv", fullLabelKey: "settings.videoModel.grokImagine" },
  { value: "grok-imagine-video-1.5-preview", shortLabel: "grokv1.5", fullLabelKey: "settings.videoModel.grokImagine15" },
];

export function isVideoModelValue(v: unknown): v is VideoModel {
  return v === "grok-imagine-video" || v === "grok-imagine-video-1.5-preview";
}

export const MAX_REF2V_DURATION_UI = 10;

export function deriveVideoModeUI(refCount: number): "text-to-video" | "image-to-video" | "reference-to-video" {
  if (refCount >= 2) return "reference-to-video";
  if (refCount === 1) return "image-to-video";
  return "text-to-video";
}

export function clampVideoDurationUI(duration: number, mode: string): number {
  return mode === "reference-to-video" ? Math.min(duration, MAX_REF2V_DURATION_UI) : duration;
}
