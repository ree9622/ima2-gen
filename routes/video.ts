import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import type { Express, Request, Response } from "express";
import { startJob, finishJob, registerJobAbortController, isJobCanceled, setJobPhase } from "../lib/inflight.js";
import { isGenerationCanceledError, makeGenerationCanceledError } from "../lib/generationCancel.js";
import { logEvent, logError } from "../lib/logger.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { generateVideoViaGrok, type GrokVideoEvent } from "../lib/grokVideoAdapter.js";
import { getVideoSeriesChain } from "../lib/videoSeriesChain.js";
import {
  ACTIVE_VIDEO_PROMPT_GUIDANCE,
  appendVideoContinuityEntry,
  lineageFromVideoMetadata,
  normalizeVideoContinuityLineage,
  readVideoSidecar,
  requireActiveVideoPrompt,
  safeGeneratedVideoFilename,
  type VideoContinuityLineage,
} from "../lib/videoContinuity.js";
import { extractGeneratedVideoFrameB64 } from "../lib/videoFrameExtract.js";
import {
  normalizeGrokVideoModel,
  normalizeVideoResolution,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
  deriveVideoMode,
  clampVideoDuration,
  MAX_REF2V_REFERENCES,
  type VideoMode,
} from "../lib/imageModels.js";
import { errInfo } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";

function sendSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

type NormalizeError = { error: string; code: string; status: number };

function isNormalizeError(x: unknown): x is NormalizeError {
  return typeof x === "object" && x !== null && typeof (x as { error?: unknown }).error === "string";
}

export async function saveGeneratedVideoArtifact(ctx: RuntimeContext, filename: string, buffer: Buffer, metadata: unknown): Promise<void> {
  const filePath = join(ctx.config.storage.generatedDir, filename);
  await writeFile(filePath, buffer);
  try {
    await writeFile(`${filePath}.json`, JSON.stringify(metadata));
  } catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
}

async function resolveSourceImage(
  ctx: RuntimeContext,
  sourceImage: unknown,
  sourceFilename: unknown,
): Promise<{ b64: string | null; filename: string | null }> {
  if (typeof sourceFilename === "string" && sourceFilename) {
    const safe = sourceFilename.replace(/^\/+/, "");
    if (safe.includes("..")) throw { status: 400, code: "GROK_VIDEO_INVALID_MODE", message: "invalid source filename" };
    if (/\.mp4$/i.test(safe)) throw { status: 400, code: "GROK_VIDEO_INVALID_MODE", message: "use continueFromVideo for generated video continuation" };
    const buf = await readFile(join(ctx.config.storage.generatedDir, safe));
    return { b64: buf.toString("base64"), filename: safe };
  }
  if (typeof sourceImage === "string" && sourceImage) {
    return { b64: sourceImage, filename: null };
  }
  return { b64: null, filename: null };
}

