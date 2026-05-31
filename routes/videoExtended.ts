import type { Express, Request, Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { access, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { RouteRuntimeContext, RuntimeContext } from "../lib/runtimeContext.js";
import { requireRuntimeContext } from "../lib/runtimeContext.js";
import { getGrokProxyUrl } from "../lib/grokRuntime.js";
import { logEvent, logError } from "../lib/logger.js";

const execFileAsync = promisify(execFile);

function videoProxyUrl(ctx: RuntimeContext, path: string) {
  return { url: getGrokProxyUrl(ctx, path), headers: { "Content-Type": "application/json", Authorization: "Bearer dummy" } };
}

async function pollVideo(ctx: RuntimeContext, requestId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("canceled");
    await new Promise((r) => setTimeout(r, 5000));
    const { url, headers } = videoProxyUrl(ctx, `/v1/videos/${requestId}`);
    const res = await fetch(url, { headers: { Authorization: headers.Authorization } });
    if (!res.ok) throw new Error(`Poll failed: HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    if (data.status === "done") return data;
    if (data.status === "failed") throw new Error(`Video failed: ${JSON.stringify((data as any).error)}`);
    if (data.status === "expired") throw new Error("Video expired");
  }
  throw new Error("Video poll timeout");
}

export function registerVideoExtendedRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);

  // --- Video Edit (V2V) ---
  app.post("/api/video/edit", async (req: Request, res: Response) => {
    try {
      const { prompt, videoUrl, model = "grok-imagine-video" } = req.body ?? {};
      if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt required" });
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      if (model.includes("1.5")) return res.status(400).json({ error: "Video editing only supports grok-imagine-video (not 1.5-preview)" });

      const { url, headers } = videoProxyUrl(ctx, "/v1/videos/edits");
      const apiRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model, prompt, video: { url: videoUrl } }) });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const { request_id } = (await apiRes.json()) as { request_id: string };
      logEvent("video", "edit:start", { requestId: request_id, model });

      const result = await pollVideo(ctx, request_id);
      const video = (result as any).video as { url: string; duration: number } | undefined;
      if (!video) return res.status(502).json({ error: "No video in response" });

      logEvent("video", "edit:done", { requestId: request_id });
      res.json({ requestId: request_id, url: video.url, duration: video.duration, model });
    } catch (err: any) {
      logError("video", "edit:error", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Video Extension ---
  app.post("/api/video/extend", async (req: Request, res: Response) => {
    try {
      const { prompt, videoUrl, duration = 6, model = "grok-imagine-video" } = req.body ?? {};
      if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt required" });
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });
      if (model.includes("1.5")) return res.status(400).json({ error: "Video extension only supports grok-imagine-video (not 1.5-preview)" });
      const dur = Number(duration);
      if (dur < 2 || dur > 10) return res.status(400).json({ error: "duration must be 2-10" });

      const { url, headers } = videoProxyUrl(ctx, "/v1/videos/extensions");
      const apiRes = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model, prompt, duration: dur, video: { url: videoUrl } }) });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const { request_id } = (await apiRes.json()) as { request_id: string };
      logEvent("video", "extend:start", { requestId: request_id, model, duration: dur });

      const result = await pollVideo(ctx, request_id);
      const video = (result as any).video as { url: string; duration: number } | undefined;
      if (!video) return res.status(502).json({ error: "No video in response" });

      logEvent("video", "extend:done", { requestId: request_id, totalDuration: video.duration });
      res.json({ requestId: request_id, url: video.url, duration: video.duration, model });
    } catch (err: any) {
      logError("video", "extend:error", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Video Frame Extraction ---
  app.get("/api/video/frame", async (req: Request, res: Response) => {
    try {
      const file = req.query.file as string | undefined;
      const position = (req.query.position as string) || "last";
      if (!file) return res.status(400).json({ error: "file query param required" });
      const safe = file.replace(/^\/+/, "").replace(/\.\./g, "");
      const inputPath = join(ctx.config.storage.generatedDir, safe);
      try { await access(inputPath); } catch { return res.status(404).json({ error: "file not found" }); }

      const tmpOut = join(ctx.config.storage.generatedDir, `.frame_${randomBytes(4).toString("hex")}.png`);
      try {
        if (position === "last") {
          await execFileAsync("ffmpeg", ["-sseof", "-3", "-i", inputPath, "-update", "1", "-q:v", "1", tmpOut]);
        } else {
          const sec = parseFloat(position) || 0;
          await execFileAsync("ffmpeg", ["-ss", String(sec), "-i", inputPath, "-vframes", "1", tmpOut]);
        }
        res.sendFile(tmpOut, () => { unlink(tmpOut).catch(() => {}); });
      } catch (err: any) {
        await unlink(tmpOut).catch(() => {});
        return res.status(500).json({ error: `ffmpeg failed: ${err.message}` });
      }
    } catch (err: any) {
      logError("video", "frame:error", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Video Analysis (Grok 4.3 Vision) ---
  app.post("/api/video/analyze", async (req: Request, res: Response) => {
    try {
      const { videoUrl } = req.body ?? {};
      if (!videoUrl || typeof videoUrl !== "string") return res.status(400).json({ error: "videoUrl required" });

      const { url, headers } = videoProxyUrl(ctx, "/v1/responses");
      const apiRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "grok-4.3",
          input: [{
            role: "user",
            content: [
              { type: "input_file", file_url: videoUrl },
              { type: "input_text", text: "Describe this video for recreation as a structured prompt. Include: shot type, camera movement, lighting, color palette, subjects, motion direction/speed, mood, and audio/sound description. Be specific and cinematic." },
            ],
          }],
        }),
      });
      if (!apiRes.ok) { const t = await apiRes.text(); return res.status(apiRes.status).json({ error: t }); }
      const data = (await apiRes.json()) as Record<string, unknown>;
      const output = (data.output as any[])?.find((o: any) => o.type === "message");
      const text = output?.content?.find((c: any) => c.type === "output_text")?.text ?? "";
      logEvent("video", "analyze:done", { videoUrl, chars: text.length });
      res.json({ analysis: text, model: "grok-4.3" });
    } catch (err: any) {
      logError("video", "analyze:error", err);
      res.status(500).json({ error: err.message });
    }
  });
}
