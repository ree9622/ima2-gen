import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { registerVideoRoutes, saveGeneratedVideoArtifact } from "../routes/video.ts";

const execFileAsync = promisify(execFile);
let ffmpegAvailable: Promise<boolean> | null = null;

function listen(server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

function fakeMp4Bytes() {
  return Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
}

function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= execFileAsync("ffmpeg", ["-version"], { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  return ffmpegAvailable;
}

async function makeTinyMp4(path: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=green:s=64x64:d=1",
    "-pix_fmt", "yuv420p",
    path,
  ]);
}

// Mock progrok upstream: search -> planner -> start -> poll(done) -> download.
function makeProxy(options: { failFirstGeneration?: boolean } = {}) {
  let polls = 0;
  let starts = 0;
  const server = createServer((req, res) => {
    const url = req.url || "";
    if (url.includes("/v1/responses")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "text", text: "brief" }] }] }));
    }
    if (url.includes("/v1/chat/completions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt: "english clip" }) } }] } }] }));
    }
    if (url.includes("/v1/videos/generations")) {
      starts += 1;
      if (options.failFirstGeneration && starts === 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "`reference_images` is not supported for this model." }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ request_id: "vid-xyz" }));
    }
    if (url.includes("/v1/videos/vid-xyz")) {
      polls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      const port = (server.address() as any).port;
      if (polls < 2) return res.end(JSON.stringify({ status: "pending", progress: 50 }));
      return res.end(JSON.stringify({ status: "done", progress: 100, video: { url: `http://127.0.0.1:${port}/dl/v.mp4`, duration: 1, respect_moderation: true }, usage: { cost_in_usd_ticks: 500000000 } }));
    }
    if (url.includes("/dl/")) {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      return res.end(fakeMp4Bytes());
    }
    res.writeHead(404);
    res.end("nope");
  });
  return server;
}

async function videoApp(generatedDir, proxyPort) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerVideoRoutes(app, {
    rootDir: process.cwd(),
    packageVersion: "test",
    config: {
      ...config,
      storage: { ...config.storage, generatedDir },
      grokProvider: { ...config.grokProvider, proxyHost: "127.0.0.1", proxyPort, videoPollIntervalMs: 1, videoStartTimeoutMs: 5000, videoTimeoutMs: 30000, videoDownloadTimeoutMs: 5000, plannerTimeoutMs: 5000 },
    },
  });
  const server = createServer(app);
  const url = await listen(server);
  return { server, url };
}

function parseSse(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    const ev = /event: (.+)/.exec(block);
    const data = /data: (.+)/.exec(block);
    if (ev && data) events.push({ event: ev[1].trim(), data: JSON.parse(data[1]) });
  }
  return events;
}

