import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import type { Express, Request, Response } from "express";
import { startJob, finishJob, registerJobAbortController, isJobCanceled } from "../lib/inflight.js";
import { isGenerationCanceledError, makeGenerationCanceledError } from "../lib/generationCancel.js";
import { logEvent, logError } from "../lib/logger.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { generateVideoViaGrok, type GrokVideoEvent } from "../lib/grokVideoAdapter.js";
import {
  normalizeGrokVideoModel,
  normalizeVideoResolution,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
  type VideoMode,
} from "../lib/imageModels.js";
import { errInfo } from "../lib/errInfo.js";
import { requireRuntimeContext, type RouteRuntimeContext, type RuntimeContext } from "../lib/runtimeContext.js";

function sendSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

type NormalizeError = { error: string; code: string; status: number };

function isNormalizeError(x: unknown): x is NormalizeError {
  return typeof x === "object" && x !== null && typeof (x as { error?: unknown }).error === "string";
}

async function resolveSourceImage(
  ctx: RuntimeContext,
  sourceImage: unknown,
  sourceFilename: unknown,
): Promise<{ b64: string | null; filename: string | null }> {
  if (typeof sourceFilename === "string" && sourceFilename) {
    const safe = sourceFilename.replace(/^\/+/, "");
    if (safe.includes("..")) throw { status: 400, code: "GROK_VIDEO_INVALID_MODE", message: "invalid source filename" };
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

    const fail = (status: number | undefined, code: string, error: string) => {
      const httpStatus = status ?? 500;
      finishStatus = "error";
      finishHttpStatus = httpStatus;
      finishErrorCode = code;
      sendSse(res, "error", { error, code, status: httpStatus, requestId });
    };

    try {
      const { prompt, provider = "grok", model: rawModel, mode: rawMode } = req.body || {};
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
      const clientNodeId = typeof req.body?.clientNodeId === "string" ? req.body.clientNodeId : null;

      if (provider !== "grok") return fail(400, "VIDEO_PROVIDER_UNSUPPORTED", "video generation requires provider 'grok'");
      if (typeof prompt !== "string" || !prompt.trim()) return fail(400, "PROMPT_REQUIRED", "Prompt is required");

      const modelCheck = normalizeGrokVideoModel(rawModel);
      if (isNormalizeError(modelCheck)) return fail(modelCheck.status, modelCheck.code, modelCheck.error);
      const durationCheck = normalizeVideoDuration(req.body?.duration);
      if (isNormalizeError(durationCheck)) return fail(durationCheck.status, durationCheck.code, durationCheck.error);
      const resolutionCheck = normalizeVideoResolution(req.body?.resolution);
      if (isNormalizeError(resolutionCheck)) return fail(resolutionCheck.status, resolutionCheck.code, resolutionCheck.error);
      const aspectCheck = normalizeVideoAspectRatio(req.body?.aspectRatio);
      if (isNormalizeError(aspectCheck)) return fail(aspectCheck.status, aspectCheck.code, aspectCheck.error);

      let source: { b64: string | null; filename: string | null };
      try {
        source = await resolveSourceImage(ctx, req.body?.sourceImage, req.body?.sourceFilename);
      } catch (e: any) {
        return fail(e?.status || 400, e?.code || "GROK_VIDEO_INVALID_MODE", e?.message || "invalid source image");
      }
      const mode: VideoMode = rawMode === "text-to-video" || rawMode === "image-to-video"
        ? rawMode
        : source.b64
          ? "image-to-video"
          : "text-to-video";
      if (mode === "image-to-video" && !source.b64) return fail(400, "GROK_VIDEO_INVALID_MODE", "image-to-video requires a source image");

      startJob({
        requestId,
        kind: "video",
        prompt,
        meta: { kind: "video", sessionId, clientNodeId, model: modelCheck.model, mode, duration: durationCheck.duration, resolution: resolutionCheck.resolution },
      });
      registerJobAbortController(requestId, cancelController);
      await mkdir(ctx.config.storage.generatedDir, { recursive: true });

      logEvent("video", "request", { requestId, mode, duration: durationCheck.duration, resolution: resolutionCheck.resolution, aspectRatio: aspectCheck.aspectRatio });
      const startTime = Date.now();

      const onEvent = (ev: GrokVideoEvent) => {
        if (ev.phase === "submitted") sendSse(res, "submitted", { requestId, xaiVideoRequestId: ev.xaiVideoRequestId });
        else if (ev.phase === "progress") sendSse(res, "progress", { requestId, progress: ev.progress ?? null, stalled: Boolean(ev.stalled) });
        else sendSse(res, "planning", { requestId });
      };

      const result = await generateVideoViaGrok(prompt, ctx, {
        model: modelCheck.model,
        mode,
        duration: durationCheck.duration,
        resolution: resolutionCheck.resolution,
        aspectRatio: aspectCheck.aspectRatio,
        sourceImage: source.b64 || undefined,
        signal: cancelController.signal,
        requestId,
        onEvent,
      });

      const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
      const filename = `${Date.now()}_${rand}.mp4`;
      const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
      const meta = {
        kind: "video",
        mediaType: "video",
        requestId,
        sessionId,
        clientNodeId,
        prompt,
        userPrompt: prompt,
        revisedPrompt: result.revisedPrompt,
        provider: "grok",
        model: modelCheck.model,
        createdAt: Date.now(),
        elapsed,
        usage: result.usage,
        webSearchCalls: result.webSearchCalls,
        video: {
          duration: result.duration,
          resolution: result.resolution,
          aspectRatio: result.aspectRatio,
          sourceImageFilename: source.filename,
          xaiVideoRequestId: result.xaiVideoRequestId,
        },
      };
      await writeFile(join(ctx.config.storage.generatedDir, filename), result.videoBuffer);
      await writeFile(join(ctx.config.storage.generatedDir, filename + ".json"), JSON.stringify(meta)).catch(() => {});
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
        video: meta.video,
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
