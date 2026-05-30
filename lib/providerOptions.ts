import type { RuntimeContext } from "./runtimeContext.js";
import { normalizeImageModel, normalizeReasoningEffort, normalizeGrokImageModel } from "./imageModels.js";

export function resolveProviderOptions(ctx: RuntimeContext | null | undefined, {
  provider = "oauth",
  rawModel,
  rawReasoningEffort,
  rawSize = "1024x1024",
  rawWebSearchEnabled = true,
  searchMode = "on",
}: any = {}) {
  if (provider === "grok") {
    const grokCfg: { defaultImageModel?: string } = (ctx?.config as any)?.grokProvider || {};
    const modelInput = rawModel || grokCfg.defaultImageModel;
    const grokModelCheck = normalizeGrokImageModel(modelInput);
    if (grokModelCheck.error) return { error: grokModelCheck.error, code: grokModelCheck.code, status: grokModelCheck.status };
    return {
      provider: "grok" as const,
      model: grokModelCheck.model,
      reasoningEffort: "none",
      size: rawSize,
      webSearchEnabled: false,
    };
  }

  const activeProvider = provider === "api" ? "api" : "oauth";
  const apiConfig: { defaultImageModel?: string; defaultReasoningEffort?: string; defaultSize?: string; allowWebSearch?: boolean } = (ctx?.config as { apiProvider?: any })?.apiProvider || {};
  const modelInput = activeProvider === "api"
    ? (rawModel || apiConfig.defaultImageModel || "gpt-5.4-mini")
    : rawModel;
  const modelCheck = normalizeImageModel(ctx, modelInput);
  if (modelCheck.error) return { error: modelCheck.error, code: modelCheck.code, status: modelCheck.status };

  const reasoningInput = activeProvider === "api"
    ? (rawReasoningEffort || apiConfig.defaultReasoningEffort || "low")
    : rawReasoningEffort;
  const reasoningCheck = normalizeReasoningEffort(ctx, reasoningInput);
  if (reasoningCheck.error) {
    return { error: reasoningCheck.error, code: reasoningCheck.code, status: reasoningCheck.status };
  }

  const size = activeProvider === "api" && (typeof rawSize !== "string" || rawSize.length === 0)
    ? (apiConfig.defaultSize || "1024x1024")
    : rawSize;
  const webSearchEnabled = activeProvider === "api"
    ? apiConfig.allowWebSearch !== false && rawWebSearchEnabled !== false && searchMode !== "off"
    : rawWebSearchEnabled !== false && searchMode !== "off";

  return {
    provider: activeProvider,
    model: modelCheck.model,
    reasoningEffort: reasoningCheck.effort,
    size,
    webSearchEnabled,
  };
}
