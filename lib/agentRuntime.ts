import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ulid } from "ulid";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";
import { logEvent } from "./logger.js";
import { detectImageMimeFromB64 } from "./refs.js";
import { resolveProviderOptions } from "./providerOptions.js";
import { generateViaResponses } from "./responsesImageAdapter.js";
import { generateViaGrok, type GrokReferenceImage } from "./grokImageAdapter.js";
import {
  appendAgentTurn,
  buildImageContextManifest,
  getAgentImages,
  getAgentSession,
  importAgentImage,
  recordAgentWebFinding,
  restartAgentRuntimeSession,
} from "./agentStore.js";
import {
  AGENT_ALLOWED_TOOLS,
  type AgentGenerationPlan,
  type AgentToolCallSummary,
  type AgentToolName,
} from "./agentTypes.js";
import { errInfo } from "./errInfo.js";
import { type RuntimeContext } from "./runtimeContext.js";

type AgentRunOptions = {
  provider?: string;
  quality?: string;
  size?: string;
  format?: string;
  moderation?: string;
  model?: string;
  reasoningEffort?: string;
  requestId?: string;
  webSearchEnabled?: boolean;
  parallelism?: number;
  signal?: AbortSignal | null;
};

export function assertAgentAllowedTools(tools: readonly string[]) {
  const allowed = new Set<string>(AGENT_ALLOWED_TOOLS);
  const denied = tools.filter((tool) => !allowed.has(tool));
  if (denied.length > 0) {
    const err = new Error(`Agent tool is not allowed: ${denied.join(", ")}`) as Error & {
      code?: string;
      status?: number;
      deniedTools?: string[];
    };
    err.code = "AGENT_TOOL_NOT_ALLOWED";
    err.status = 403;
    err.deniedTools = denied;
    throw err;
  }
}

export function agentAllowedToolPayload() {
  return { tools: [...AGENT_ALLOWED_TOOLS] };
}

export async function runAgentTurn(ctx: RuntimeContext, sessionId: string, prompt: string, options: AgentRunOptions = {}) {
  return runAgentGenerationPlan(
    ctx,
    sessionId,
    prompt,
    {
      mode: "single",
      prompts: [prompt],
      requestedVariants: 1,
      plannedVariants: 1,
      plannedParallelism: cleanParallelism(options.parallelism),
      source: "auto-default",
      reason: "Direct turn endpoint defaults to one image.",
      command: null,
      assistantText: null,
    },
    options,
    { appendUserTurn: true },
  );
}

export async function runAgentGenerationPlan(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  plan: AgentGenerationPlan,
  options: AgentRunOptions = {},
  behavior: { appendUserTurn?: boolean } = {},
) {
  const session = getAgentSession(sessionId);
  if (!session) throw notFound(sessionId);
  const webSearchEnabled = options.provider === "grok" ? true : options.webSearchEnabled ?? session.webSearchEnabled;
  const enabledTools: AgentToolName[] = webSearchEnabled
    ? [...AGENT_ALLOWED_TOOLS]
    : ["ima2.get_image_context", "ima2.generate_image"];
  assertAgentAllowedTools(enabledTools);
  if (behavior.appendUserTurn !== false) {
    appendAgentTurn({ sessionId, role: "user", text: prompt, status: "complete" });
  }
  if (plan.mode === "question") {
    const assistantTurn = appendAgentTurn({
      sessionId,
      role: "assistant",
      text: plan.assistantText || plan.reason || "What would you like to clarify before generating images?",
      imageIds: [],
      webFindingIds: [],
      status: "complete",
    });
    return { assistantTurn, imageIds: [], webFindingIds: [] };
  }
  const manifest = buildImageContextManifest(sessionId);
  const contextStartedAt = Date.now();
  appendAgentTurn({
    sessionId,
    role: "tool",
    text: "ima2.get_image_context",
    status: "complete",
    raw: {
      toolCalls: [{
        id: `tc_context_${ulid()}`,
        name: "ima2.get_image_context",
        status: "complete",
        startedAt: contextStartedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - contextStartedAt,
        outputSummary: "Loaded current image context manifest.",
      } satisfies AgentToolCallSummary],
    },
  });
  const generationPrompts = plan.prompts.length > 0 ? plan.prompts : [prompt];
  const baseRequestId = options.requestId ?? `agent_${ulid()}`;
  const generationResults = await mapWithLimit(generationPrompts, cleanParallelism(plan.plannedParallelism ?? options.parallelism), async (generationPrompt, index) => {
    const requestId = generationPrompts.length > 1 ? `${baseRequestId}_${index + 1}` : baseRequestId;
    const startedAt = Date.now();
    const result = await runGeneratorWithRuntimeRecovery(ctx, sessionId, generationPrompt, manifest, webSearchEnabled, {
      ...options,
      requestId,
    });
    const findingIds = recordSearchFindings(sessionId, generationPrompt, result.webSearchCalls, result.provider ?? "oauth");
    const finishedAt = Date.now();
    return {
      prompt: generationPrompt,
      imageId: result.image.id,
      text: result.text,
      findingIds,
      toolCall: {
        id: `tc_generate_${ulid()}`,
        name: "ima2.generate_image",
        status: "complete",
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        requestId,
        inputSummary: generationPrompt,
        outputSummary: `Generated ${result.image.filename}. ${plan.reason}`,
        imageIds: [result.image.id],
        webFindingIds: findingIds,
      } satisfies AgentToolCallSummary,
    };
  });
  const imageIds = generationResults.map((result) => result.imageId);
  const responseTexts = generationResults
    .map((result) => result.text)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
  const findingIds = generationResults.flatMap((result) => result.findingIds);
  const webToolCall: AgentToolCallSummary | null = webSearchEnabled ? {
    id: `tc_web_${ulid()}`,
    name: "ima2.web_search",
    status: "complete",
    outputSummary: findingIds.length > 0
      ? `Recorded ${findingIds.length} web finding${findingIds.length === 1 ? "" : "s"}.`
      : "Web search enabled; no findings were reported.",
    webFindingIds: findingIds,
  } : null;
  appendAgentTurn({
    sessionId,
    role: "tool",
    text: webSearchEnabled ? "ima2.web_search + ima2.generate_image" : "ima2.generate_image",
    imageIds,
    webFindingIds: findingIds,
    status: "complete",
    raw: {
      toolCalls: [
        ...(webToolCall ? [webToolCall] : []),
        ...generationResults.map((result) => result.toolCall),
      ],
    },
  });
  const assistantTurn = appendAgentTurn({
    sessionId,
    role: "assistant",
    text: formatAgentAssistantText(plan, imageIds.length, responseTexts),
    imageIds,
    webFindingIds: findingIds,
    status: "complete",
  });
  return { assistantTurn, imageIds, webFindingIds: findingIds };
}