export function registerVideoRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  app.post("/api/video/generate", async (req: Request, res: Response) => {
    const requestId =
      typeof req.body?.requestId === "string"
        ? req.body.requestId
        : typeof req.body?.clientRequestId === "string"
          ? req.body.clientRequestId
          : req.id;
    let finishStatus = "completed";
    let finishHttpStatus = 200;
    let finishErrorCode: string | undefined;
    let finishMeta: Record<string, unknown> = {};
    let finishCanceled = false;
    const cancelController = new AbortController();

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const fail = (status: number | undefined, code: string, error: string, extra: Record<string, unknown> = {}) => {
      const httpStatus = status ?? 500;
      finishStatus = "error";
      finishHttpStatus = httpStatus;
      finishErrorCode = code;
      sendSse(res, "error", { error, code, status: httpStatus, requestId, ...extra });
    };

    try {
      const { prompt, provider = "grok", model: rawModel } = req.body || {};
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const clientNodeId = typeof req.body?.clientNodeId === "string" ? req.body.clientNodeId : null;
      const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";

      if (provider !== "grok") return fail(400, "VIDEO_PROVIDER_UNSUPPORTED", "video generation requires provider 'grok'");
      const activePrompt = requireActiveVideoPrompt(prompt);
      if (!activePrompt) return fail(400, "PROMPT_REQUIRED", "Prompt is required", { guidance: ACTIVE_VIDEO_PROMPT_GUIDANCE });

      const modelCheck = normalizeGrokVideoModel(rawModel);
      if (isNormalizeError(modelCheck)) return fail(modelCheck.status, modelCheck.code, modelCheck.error);
      const durationCheck = normalizeVideoDuration(req.body?.duration);
      if (isNormalizeError(durationCheck)) return fail(durationCheck.status, durationCheck.code, durationCheck.error);
      const resolutionCheck = normalizeVideoResolution(req.body?.resolution);
      if (isNormalizeError(resolutionCheck)) return fail(resolutionCheck.status, resolutionCheck.code, resolutionCheck.error);
      const aspectCheck = normalizeVideoAspectRatio(req.body?.aspectRatio);
      if (isNormalizeError(aspectCheck)) return fail(aspectCheck.status, aspectCheck.code, aspectCheck.error);

      // Resolve reference inputs: base64 list + existing-file list + legacy single source.
      let parentLineage: VideoContinuityLineage | null = null;
      let continueFromVideoFilename: string | null = null;
      if (typeof req.body?.continueFromVideo === "string" && req.body.continueFromVideo.trim()) {
        try {
          continueFromVideoFilename = safeGeneratedVideoFilename(req.body.continueFromVideo);
          const parentMeta = await readVideoSidecar(ctx.config.storage.generatedDir, continueFromVideoFilename);
          parentLineage = lineageFromVideoMetadata(continueFromVideoFilename, parentMeta);
        } catch (e: any) {
          return fail(e?.status || 400, "GROK_VIDEO_INVALID_MODE", e?.message || "invalid continuation video");
        }
      } else {
        parentLineage = normalizeVideoContinuityLineage(req.body?.continuityLineage);
      }

      const refInputs: Array<{ image?: unknown; filename?: unknown }> = [
        ...toArray(req.body?.referenceImages).map((image) => ({ image })),
        ...toArray(req.body?.referenceFilenames).map((filename) => ({ filename })),
        ...(req.body?.sourceImage || req.body?.sourceFilename
          ? [{ image: req.body?.sourceImage, filename: req.body?.sourceFilename }]
          : []),
      ];
      if (continueFromVideoFilename && !req.body?.sourceImage && !req.body?.sourceFilename) {
        try {
          refInputs.push({ image: await extractGeneratedVideoFrameB64(ctx.config.storage.generatedDir, continueFromVideoFilename) });
        } catch (e: any) {
          return fail(e?.status || 500, "GROK_VIDEO_FRAME_FAILED", e?.message || "failed to extract continuation frame");
        }
      }
      let resolved: Array<{ b64: string; filename: string | null }>;
      try {
        const all = await Promise.all(refInputs.map((r) => resolveSourceImage(ctx, r.image, r.filename)));
        resolved = all.filter((r): r is { b64: string; filename: string | null } => Boolean(r.b64));
      } catch (e: any) {
        return fail(e?.status || 400, e?.code || "GROK_VIDEO_INVALID_MODE", e?.message || "invalid reference image");
      }
      if (resolved.length > MAX_REF2V_REFERENCES) return fail(400, "GROK_VIDEO_REF_TOO_MANY", `at most ${MAX_REF2V_REFERENCES} reference images`);
      const mode: VideoMode = deriveVideoMode(resolved.length);
      const duration = clampVideoDuration(durationCheck.duration, mode);
      const referenceImages = mode === "reference-to-video" ? resolved.map((r) => r.b64) : undefined;
      const sourceB64 = mode === "image-to-video" ? resolved[0]?.b64 : undefined;
      const sourceFilename = resolved[0]?.filename ?? null;

      startJob({
        requestId,
        kind: "video",
        prompt: activePrompt,
        meta: { kind: "video", sessionId, clientNodeId, model: modelCheck.model, mode, duration, resolution: resolutionCheck.resolution },
      });
      registerJobAbortController(requestId, cancelController);
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });

      logEvent("video", "request", { requestId, mode, duration, resolution: resolutionCheck.resolution, aspectRatio: aspectCheck.aspectRatio });
      const startTime = Date.now();

      const onEvent = (ev: GrokVideoEvent) => {
        if (ev.phase === "submitted") {
          setJobPhase(requestId, "streaming");
          sendSse(res, "submitted", {
            requestId,
            xaiVideoRequestId: ev.xaiVideoRequestId,
            requestedModel: ev.requestedModel,
            effectiveModel: ev.effectiveModel,
            modelFallback: ev.modelFallback ?? null,
          });
        } else if (ev.phase === "progress") {
          sendSse(res, "progress", { requestId, progress: typeof ev.progress === "number" ? ev.progress / 100 : null, stalled: Boolean(ev.stalled) });
        } else {
          setJobPhase(requestId, "planning");
          sendSse(res, "planning", { requestId });
        }
      };

      // Build prompt with series chain context
      const chain = !parentLineage && topic ? await getVideoSeriesChain(ctx.config.storage.generatedDir, topic) : [];
      const effectivePrompt = chain.length > 0
        ? `[Series topic: ${topic}]\n[Previous prompts in series:\n${chain.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n]\n\n${activePrompt}`
        : activePrompt;

      const result = await generateVideoViaGrok(effectivePrompt, ctx, {
        model: modelCheck.model,
        mode,
        duration,
        resolution: resolutionCheck.resolution,
        aspectRatio: aspectCheck.aspectRatio,
        sourceImage: sourceB64,
        referenceImages,
        signal: cancelController.signal,
        requestId,
        continuityLineage: parentLineage,
        onEvent,
      });

      const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
      const filename = `${Date.now()}_${rand}.mp4`;
      const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
      const videoContinuity = appendVideoContinuityEntry(parentLineage, {
        filename,
        userPrompt: activePrompt,
        revisedPrompt: result.revisedPrompt,
        createdAt: Date.now(),
      });
      const meta = {
        kind: "video",
        mediaType: "video",
        requestId,
        sessionId,
        clientNodeId,
        prompt: activePrompt,
        userPrompt: activePrompt,
        revisedPrompt: result.revisedPrompt,
        provider: "grok",
        model: result.effectiveModel,
        requestedModel: result.requestedModel,
        effectiveModel: result.effectiveModel,
        modelFallback: result.modelFallback,
        createdAt: Date.now(),
        elapsed,
        usage: result.usage,
        webSearchCalls: result.webSearchCalls,
        video: {
          duration: result.duration,
          resolution: result.resolution,
          aspectRatio: result.aspectRatio,
          sourceImageFilename: sourceFilename,
          xaiVideoRequestId: result.xaiVideoRequestId,
          requestedModel: result.requestedModel,
          effectiveModel: result.effectiveModel,
          modelFallback: result.modelFallback,
        },
        videoContinuity,
        ...(topic ? { videoSeries: { topic, chainIndex: chain.length } } : {}),
      };
      await saveGeneratedVideoArtifact(ctx, filename, result.videoBuffer, meta);
      invalidateHistoryIndex();

      finishMeta = { filename, xaiVideoRequestId: result.xaiVideoRequestId };
      logEvent("video", "saved", { requestId, filename, bytes: result.videoBuffer.length, elapsedMs: Date.now() - startTime });
      sendSse(res, "done", {
        requestId,
        filename,
        url: `/generated/${encodeURIComponent(filename)}`,
        mediaType: "video",
        revisedPrompt: result.revisedPrompt,
        elapsed,
        usage: result.usage,
        requestedModel: result.requestedModel,
        effectiveModel: result.effectiveModel,
        modelFallback: result.modelFallback,
        video: meta.video,
        videoContinuity,
        ...(meta.videoSeries ? { videoSeries: meta.videoSeries } : {}),
      });
    } catch (e) {
      const err = errInfo(e);
      if (isGenerationCanceledError(err.raw) || isJobCanceled(requestId)) {
        const canceled = makeGenerationCanceledError();
        finishCanceled = true;
        finishHttpStatus = canceled.status;
        finishErrorCode = canceled.code;
        sendSse(res, "error", { error: canceled.message, code: canceled.code, status: canceled.status, requestId });
      } else {
        finishStatus = "error";
        finishHttpStatus = err.status || 500;
        finishErrorCode = err.code || "GROK_VIDEO_FAILED";
        logError("video", "error", err.raw, { requestId, code: finishErrorCode });
        sendSse(res, "error", { error: err.message, code: finishErrorCode, status: finishHttpStatus, requestId });
      }
    } finally {
      finishJob(requestId, { canceled: finishCanceled, status: finishStatus, httpStatus: finishHttpStatus, errorCode: finishErrorCode, meta: finishMeta });
      res.end();
    }
  });
}