test("/api/video/generate streams progress and saves mp4 + sidecar", async () => {
  const proxy = makeProxy();
  const proxyUrl = await listen(proxy);
  const proxyPort = Number(new URL(proxyUrl).port);
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-video-route-"));
  const { server, url } = await videoApp(generatedDir, proxyPort);
  try {
    const res = await fetch(`${url}/api/video/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "animate a cube", provider: "grok", model: "grok-imagine-video", duration: 1, resolution: "480p", requestId: "req_video_ok" }),
    });
    const events = parseSse(await res.text());
    const kinds = events.map((e) => e.event);
    assert.ok(kinds.includes("planning"), "has planning");
    assert.ok(kinds.includes("submitted"), "has submitted");
    assert.ok(kinds.includes("progress"), "has progress");
    const done = events.find((e) => e.event === "done");
    assert.ok(done, "has done");
    assert.match(done.data.filename, /\.mp4$/);
    assert.equal(done.data.mediaType, "video");
    assert.equal(done.data.video.xaiVideoRequestId, "vid-xyz");
    assert.equal(done.data.videoContinuity.entries.length, 1);
    assert.equal(done.data.videoContinuity.entries[0].revisedPrompt, "english clip");
    assert.equal(done.data.requestedModel, "grok-imagine-video");
    assert.equal(done.data.effectiveModel, "grok-imagine-video");
    assert.equal(done.data.modelFallback, null);

    const files = await readdir(generatedDir);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    assert.ok(mp4, "mp4 written");
    assert.ok(files.includes(`${mp4}.json`), "sidecar written");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${mp4}.json`), "utf8"));
    assert.equal(sidecar.model, "grok-imagine-video");
    assert.equal(sidecar.requestedModel, "grok-imagine-video");
    assert.equal(sidecar.effectiveModel, "grok-imagine-video");
    assert.equal(sidecar.modelFallback, null);
    assert.equal(sidecar.video.requestedModel, "grok-imagine-video");
    assert.equal(sidecar.video.effectiveModel, "grok-imagine-video");
    assert.equal(sidecar.video.modelFallback, null);
    assert.equal(sidecar.videoContinuity.entries[0].revisedPrompt, "english clip");
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => proxy.close(r));
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("/api/video/generate exposes fallback model metadata for 1.5 Ref2V", async () => {
  const proxy = makeProxy({ failFirstGeneration: true });
  const proxyUrl = await listen(proxy);
  const proxyPort = Number(new URL(proxyUrl).port);
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-video-route-fallback-"));
  const { server, url } = await videoApp(generatedDir, proxyPort);
  try {
    const res = await fetch(`${url}/api/video/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "continue the character motion",
        provider: "grok",
        model: "grok-imagine-video-1.5-preview",
        referenceImages: ["A", "B"],
        duration: 10,
        resolution: "720p",
        requestId: "req_video_fallback",
      }),
    });
    const events = parseSse(await res.text());
    const fallback = { from: "grok-imagine-video-1.5-preview", to: "grok-imagine-video" };
    const submitted = events.find((e) => e.event === "submitted");
    const done = events.find((e) => e.event === "done");
    assert.ok(submitted, "has submitted");
    assert.ok(done, "has done");
    assert.equal(submitted.data.requestedModel, "grok-imagine-video-1.5-preview");
    assert.equal(submitted.data.effectiveModel, "grok-imagine-video");
    assert.deepEqual(submitted.data.modelFallback, fallback);
    assert.equal(done.data.requestedModel, "grok-imagine-video-1.5-preview");
    assert.equal(done.data.effectiveModel, "grok-imagine-video");
    assert.deepEqual(done.data.modelFallback, fallback);
    assert.equal(done.data.video.requestedModel, "grok-imagine-video-1.5-preview");
    assert.equal(done.data.video.effectiveModel, "grok-imagine-video");
    assert.deepEqual(done.data.video.modelFallback, fallback);

    const files = await readdir(generatedDir);
    const mp4 = files.find((f) => f.endsWith(".mp4"));
    assert.ok(mp4, "mp4 written");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${mp4}.json`), "utf8"));
    assert.equal(sidecar.model, "grok-imagine-video");
    assert.equal(sidecar.requestedModel, "grok-imagine-video-1.5-preview");
    assert.equal(sidecar.effectiveModel, "grok-imagine-video");
    assert.deepEqual(sidecar.modelFallback, fallback);
    assert.equal(sidecar.video.requestedModel, "grok-imagine-video-1.5-preview");
    assert.equal(sidecar.video.effectiveModel, "grok-imagine-video");
    assert.deepEqual(sidecar.video.modelFallback, fallback);
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => proxy.close(r));
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("saveGeneratedVideoArtifact removes mp4 when sidecar write fails", async () => {
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-video-sidecar-fail-"));
  const filename = "broken.mp4";
  try {
    await mkdir(join(generatedDir, `${filename}.json`));
    await assert.rejects(
      saveGeneratedVideoArtifact(
        { config: { ...config, storage: { ...config.storage, generatedDir } } } as any,
        filename,
        fakeMp4Bytes(),
        { kind: "video", mediaType: "video" },
      ),
    );
    await assert.rejects(access(join(generatedDir, filename)), (err: any) => err?.code === "ENOENT");
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("/api/video/generate continueFromVideo extracts parent frame and stores branch lineage", async () => {
  if (!(await hasFfmpeg())) return;
  const proxy = makeProxy();
  const proxyUrl = await listen(proxy);
  const proxyPort = Number(new URL(proxyUrl).port);
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-video-route-continue-"));
  const parent = "parent.mp4";
  await makeTinyMp4(join(generatedDir, parent));
  await writeFile(join(generatedDir, `${parent}.json`), JSON.stringify({
    kind: "video",
    mediaType: "video",
    prompt: "first user prompt",
    userPrompt: "first user prompt",
    revisedPrompt: "First revised video prompt with rain ending.",
    createdAt: 1,
  }));
  const { server, url } = await videoApp(generatedDir, proxyPort);
  try {
    const res = await fetch(`${url}/api/video/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "continue from the last frame, footsteps only, no dialogue, end on closed door",
        provider: "grok",
        continueFromVideo: parent,
        duration: 1,
        resolution: "480p",
        requestId: "req_video_continue",
      }),
    });
    const done = parseSse(await res.text()).find((e) => e.event === "done");
    assert.ok(done, "has done");
    assert.equal(done.data.videoContinuity.entries.length, 2);
    assert.equal(done.data.videoContinuity.entries[0].revisedPrompt, "First revised video prompt with rain ending.");
    assert.equal(done.data.videoContinuity.entries[1].revisedPrompt, "english clip");
    const sidecar = JSON.parse(await readFile(join(generatedDir, `${done.data.filename}.json`), "utf8"));
    assert.equal(sidecar.videoContinuity.entries.length, 2);
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => proxy.close(r));
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("/api/video/generate rejects non-grok provider and bad params", async () => {
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-video-route-"));
  const { server, url } = await videoApp(generatedDir, 18645);
  try {
    const badProvider = parseSse(await (await fetch(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "oauth" }) })).text());
    assert.equal(badProvider.find((e) => e.event === "error")?.data.code, "VIDEO_PROVIDER_UNSUPPORTED");

    const noPrompt = parseSse(await (await fetch(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "grok" }) })).text());
    const promptError = noPrompt.find((e) => e.event === "error")?.data;
    assert.equal(promptError.code, "PROMPT_REQUIRED");
    assert.match(promptError.guidance, /Active video prompt required/);

    const badRes = parseSse(await (await fetch(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "grok", resolution: "8k" }) })).text());
    assert.equal(badRes.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
  } finally {
    await new Promise((r) => server.close(r));
    await rm(generatedDir, { recursive: true, force: true });
  }
});