function formatAgentAssistantText(plan: AgentGenerationPlan, imageCount: number, responseTexts: readonly string[]): string {
  const countText = imageCount === 1 ? "Generated 1 image artifact." : `Generated ${imageCount} image artifacts.`;
  const modeText = plan.mode === "fanout"
    ? `Fanout used ${plan.plannedParallelism} concurrent tool call${plan.plannedParallelism === 1 ? "" : "s"}.`
    : "Single-image plan completed.";
  const modelText = responseTexts.length > 0 ? `${responseTexts.join("\n\n")}\n\n` : "";
  return `${modelText}${countText} ${modeText} ${plan.reason}`.trim();
}

async function runGeneratorWithRuntimeRecovery(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  manifest: string,
  webSearchEnabled: boolean,
  options: AgentRunOptions,
) {
  try {
    return await generateAgentImageWithRetry(ctx, sessionId, prompt, manifest, webSearchEnabled, options);
  } catch (error) {
    const err = errInfo(error);
    if (isRuntimeRestartableError(error)) {
      restartAgentRuntimeSession(sessionId, err.code || err.message);
    }
    appendAgentTurn({ sessionId, role: "assistant", text: err.message, status: "error" });
    throw error;
  }
}

export function isRuntimeRestartableError(error: unknown) {
  const err = errInfo(error);
  const code = err.code || "";
  return (
    code.includes("AUTH") ||
    code.includes("TIMEOUT") ||
    code.includes("PROTOCOL") ||
    err.message.toLowerCase().includes("protocol wedge")
  );
}

async function generateAgentImageWithRetry(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  manifest: string,
  webSearchEnabled: boolean,
  options: AgentRunOptions,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const forcedPrompt = attempt === 0 ? prompt : forceImagePrompt(prompt);
      const result = await generateAgentImage(ctx, sessionId, forcedPrompt, manifest, webSearchEnabled, options);
      if (result.image) return result;
    } catch (error) {
      lastError = error;
      if (!isTextOnlyResult(error)) throw error;
      if (attempt === 1) break;
      appendAgentTurn({
        sessionId,
        role: "tool",
        text: "ima2.generate_image retry: text-only result rejected",
        status: "error",
      });
    }
  }
  throw textOnlyError(lastError);
}

async function generateAgentImage(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  manifest: string,
  webSearchEnabled: boolean,
  options: AgentRunOptions,
) {
  const requestId = options.requestId ?? `agent_${ulid()}`;
  const providerOptions = resolveProviderOptions(ctx, {
    provider: options.provider ?? "oauth",
    rawModel: options.model,
    rawReasoningEffort: options.reasoningEffort,
    rawSize: options.size ?? "1024x1024",
    rawWebSearchEnabled: webSearchEnabled,
    searchMode: webSearchEnabled ? "on" : "off",
  });
  if (providerOptions.error) {
    const err = new Error(providerOptions.error) as Error & { code?: string; status?: number };
    err.code = providerOptions.code;
    err.status = providerOptions.status;
    throw err;
  }
  const activeProvider = providerOptions.provider;
  const effectiveModel = activeProvider === "grok" && options.quality === "high"
    ? "grok-imagine-image-quality"
    : providerOptions.model;
  const response = activeProvider === "grok"
    ? await generateViaGrok(`${manifest}\n\nUser request:\n${prompt}`, ctx, {
        model: effectiveModel,
        size: providerOptions.size,
        requestId,
        signal: options.signal ?? undefined,
        references: await loadAgentCurrentImageReferences(ctx, sessionId),
      })
    : await generateViaResponses(
        activeProvider,
        `${manifest}\n\nUser request:\n${prompt}`,
        options.quality ?? "medium",
        providerOptions.size,
        options.moderation ?? "low",
        [],
        requestId,
        "auto",
        ctx,
        {
          model: providerOptions.model,
          reasoningEffort: providerOptions.reasoningEffort,
          webSearchEnabled,
          signal: options.signal,
        },
      );
  const format = activeProvider === "grok"
    ? imageFormatFromMime(("mime" in response ? response.mime : undefined) || detectImageMimeFromB64(response.b64) || "image/jpeg")
    : options.format ?? "png";
  const image = await persistAgentImage(ctx, sessionId, prompt, format, requestId, response, {
    provider: String(activeProvider),
    model: String(effectiveModel),
  });
  const responseText = "text" in response && typeof response.text === "string" ? response.text : null;
  return { image, webSearchCalls: response.webSearchCalls || 0, text: responseText, provider: activeProvider };
}

