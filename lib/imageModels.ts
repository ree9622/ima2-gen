import type { RouteRuntimeContext } from "./runtimeContext.js";

const FALLBACK_IMAGE_MODEL = "gpt-5.4-mini";
const VALID_IMAGE_MODELS = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
const UNSUPPORTED_IMAGE_MODELS = new Set(["gpt-5.3-codex-spark"]);
const FALLBACK_REASONING_EFFORT = "none";
const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

const GROK_FALLBACK_IMAGE_MODEL = "grok-imagine-image";
const VALID_GROK_IMAGE_MODELS = new Set(["grok-imagine-image", "grok-imagine-image-quality"]);

const GEMINI_API_FALLBACK_IMAGE_MODEL = "nano-banana-2";
const VALID_GEMINI_API_MODELS = new Set(["nano-banana-2", "nano-banana-pro"]);

export function normalizeReasoningEffort(ctx: RouteRuntimeContext | null | undefined, rawEffort: unknown) {
  const configured = (ctx?.config as { imageModels?: { reasoningEffort?: string; validReasoningEfforts?: Set<string> } } | undefined)?.imageModels;
  const fallback = configured?.reasoningEffort ?? FALLBACK_REASONING_EFFORT;
  const valid = configured?.validReasoningEfforts ?? VALID_REASONING_EFFORTS;

  if (typeof rawEffort !== "string" || rawEffort.length === 0) {
    return { effort: valid.has(fallback) ? fallback : FALLBACK_REASONING_EFFORT };
  }
  if (!valid.has(rawEffort)) {
    return {
      error: "reasoningEffort must be one of: none, low, medium, high, xhigh",
      code: "INVALID_REASONING_EFFORT",
      status: 400,
    };
  }
  return { effort: rawEffort };
}

export function normalizeImageModel(ctx: RouteRuntimeContext | null | undefined, rawModel: unknown) {
  const configured = (ctx?.config as { imageModels?: { default?: string; valid?: Set<string>; unsupported?: Set<string> } } | undefined)?.imageModels;
  const fallback = configured?.default ?? FALLBACK_IMAGE_MODEL;
  const valid = configured?.valid ?? VALID_IMAGE_MODELS;
  const unsupported = configured?.unsupported ?? UNSUPPORTED_IMAGE_MODELS;

  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: valid.has(fallback) ? fallback : FALLBACK_IMAGE_MODEL };
  }

  if (unsupported.has(rawModel)) {
    return {
      error: "model is listed by OAuth but does not support image_generation: gpt-5.3-codex-spark",
      code: "IMAGE_MODEL_UNSUPPORTED",
      status: 400,
    };
  }

  if (!valid.has(rawModel)) {
    return {
      error: "model must be one of: gpt-5.5, gpt-5.4, gpt-5.4-mini",
      code: "INVALID_IMAGE_MODEL",
      status: 400,
    };
  }

  return { model: rawModel };
}

export function normalizeGrokImageModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: GROK_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_GROK_IMAGE_MODELS.has(rawModel)) {
    return {
      error: `Grok image model must be one of: ${[...VALID_GROK_IMAGE_MODELS].join(", ")}`,
      code: "INVALID_GROK_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

export function normalizeGeminiApiModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: GEMINI_API_FALLBACK_IMAGE_MODEL };
  }
  if (!VALID_GEMINI_API_MODELS.has(rawModel)) {
    return {
      error: `Gemini API image model must be one of: ${[...VALID_GEMINI_API_MODELS].join(", ")}`,
      code: "INVALID_GEMINI_API_IMAGE_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

// ── Grok video (T2V/I2V) ─────────────────────────────────────────────────
// Video is a separate generation kind, not an image model. Keep it out of the
// image model unions/helpers above so `grok-` image classification is unaffected.
const GROK_FALLBACK_VIDEO_MODEL = "grok-imagine-video";
export const VALID_GROK_VIDEO_MODELS = new Set(["grok-imagine-video", "grok-imagine-video-1.5-preview"]);
export const VALID_VIDEO_RESOLUTIONS = new Set(["480p", "720p"]);
export const VALID_VIDEO_ASPECT_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "auto",
]);
export const MIN_VIDEO_DURATION = 1;
export const MAX_VIDEO_DURATION = 15;
// reference-to-video (xAI): up to 7 reference images, max 10s duration.
export const MAX_REF2V_REFERENCES = 7;
export const MAX_REF2V_DURATION = 10;

export type GrokVideoModel = "grok-imagine-video" | "grok-imagine-video-1.5-preview";
export type VideoResolution = "480p" | "720p";
export type VideoAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "auto";
export type VideoMode = "text-to-video" | "image-to-video" | "reference-to-video";

// Mode is derived purely from the number of attached reference images.
export function deriveVideoMode(refCount: number): VideoMode {
  if (refCount >= 2) return "reference-to-video";
  if (refCount === 1) return "image-to-video";
  return "text-to-video";
}

// Clamp duration to the reference-to-video ceiling; other modes keep their value.
export function clampVideoDuration(duration: number, mode: VideoMode): number {
  return mode === "reference-to-video" ? Math.min(duration, MAX_REF2V_DURATION) : duration;
}

export function isGrokVideoModel(value: unknown): value is GrokVideoModel {
  return typeof value === "string" && VALID_GROK_VIDEO_MODELS.has(value);
}

export function normalizeGrokVideoModel(rawModel: unknown) {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return { model: GROK_FALLBACK_VIDEO_MODEL };
  }
  if (!VALID_GROK_VIDEO_MODELS.has(rawModel)) {
    return {
      error: `Grok video model must be one of: ${[...VALID_GROK_VIDEO_MODELS].join(", ")}`,
      code: "INVALID_GROK_VIDEO_MODEL" as const,
      status: 400 as const,
    };
  }
  return { model: rawModel };
}

export function normalizeVideoResolution(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return { resolution: "480p" as const };
  if (typeof raw !== "string" || !VALID_VIDEO_RESOLUTIONS.has(raw)) {
    return {
      error: `resolution must be one of: ${[...VALID_VIDEO_RESOLUTIONS].join(", ")}`,
      code: "INVALID_VIDEO_RESOLUTION" as const,
      status: 400 as const,
    };
  }
  return { resolution: raw as VideoResolution };
}

export function normalizeVideoAspectRatio(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return { aspectRatio: "auto" as const };
  if (typeof raw !== "string" || !VALID_VIDEO_ASPECT_RATIOS.has(raw)) {
    return {
      error: `aspectRatio must be one of: ${[...VALID_VIDEO_ASPECT_RATIOS].join(", ")}`,
      code: "INVALID_VIDEO_ASPECT_RATIO" as const,
      status: 400 as const,
    };
  }
  return { aspectRatio: raw as VideoAspectRatio };
}

export function normalizeVideoDuration(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return { duration: 5 };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < MIN_VIDEO_DURATION || n > MAX_VIDEO_DURATION) {
    return {
      error: `duration must be an integer between ${MIN_VIDEO_DURATION} and ${MAX_VIDEO_DURATION} seconds`,
      code: "INVALID_VIDEO_DURATION" as const,
      status: 400 as const,
    };
  }
  return { duration: n };
}
