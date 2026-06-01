import type { Express, Request, Response } from "express";
import { basename, join } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { RouteRuntimeContext, RuntimeContext } from "../lib/runtimeContext.js";
import { requireRuntimeContext } from "../lib/runtimeContext.js";
import { getGrokProxyUrl } from "../lib/grokRuntime.js";
import { logEvent, logError } from "../lib/logger.js";
import { downloadVideo, pollVideoUntilDone } from "../lib/grokVideoAdapter.js";
import { invalidateHistoryIndex } from "../lib/historyIndex.js";
import { ACTIVE_VIDEO_PROMPT_GUIDANCE, appendVideoContinuityEntry, lineageFromVideoMetadata, readVideoSidecar } from "../lib/videoContinuity.js";
import { assertLocalMp4, extractVideoFrame, safeGeneratedFilePath } from "../lib/videoFrameExtract.js";

function videoProxyUrl(ctx: RuntimeContext, path: string) {
  return { url: getGrokProxyUrl(ctx, path), headers: { "Content-Type": "application/json", Authorization: "Bearer dummy" } };
}

function routeError(message: string, status = 400): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function sendError(res: Response, err: any): void {
  res.status(typeof err?.status === "number" ? err.status : 500).json({ error: err?.message || String(err) });
}

async function safeGeneratedFile(ctx: RuntimeContext, file: string, options: { requireMp4?: boolean } = {}): Promise<string> {
  return safeGeneratedFilePath(ctx.config.storage.generatedDir, file, options);
}

function summarizeSource(input: string): Record<string, unknown> {
  if (input.startsWith("data:video/")) {
    const encoded = input.split(",", 2)[1] || "";
    return { kind: "data-url", approximateBytes: Math.floor(encoded.length * 0.75) };
  }
  if (/^https?:\/\//i.test(input)) {
    try {
      const parsed = new URL(input);
      return { kind: "url", origin: parsed.origin, pathname: basename(parsed.pathname) };
    } catch {
      return { kind: "url" };
    }
  }
  if (/^file[-_][A-Za-z0-9._-]+$/.test(input)) return { kind: "file_id" };
  return { kind: "generated-file", filename: basename(input) };
}

async function resolveVideoInput(ctx: RuntimeContext, input: string): Promise<Record<string, string>> {
  if (/^https?:\/\//i.test(input) || input.startsWith("data:video/")) return { url: input };
  if (/^file[-_][A-Za-z0-9._-]+$/.test(input)) return { file_id: input };
  const inputPath = await safeGeneratedFile(ctx, input, { requireMp4: true });
  await assertLocalMp4(inputPath);
  const buf = await readFile(inputPath);
  return { url: `data:video/mp4;base64,${buf.toString("base64")}` };
}

function validateEditModel(model: unknown): string {
  if (typeof model !== "string") throw routeError("model must be a string", 400);
  if (model !== "grok-imagine-video") throw routeError("Video edit/extension only supports grok-imagine-video", 400);
  return model;
}

async function saveVideoResult(
  ctx: RuntimeContext,
  options: { requestId: string; prompt: string; model: string; operation: "edit" | "extend"; source: string; duration: number | null; videoUrl: string; usage?: Record<string, number> | null; signal?: AbortSignal },
): Promise<{ filename: string; url: string; sourceUrl: string }> {
  const { buffer, contentType } = await downloadVideo(ctx, options.videoUrl, options.signal);
  await mkdir(ctx.config.storage.generatedDir, { recursive: true });
  const rand = randomBytes(ctx.config.ids.generatedHexBytes).toString("hex");
  const filename = `${Date.now()}_${rand}.mp4`;
  const filePath = join(ctx.config.storage.generatedDir, filename);
  const sourceFilename = /^https?:\/\//i.test(options.source) || options.source.startsWith("data:") || /^file[-_]/.test(options.source)
    ? null
    : basename(options.source);
  const sourceMeta = sourceFilename ? await readVideoSidecar(ctx.config.storage.generatedDir, sourceFilename) : null;
  const parentLineage = sourceFilename ? lineageFromVideoMetadata(sourceFilename, sourceMeta) : null;
  const videoContinuity = appendVideoContinuityEntry(parentLineage, {
    filename,
    userPrompt: options.prompt,
    revisedPrompt: options.prompt,
    createdAt: Date.now(),
  });
  await writeFile(filePath, buffer);
  try {
    await writeFile(
      `${filePath}.json`,
      JSON.stringify({
        kind: "video",
        mediaType: "video",
        requestId: options.requestId,
        prompt: options.prompt,
        userPrompt: options.prompt,
        provider: "grok",
        model: options.model,
        createdAt: Date.now(),
        usage: options.usage ?? null,
        revisedPrompt: options.prompt,
        videoContinuity,
        video: {
          operation: options.operation,
          duration: options.duration,
          source: summarizeSource(options.source),
          sourceUrl: summarizeSource(options.videoUrl),
          contentType,
        },
      }),
    );
  } catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
  invalidateHistoryIndex();
  return { filename, url: `/generated/${encodeURIComponent(filename)}`, sourceUrl: options.videoUrl };
}

function requestSignal(req: Request, res: Response): AbortSignal {
  const ac = new AbortController();
  const abort = () => {
    if (!res.writableEnded) ac.abort();
  };
  req.on("aborted", abort);
  res.on("close", abort);
  return ac.signal;
}

function requirePrompt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function extractOutputText(data: Record<string, unknown>): string {
  const output = Array.isArray(data.output) ? data.output : [];
  const texts: string[] = [];
  for (const item of output) {
    const content = (item as any)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") texts.push(part.text);
      if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
    }
  }
  return texts.join("\n").trim();
}