async function loadAgentCurrentImageReferences(ctx: RuntimeContext, sessionId: string): Promise<GrokReferenceImage[]> {
  const session = getAgentSession(sessionId);
  const currentImage = session?.lastImageId
    ? getAgentImages(sessionId).find((image) => image.id === session.lastImageId)
    : null;
  if (!currentImage?.filename) return [];
  try {
    const b64 = (await readFile(join(ctx.config.storage.generatedDir, currentImage.filename))).toString("base64");
    const mime = detectImageMimeFromB64(b64);
    return [{ b64, declaredMime: mime, detectedMime: mime }];
  } catch (error) {
    const err = errInfo(error);
    logEvent("agent", "grok_ref_missing", { sessionId, filename: currentImage.filename, code: err.code, message: err.message });
    return [];
  }
}

function imageFormatFromMime(mime: string | null | undefined): "png" | "jpeg" | "webp" {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function persistAgentImage(
  ctx: RuntimeContext,
  sessionId: string,
  prompt: string,
  format: string,
  requestId: string,
  response: { b64: string; revisedPrompt?: string | null; usage?: unknown; webSearchCalls?: number },
  generation: { provider: string; model: string },
) {
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
  const filename = `${Date.now()}_${rand}_agent.${format}`;
  const meta = {
    kind: "agent",
    requestId,
    sessionId,
    prompt,
    userPrompt: prompt,
    revisedPrompt: response.revisedPrompt ?? null,
    provider: generation.provider,
    model: generation.model,
    createdAt: Date.now(),
    usage: response.usage ?? null,
    webSearchCalls: response.webSearchCalls ?? 0,
  };
  const embedded = await embedImageMetadataBestEffort(Buffer.from(response.b64, "base64"), format, meta, {
    version: ctx.packageVersion,
  });
  await writeFile(join(ctx.config.storage.generatedDir, filename), embedded.buffer);
  await writeFile(join(ctx.config.storage.generatedDir, `${filename}.json`), JSON.stringify(meta)).catch(() => {});
  invalidateHistoryIndex();
  logEvent("agent", "saved", { requestId, sessionId, filename });
  return importAgentImage(sessionId, {
    id: `ai_${ulid()}`,
    filename,
    url: `/generated/${filename}`,
    prompt,
    revisedPrompt: response.revisedPrompt ?? null,
    createdAt: Date.now(),
  });
}

function recordSearchFindings(sessionId: string, prompt: string, count: number, provider: string) {
  if (!count) return [];
  const isGrok = provider === "grok";
  return [
    recordAgentWebFinding({
      sessionId,
      query: prompt,
      title: isGrok ? "Grok visual research" : "Responses web_search",
      snippet: `${isGrok ? "Grok" : "Responses"} reported ${count} web search call${count === 1 ? "" : "s"}.`,
    }),
  ];
}

function forceImagePrompt(prompt: string) {
  return [
    "The previous turn did not return an image artifact.",
    "Return a final image using ima2.generate_image/image_generation now.",
    `User request: ${prompt}`,
  ].join("\n");
}

function isTextOnlyResult(error: unknown) {
  const err = errInfo(error);
  return [
    "EMPTY_RESPONSE",
    "IMAGE_TOOL_NOT_CALLED",
    "WEB_SEARCH_ONLY_RESPONSE",
    "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT",
  ].includes(err.code || "") || err.message.includes("No image data");
}

function textOnlyError(cause: unknown) {
  const err = new Error("Agent result did not include an image artifact.") as Error & {
    code?: string;
    status?: number;
    cause?: unknown;
  };
  err.code = "AGENT_TEXT_ONLY_RESULT";
  err.status = 422;
  err.cause = cause;
  return err;
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));
  return results;
}

function cleanParallelism(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.max(1, Math.min(8, Math.round(numeric)));
}

function notFound(sessionId: string) {
  const err = new Error(`Agent session not found: ${sessionId}`) as Error & { code?: string; status?: number };
  err.code = "AGENT_SESSION_NOT_FOUND";
  err.status = 404;
  return err;
}
