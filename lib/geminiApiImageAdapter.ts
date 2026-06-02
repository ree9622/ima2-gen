import { logEvent } from "./logger.js";
import type { RuntimeContext } from "./runtimeContext.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { getVertexAccessToken, getVertexProjectId, isVertexInitialized } from "./vertexAuth.js";

export interface GeminiApiGenerateResult {
  b64: string;
  revisedPrompt?: string;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  mime?: string;
}

interface GeminiApiRefDetail {
  b64: string;
  declaredMime?: string | null;
  detectedMime?: string | null;
}

const MODEL_ID_MAP: Record<string, string> = {
  "nano-banana-2": "gemini-3.1-flash-image",
  "nano-banana-pro": "gemini-3-pro-image",
};

const GEMINI_TIMEOUT_MS = 120_000;

function parseGeminiImageParams(size?: string): { aspectRatio: number; imageSize: number } {
  if (!size || size === "auto" || size === "1024x1024") return { aspectRatio: 1, imageSize: 0 };
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return { aspectRatio: 1, imageSize: 0 };
  const w = Number(match[1]);
  const h = Number(match[2]);
  const ratio = w / h;
  const ratioMap: Array<[number, number]> = [
    [1, 1], [2, 2/3], [3, 3/2], [4, 3/4], [5, 4/3],
    [6, 4/5], [7, 5/4], [8, 9/16], [9, 16/9], [10, 21/9],
    [11, 1/8], [12, 8], [13, 1/4], [14, 4],
  ];
  let bestEnum = 1;
  let bestDist = Infinity;
  for (const [enumVal, val] of ratioMap) {
    const dist = Math.abs(ratio - val);
    if (dist < bestDist) { bestDist = dist; bestEnum = enumVal; }
  }
  const maxDim = Math.max(w, h);
  const imageSize = maxDim <= 512 ? 1 : maxDim <= 1024 ? 2 : maxDim <= 2048 ? 3 : 4;
  return { aspectRatio: bestEnum, imageSize };
}

function geminiApiError(message: string, status: number, code: string): Error {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function resolveGeminiModelId(model: string): string {
  return MODEL_ID_MAP[model] || model;
}

function buildContents(
  prompt: string,
  references: GeminiApiRefDetail[],
): Array<{ parts: unknown[] }> {
  const parts: unknown[] = [];

  // Add reference images first (if any)
  for (const ref of references.slice(0, 3)) {
    const mime = ref.declaredMime || ref.detectedMime || detectImageMimeFromB64(ref.b64) || "image/png";
    parts.push({
      inlineData: {
        mimeType: mime,
        data: ref.b64,
      },
    });
  }

  // Add text prompt
  parts.push({ text: prompt });

  return [{ parts }];
}

export async function generateViaGeminiApi(
  prompt: string,
  ctx: RuntimeContext,
  options: {
    model?: string;
    size?: string;
    signal?: AbortSignal;
    requestId?: string;
    references?: GeminiApiRefDetail[];
  } = {},
): Promise<GeminiApiGenerateResult> {
  const apiKey = ctx.geminiApiKey;
  const useVertex = !apiKey && ctx.hasVertexKey && isVertexInitialized();
  if (!apiKey && !useVertex) {
    throw geminiApiError("Gemini API key or Vertex AI credentials not configured", 401, "GEMINI_API_KEY_MISSING");
  }

  const model = options.model || "nano-banana-2";
  const apiModelId = resolveGeminiModelId(model);
  const references = (options.references || []).slice(0, 3);

  let url: string;
  let authHeaders: Record<string, string>;

  if (useVertex) {
    const token = await getVertexAccessToken();
    const projectId = getVertexProjectId();
    url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${apiModelId}:generateContent`;
    authHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:generateContent?key=${apiKey}`;
    authHeaders = { "Content-Type": "application/json" };
  }

  const imageParams = parseGeminiImageParams(options.size);
  const body = {
    contents: buildContents(prompt, references),
    generation_config: {
      response_modalities: ["TEXT", "IMAGE"],
      response_format: {
        image: {
          aspect_ratio: imageParams.aspectRatio,
          image_size: imageParams.imageSize,
        },
      },
    },
  };

  logEvent("gemini-api", "generate:start", {
    requestId: options.requestId,
    model,
    apiModelId,
    promptChars: prompt.length,
    refs: references.length,
  });

  const timeoutSignal = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        throw geminiApiError(`Gemini API rate limited: ${text.slice(0, 200)}`, 429, "GEMINI_API_RATE_LIMITED");
      }
      if (res.status === 400 || res.status === 403) {
        throw geminiApiError(`Gemini API error: ${text.slice(0, 200)}`, res.status, "GEMINI_API_BAD_REQUEST");
      }
      throw geminiApiError(`Gemini API error (${res.status}): ${text.slice(0, 200)}`, 502, "GEMINI_API_UPSTREAM_ERROR");
    }

    const json = await res.json() as any;

    // Extract image from candidates[0].content.parts[]
    const parts = json?.candidates?.[0]?.content?.parts || [];
    let b64: string | null = null;
    let textResponse = "";
    let mime = "image/png";

    for (const part of parts) {
      if (part.inlineData?.data) {
        b64 = part.inlineData.data;
        mime = part.inlineData.mimeType || "image/png";
      }
      if (part.text) {
        textResponse += part.text;
      }
    }

    if (!b64) {
      // Check for safety block
      const finishReason = json?.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY") {
        throw geminiApiError("Gemini API: generation blocked by safety filter", 400, "GEMINI_API_SAFETY_BLOCKED");
      }
      throw geminiApiError(
        `Gemini API: no image in response (finishReason: ${finishReason || "unknown"})`,
        502,
        "GEMINI_API_NO_IMAGE",
      );
    }

    const usageMetadata = json?.usageMetadata || {};

    logEvent("gemini-api", "generate:done", {
      requestId: options.requestId,
      model,
      b64Len: b64.length,
      mime,
      textResponseLen: textResponse.length,
    });

    return {
      b64,
      revisedPrompt: textResponse || prompt,
      usage: {
        promptTokens: usageMetadata.promptTokenCount || 0,
        candidatesTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      },
      webSearchCalls: 0,
      mime,
    };
  } catch (e: any) {
    if (e.name === "AbortError") {
      if (options.signal?.aborted) {
        throw geminiApiError("Generation canceled", 499, "GENERATION_CANCELED");
      }
      throw geminiApiError("Gemini API generation timed out", 504, "GENERATION_TIMEOUT");
    }
    if (e.code && e.status) throw e;
    throw geminiApiError(`Gemini API request failed: ${e.message}`, 502, "GEMINI_API_NETWORK_FAILED");
  }
}
