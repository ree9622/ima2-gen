import { logEvent } from "./logger.js";
import { errInfo } from "./errInfo.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";

interface GrokImageResponse {
  data: Array<{
    b64_json?: string;
    url?: string;
    mime_type?: string;
  }>;
  usage?: { cost_in_usd_ticks?: number };
}

export interface GrokGenerateResult {
  b64: string;
  revisedPrompt?: string;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  mime?: string;
}

export interface GrokMultimodeResult {
  images: Array<{ b64: string; revisedPrompt?: string }>;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  extraIgnored: number;
}

function getGrokEndpoint(ctx: RouteRuntimeContext): { url: string; headers: Record<string, string> } {
  const grokCfg = (ctx.config as any).grokProvider || {};
  const host = grokCfg.proxyHost || "127.0.0.1";
  const port = grokCfg.proxyPort || 18645;
  return {
    url: `http://${host}:${port}/v1/images/generations`,
    headers: { "Content-Type": "application/json", Authorization: "Bearer dummy" },
  };
}

function getGrokTimeout(ctx: RouteRuntimeContext): number {
  return (ctx.config as any).grokProvider?.generationTimeoutMs || 120_000;
}

function grokError(message: string, status: number, code: string): Error {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function postGrokImages(
  ctx: RouteRuntimeContext,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GrokImageResponse> {
  const { url, headers } = getGrokEndpoint(ctx);
  const timeoutMs = getGrokTimeout(ctx);

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: combinedSignal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      const msg = parsed?.error || text || `HTTP ${res.status}`;

      if (res.status === 429) throw grokError(`Grok rate limited: ${msg}`, 429, "GROK_RATE_LIMITED");
      if (res.status === 401 || res.status === 403) throw grokError(`Grok auth failed: ${msg}`, 502, "GROK_AUTH_FAILED");
      if (res.status >= 500) throw grokError(`Grok upstream error: ${msg}`, 502, "GROK_UPSTREAM_ERROR");
      throw grokError(`Grok bad request: ${msg}`, res.status, "GROK_BAD_REQUEST");
    }

    return await res.json() as GrokImageResponse;
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      if (signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");
      throw grokError("Grok image generation timed out", 504, "GENERATION_TIMEOUT");
    }
    if (e.code && e.status) throw e;
    throw grokError(`Grok request failed: ${e.message}`, 502, "GROK_NETWORK_FAILED");
  }
}

export async function generateViaGrok(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: { model?: string; signal?: AbortSignal; requestId?: string } = {},
): Promise<GrokGenerateResult> {
  const model = options.model || (ctx.config as any).grokProvider?.defaultImageModel || "grok-imagine-image";
  const payload: Record<string, unknown> = { model, prompt, n: 1, response_format: "b64_json" };

  logEvent("grok", "generate:start", { requestId: options.requestId, model, promptChars: prompt.length });
  const result = await postGrokImages(ctx, payload, options.signal);

  if (!result.data?.[0]?.b64_json) {
    throw grokError("Grok returned empty image data", 502, "GROK_EMPTY_RESPONSE");
  }

  const usage = result.usage ? { grok_cost_usd_ticks: result.usage.cost_in_usd_ticks ?? 0 } : null;
  logEvent("grok", "generate:done", { requestId: options.requestId, model, b64Len: result.data[0].b64_json.length });

  return { b64: result.data[0].b64_json, usage, webSearchCalls: 0, mime: result.data[0].mime_type };
}

export async function editViaGrok(
  prompt: string,
  imageB64: string,
  ctx: RouteRuntimeContext,
  options: { model?: string; signal?: AbortSignal; requestId?: string } = {},
): Promise<GrokGenerateResult> {
  const model = options.model || (ctx.config as any).grokProvider?.defaultImageModel || "grok-imagine-image";
  const imageUrl = imageB64.startsWith("data:") ? imageB64 : `data:image/jpeg;base64,${imageB64}`;

  const payload: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    response_format: "b64_json",
    image: { url: imageUrl },
  };

  logEvent("grok", "edit:start", { requestId: options.requestId, model, promptChars: prompt.length });
  const result = await postGrokImages(ctx, payload, options.signal);

  if (!result.data?.[0]?.b64_json) {
    throw grokError("Grok edit returned empty image data", 502, "GROK_EMPTY_RESPONSE");
  }

  const usage = result.usage ? { grok_cost_usd_ticks: result.usage.cost_in_usd_ticks ?? 0 } : null;
  logEvent("grok", "edit:done", { requestId: options.requestId, model, b64Len: result.data[0].b64_json.length });

  return { b64: result.data[0].b64_json, usage, webSearchCalls: 0, mime: result.data[0].mime_type };
}

export async function generateMultimodeViaGrok(
  prompt: string,
  ctx: RouteRuntimeContext,
  options: {
    model?: string;
    maxImages?: number;
    signal?: AbortSignal;
    requestId?: string;
    onFinalImage?: (image: { b64: string; revisedPrompt?: string }, index: number) => void | Promise<void>;
  } = {},
): Promise<GrokMultimodeResult> {
  const model = options.model || (ctx.config as any).grokProvider?.defaultImageModel || "grok-imagine-image";
  const maxImages = Math.min(8, Math.max(1, options.maxImages || 4));
  const images: Array<{ b64: string; revisedPrompt?: string }> = [];
  let totalCost = 0;

  logEvent("grok", "multimode:start", { requestId: options.requestId, model, maxImages });

  for (let i = 0; i < maxImages; i++) {
    if (options.signal?.aborted) throw grokError("Generation canceled", 499, "GENERATION_CANCELED");

    const indexedPrompt = maxImages > 1 ? `[Image ${i + 1} of ${maxImages}] ${prompt}` : prompt;
    const payload: Record<string, unknown> = { model, prompt: indexedPrompt, n: 1, response_format: "b64_json" };

    try {
      const result = await postGrokImages(ctx, payload, options.signal);
      if (result.data?.[0]?.b64_json) {
        const img = { b64: result.data[0].b64_json };
        images.push(img);
        if (result.usage?.cost_in_usd_ticks) totalCost += result.usage.cost_in_usd_ticks;
        await options.onFinalImage?.(img, i);
      }
    } catch (e: any) {
      if (e.code === "GENERATION_CANCELED") throw e;
      logEvent("grok", "multimode:item-error", { requestId: options.requestId, index: i, error: errInfo(e) });
    }
  }

  logEvent("grok", "multimode:done", { requestId: options.requestId, model, returned: images.length, requested: maxImages });

  const usage = totalCost > 0 ? { grok_cost_usd_ticks: totalCost } : null;
  return { images, usage, webSearchCalls: 0, extraIgnored: 0 };
}