export function registerVideoExtendedRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);

  // --- Video Edit (V2V) ---
  app.post("/api/video/edit", async (req: Request, res: Response) => {
    try {
      const { prompt: rawPrompt, videoUrl, model = "grok-imagine-video" } = req.body ?? {};
      const prompt = requirePrompt(rawPrompt);
      if (!prompt) return res.status(400).json({ error: "prompt required", code: "PROMPT_REQUIRED", guidance: ACTIVE_VIDEO_PROMPT_GUIDANCE });
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      const validModel = validateEditModel(model);
      const signal = requestSignal(req, res);

      const { url, headers } = videoProxyUrl(ctx, "/v1/videos/edits");
      const video = await resolveVideoInput(ctx, videoUrl);
      const apiRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: validModel, prompt, video }), signal });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const { request_id } = (await apiRes.json()) as { request_id: string };
      if (!request_id) return res.status(502).json({ error: "No request_id in response" });
      logEvent("video", "edit:start", { requestId: request_id, model: validModel });

      const result = await pollVideoUntilDone(ctx, request_id, { signal });
      if (result.respectModeration === false) return res.status(502).json({ error: "Grok video blocked by moderation" });
      if (!result.videoUrl) return res.status(502).json({ error: "No video URL in response" });
      const saved = await saveVideoResult(ctx, { requestId: request_id, prompt, model: validModel, operation: "edit", source: videoUrl, duration: result.duration ?? null, videoUrl: result.videoUrl, usage: result.usage, signal });

      logEvent("video", "edit:done", { requestId: request_id });
      res.json({ requestId: request_id, url: saved.url, filename: saved.filename, sourceUrl: saved.sourceUrl, duration: result.duration, model: validModel });
    } catch (err: any) {
      logError("video", "edit:error", err);
      sendError(res, err);
    }
  });

  // --- Video Extension ---
  app.post("/api/video/extend", async (req: Request, res: Response) => {
    try {
      const { prompt: rawPrompt, videoUrl, duration = 6, model = "grok-imagine-video" } = req.body ?? {};
      const prompt = requirePrompt(rawPrompt);
      if (!prompt) return res.status(400).json({ error: "prompt required", code: "PROMPT_REQUIRED", guidance: ACTIVE_VIDEO_PROMPT_GUIDANCE });
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      const validModel = validateEditModel(model);
      const dur = Number(duration);
      if (!Number.isInteger(dur) || dur < 2 || dur > 10) return res.status(400).json({ error: "duration must be an integer between 2 and 10" });
      const signal = requestSignal(req, res);

      const { url, headers } = videoProxyUrl(ctx, "/v1/videos/extensions");
      const video = await resolveVideoInput(ctx, videoUrl);
      const apiRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: validModel, prompt, duration: dur, video }), signal });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const { request_id } = (await apiRes.json()) as { request_id: string };
      if (!request_id) return res.status(502).json({ error: "No request_id in response" });
      logEvent("video", "extend:start", { requestId: request_id, model: validModel, duration: dur });

      const result = await pollVideoUntilDone(ctx, request_id, { signal });
      if (result.respectModeration === false) return res.status(502).json({ error: "Grok video blocked by moderation" });
      if (!result.videoUrl) return res.status(502).json({ error: "No video URL in response" });
      const saved = await saveVideoResult(ctx, { requestId: request_id, prompt, model: validModel, operation: "extend", source: videoUrl, duration: result.duration ?? null, videoUrl: result.videoUrl, usage: result.usage, signal });

      logEvent("video", "extend:done", { requestId: request_id, totalDuration: result.duration });
      res.json({ requestId: request_id, url: saved.url, filename: saved.filename, sourceUrl: saved.sourceUrl, duration: result.duration, model: validModel });
    } catch (err: any) {
      logError("video", "extend:error", err);
      sendError(res, err);
    }
  });

  // --- Video Frame Extraction ---
  app.get("/api/video/frame", async (req: Request, res: Response) => {
    try {
      const file = req.query.file as string | undefined;
      const position = (req.query.position as string) || "last";
      if (!file) return res.status(400).json({ error: "file query param required" });
      const inputPath = await safeGeneratedFile(ctx, file, { requireMp4: true });
      await assertLocalMp4(inputPath);

      const tmpOut = join(ctx.config.storage.generatedDir, `frame_tmp_${randomBytes(4).toString("hex")}.png`);
      try {
        await extractVideoFrame(inputPath, tmpOut, position);
        const frame = await readFile(tmpOut);
        res.type("png").send(frame);
      } catch (err: any) {
        return res.status(500).json({ error: "ffmpeg failed" });
      } finally {
        await unlink(tmpOut).catch(() => {});
      }
    } catch (err: any) {
      logError("video", "frame:error", err);
      sendError(res, err);
    }
  });

  // --- Video Analysis (Grok 4.3 Vision) ---
  app.post("/api/video/analyze", async (req: Request, res: Response) => {
    try {
      const { videoUrl } = req.body ?? {};
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      if (/^https?:\/\//i.test(videoUrl) || videoUrl.startsWith("data:")) {
        return res.status(400).json({ error: "videoUrl must be a generated .mp4 filename" });
      }
      const input = await safeGeneratedFile(ctx, videoUrl, { requireMp4: true });
      await assertLocalMp4(input);
      const firstFrame = join(ctx.config.storage.generatedDir, `analyze_first_${randomBytes(4).toString("hex")}.png`);
      const lastFrame = join(ctx.config.storage.generatedDir, `analyze_last_${randomBytes(4).toString("hex")}.png`);

      try {
        await extractVideoFrame(input, firstFrame, "0");
        await extractVideoFrame(input, lastFrame, "last");
        const first = (await readFile(firstFrame)).toString("base64");
        const last = (await readFile(lastFrame)).toString("base64");
        const { url, headers } = videoProxyUrl(ctx, "/v1/responses");
        const apiRes = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: "grok-4.3",
            input: [{
              role: "user",
              content: [
                { type: "input_image", image_url: `data:image/png;base64,${first}`, detail: "high" },
                { type: "input_image", image_url: `data:image/png;base64,${last}`, detail: "high" },
                { type: "input_text", text: "Analyze these first and last frames from a video for recreation. Infer likely motion between them. Include shot type, camera movement, lighting, color palette, subjects, motion direction/speed, mood, and audio/sound prompt suggestions. Be specific and cinematic." },
              ],
            }],
          }),
        });
        if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
        const data = (await apiRes.json()) as Record<string, unknown>;
        const text = extractOutputText(data);
        if (!text) return res.status(502).json({ error: "No analysis text in response" });
        logEvent("video", "analyze:done", { videoUrl, chars: text.length });
        res.json({ analysis: text, model: "grok-4.3", method: "first-last-frame" });
      } finally {
        await unlink(firstFrame).catch(() => {});
        await unlink(lastFrame).catch(() => {});
      }
    } catch (err: any) {
      logError("video", "analyze:error", err);
      sendError(res, err);
    }
  });
}
