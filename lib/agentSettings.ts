import type { AgentGenerationSettings } from "./agentTypes.js";

const PROVIDERS = new Set(["oauth", "api", "grok", "grok-api", "agy", "gemini-api"]);
const QUALITIES = new Set(["low", "medium", "high"]);
const FORMATS = new Set(["png", "jpeg", "webp"]);
const MODERATIONS = new Set(["auto", "low"]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const GENERATION_STRATEGIES = new Set(["auto", "manual"]);

export const DEFAULT_AGENT_GENERATION_SETTINGS: AgentGenerationSettings = {
  provider: "oauth",
  model: "gpt-5.4-mini",
  quality: "medium",
  size: "1024x1024",
  format: "png",
  moderation: "low",
  reasoningEffort: "medium",
  webSearchEnabled: true,
  generationStrategy: "auto",
  variants: 1,
  maxAutoVariants: 8,
  parallelism: 2,
};

export function normalizeAgentGenerationSettings(
  value: unknown,
  fallback: AgentGenerationSettings = DEFAULT_AGENT_GENERATION_SETTINGS,
): AgentGenerationSettings {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    provider: cleanEnum(input.provider, PROVIDERS, fallback.provider),
    model: cleanString(input.model, fallback.model),
    quality: cleanEnum(input.quality, QUALITIES, fallback.quality),
    size: cleanSize(input.size, fallback.size),
    format: cleanEnum(input.format, FORMATS, fallback.format),
    moderation: cleanEnum(input.moderation, MODERATIONS, fallback.moderation),
    reasoningEffort: cleanEnum(input.reasoningEffort, REASONING_EFFORTS, fallback.reasoningEffort),
    webSearchEnabled: typeof input.webSearchEnabled === "boolean" ? input.webSearchEnabled : fallback.webSearchEnabled,
    generationStrategy: cleanEnum(input.generationStrategy, GENERATION_STRATEGIES, fallback.generationStrategy),
    variants: cleanPositiveInt(input.variants, fallback.variants, 1, 8),
    maxAutoVariants: cleanPositiveInt(input.maxAutoVariants, fallback.maxAutoVariants, 1, 8),
    parallelism: cleanPositiveInt(input.parallelism, fallback.parallelism, 1, 8),
  };
}

export function mergeAgentGenerationSettings(
  current: AgentGenerationSettings,
  patch: unknown,
): AgentGenerationSettings {
  return normalizeAgentGenerationSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) }, current);
}

function cleanEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === "string" && allowed.has(value) ? value as T : fallback;
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : fallback;
}

function cleanSize(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed === "auto") return trimmed;
  return /^\d{3,4}x\d{3,4}$/.test(trimmed) ? trimmed : fallback;
}

function cleanPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}
