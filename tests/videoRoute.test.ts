import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { registerVideoRoutes } from "../routes/video.ts";

function listen(server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

// Mock progrok upstream: search -> planner -> start -> poll(done) -> download.
function makeProxy() {
  let polls = 0;
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
      return res.end(Buffer.from("FAKE-MP4-BODY"));
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

    const files = await readdir(generatedDir);
    assert.ok(files.some((f) => f.endsWith(".mp4")), "mp4 written");
    assert.ok(files.some((f) => f.endsWith(".mp4.json")), "sidecar written");
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
    assert.equal(noPrompt.find((e) => e.event === "error")?.data.code, "PROMPT_REQUIRED");

    const badRes = parseSse(await (await fetch(`${url}/api/video/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "x", provider: "grok", resolution: "8k" }) })).text());
    assert.equal(badRes.find((e) => e.event === "error")?.data.code, "INVALID_VIDEO_RESOLUTION");
  } finally {
    await new Promise((r) => server.close(r));
    await rm(generatedDir, { recursive: true, force: true });
  }
});
