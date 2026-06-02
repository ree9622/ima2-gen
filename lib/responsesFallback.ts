import { logEvent } from "./logger.js";
import type { ParsedResponsesResult } from "./responsesParse.js";
import type { RouteRuntimeContext } from "./runtimeContext.js";
import { imageToolChoice, tools } from "./responsesTools.js";
import { emptyResponseError } from "./responsesErrors.js";
import {
  GENERATE_DEVELOPER_PROMPT,
  GENERATE_NO_SEARCH_DEVELOPER_PROMPT,
  buildUserTextPrompt,
} from "./oauthProxy.js";

type PostResponses = (args: {
  ctx: RouteRuntimeContext;
  provider: string | undefined;
  scope: string;
  payload: unknown;
  requestId?: string | null;
  maxImages?: number;
  signal?: AbortSignal | null;
}) => Promise<ParsedResponsesResult>;

const MAX_RETRIES = 2;

export async function retryPromptOnlyJsonImage({
  postResponses,
  ctx,
  provider,
  prompt,
  mode,
  model,
  quality,
  size,
  moderation,
  requestId,
  signal,
  initial,
  referencesDroppedOnRetry,
  webSearchDroppedOnRetry,
  reasoningEffort,
}: {
  postResponses: PostResponses;
  ctx: RouteRuntimeContext;
  provider: string | undefined;
  prompt: string | undefined;
  mode: string;
  model: string;
  quality?: string;
  size?: string;
  moderation?: string;
  requestId: string | null;
  signal?: AbortSignal | null;
  initial: ParsedResponsesResult;
  referencesDroppedOnRetry: boolean;
  webSearchDroppedOnRetry: boolean;
  reasoningEffort?: string;
}) {
  if (provider === "api") return null;
  const retryKind = "prompt_only_with_developer";
  const retryMeta = {
    retryKind,
    initialEventCount: initial.eventCount,
    initialEventTypes: initial.eventTypes,
    referencesDroppedOnRetry,
    developerPromptDroppedOnRetry: false,
    webSearchDroppedOnRetry,
  };

  const developerPrompt = webSearchDroppedOnRetry
    ? GENERATE_NO_SEARCH_DEVELOPER_PROMPT
    : GENERATE_DEVELOPER_PROMPT;

  let lastRetry: ParsedResponsesResult | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logEvent("oauth", "retry_attempt", { requestId, attempt, maxRetries: MAX_RETRIES, ...retryMeta });
    try {
      lastRetry = await postResponses({
        ctx,
        provider,
        scope: "oauth-fallback",
        requestId,
        maxImages: 1,
        signal,
        payload: {
          model,
          input: [
            { role: "developer", content: developerPrompt },
            { role: "user", content: buildUserTextPrompt(prompt, mode, { webSearchEnabled: false }) },
          ],
          tools: tools(false, { quality, size, moderation }),
          tool_choice: imageToolChoice(true),
          reasoning: { effort: reasoningEffort || "low" },
          stream: false,
        },
      });
    } catch (e) {
      if (attempt === MAX_RETRIES) {
        if (e && typeof e === "object") Object.assign(e, retryMeta);
        throw e;
      }
      logEvent("oauth", "retry_error", { requestId, attempt, error: (e as Error).message, status: (e as any).status, code: (e as any).code });
      continue;
    }
    const image = lastRetry.images[0];
    if (image?.b64) {
      logEvent("oauth", "retry_image", { requestId, retryKind, attempt, imageChars: image.b64.length });
      return { b64: image.b64, usage: lastRetry.usage, webSearchCalls: initial.webSearchCalls, revisedPrompt: image.revisedPrompt, text: lastRetry.text, ...retryMeta };
    }
    logEvent("oauth", "retry_no_image", { requestId, retryKind, attempt, fallbackEventCount: lastRetry.eventCount });
  }

  const diagSource = lastRetry ?? initial;
  throw emptyResponseError("No image data received after retries", diagSource, {
    provider,
    model,
    quality,
    size,
    moderation,
    webSearchEnabled: false,
    refsCount: 0,
    inputImageCount: 0,
    promptChars: typeof prompt === "string" ? prompt.length : 0,
    toolTypes: ["image_generation"],
    toolChoiceKind: "image_generation",
    ...retryMeta,
    fallbackEventCount: diagSource.eventCount,
    fallbackEventTypes: diagSource.eventTypes,
    fallbackImageCallSeen: diagSource.diagnostics.imageCallSeen,
    fallbackImageResultCount: diagSource.diagnostics.imageResultCount,
  });
}
