import type { Quality } from "../types";

// Rough cost-per-image for gpt-image-2 sizes (preset-based estimate).
// Size auto/custom fall back to the nearest keyed size or 1024².
export const COST_MAP: Record<Quality, Record<string, number>> = {
  low: {
    "1024x1024": 0.006,
    "1024x1536": 0.005,
    "1536x1024": 0.005,
    "1024x1360": 0.005,
    "1360x1024": 0.005,
    "1024x1824": 0.006,
    "1824x1024": 0.006,
    "2048x2048": 0.012,
    "2048x1152": 0.009,
    "1152x2048": 0.009,
    "3840x2160": 0.023,
    "2160x3840": 0.023,
    auto: 0.006,
  },
  medium: {
    "1024x1024": 0.053,
    "1024x1536": 0.041,
    "1536x1024": 0.041,
    "1024x1360": 0.041,
    "1360x1024": 0.041,
    "1024x1824": 0.05,
    "1824x1024": 0.05,
    "2048x2048": 0.106,
    "2048x1152": 0.08,
    "1152x2048": 0.08,
    "3840x2160": 0.2,
    "2160x3840": 0.2,
    auto: 0.053,
  },
  high: {
    "1024x1024": 0.211,
    "1024x1536": 0.165,
    "1536x1024": 0.165,
    "1024x1360": 0.165,
    "1360x1024": 0.165,
    "1024x1824": 0.2,
    "1824x1024": 0.2,
    "2048x2048": 0.422,
    "2048x1152": 0.32,
    "1152x2048": 0.32,
    "3840x2160": 0.8,
    "2160x3840": 0.8,
    auto: 0.211,
  },
};

const GEMINI_API_COST: Record<string, number> = {
  "512": 0.002,
  "1K": 0.004,
  "2K": 0.006,
  "4K": 0.010,
};

export function estimateGeminiApiCost(size: string): number {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return 0.004;
  const maxDim = Math.max(Number(match[1]), Number(match[2]));
  if (maxDim <= 512) return GEMINI_API_COST["512"];
  if (maxDim <= 1024) return GEMINI_API_COST["1K"];
  if (maxDim <= 2048) return GEMINI_API_COST["2K"];
  return GEMINI_API_COST["4K"];
}

export function estimateCost(quality: Quality, size: string, provider?: string): number {
  if (provider === "gemini-api") return estimateGeminiApiCost(size);
  return COST_MAP[quality]?.[size] ?? 0;
}
