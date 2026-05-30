import { errInfo } from "./errInfo.js";
import {
  imageEditPayload,
  imagePayload,
  planGrokImage,
  postGrokImages,
  grokError,
  type GrokReferenceImage,
} from "./grokImageAdapter.js";
import { logEvent } from "./logger.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";

export interface GrokMultimodeResult {
  images: Array<{ b64: string; revisedPrompt?: string; mime?: string }>;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  extraIgnored: number;
}

export async function generateMultimodeViaGrok(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: {
    model?: string;
    maxImages?: number;
    size?: string;
    signal?: AbortSignal;
    requestId?: string;
    references?: GrokReferenceImage[];
    onFinalImage?: (image: { b64: string; revisedPrompt?: string; mime?: string }, index: number) => void | Promise<void>;
  } = {},
): Promise<GrokMultimodeResult> {
  const model = options.model || (ctx.config as any).grokProvider?.defaultImageModel || "grok-imagine-image";
  const maxImages = Math.min(8, Math.max(1, options.maxImages || 4));
  const references = options.references || [];
  const images: Array<{ b64: string; revisedPrompt?: string; mime?: string }> = [];
  let totalCost = 0;
  let totalWebSearchCalls = 0;

  logEvent("grok", "multimode:start", { requestId: options.requestId, model, maxImages, refs: references.length });

  for (let i = 0; i < maxImages; i++) {
    if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");

    const indexedPrompt = maxImages > 1 ? `[Image ${i + 1} of ${maxImages}] ${prompt}` : prompt;
    const plan = await planGrokImage(indexedPrompt, ctx, {
      model,
      size: options.size,
      signal: options.signal,
      requestId: options.requestId,
      references,
    });
    totalWebSearchCalls += plan.webSearchCalls;
    const endpoint = references.length > 0 ? "/v1/images/edits" : "/v1/images/generations";
    const payload = references.length > 0
      ? imageEditPayload(model, plan.prompt, references, options.size)
      : imagePayload(model, plan.prompt, options.size);

    try {
      logEvent("grok", "multimode:item-start", {
        requestId: options.requestId,
        index: i,
        endpoint,
        refs: references.length,
        promptChars: plan.prompt.length,
      });
      const result = await postGrokImages(ctx, payload, options.signal, endpoint);
      if (result.data?.[0]?.b64_json) {
        const img = { b64: result.data[0].b64_json, mime: result.data[0].mime_type, revisedPrompt: plan.prompt };
        images.push(img);
        if (result.usage?.cost_in_usd_ticks) totalCost += result.usage.cost_in_usd_ticks;
        await options.onFinalImage?.(img, i);
      }
    } catch (e: any) {
      if (e.code === "GENERATION_CANCELED") throw e;
      logEvent("grok", "multimode:item-error", { requestId: options.requestId, index: i, error: errInfo(e) });
    }
  }

  logEvent("grok", "multimode:done", { requestId: options.requestId, model, returned: images.length, requested: maxImages, refs: references.length });

  const usage = totalCost > 0 ? { grok_cost_usd_ticks: totalCost } : null;
  return { images, usage, webSearchCalls: totalWebSearchCalls, extraIgnored: 0 };
}
