import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoGenerationPayload,
  parseGrokVideoPlanPrompt,
  normalizeVideoPoll,
  generateVideoViaGrok,
  type GrokVideoEvent,
  type GrokVideoPlan,
} from "../lib/grokVideoAdapter.js";
import { config } from "../config.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      ...config,
      grokProvider: {
        ...config.grokProvider,
        proxyHost: "127.0.0.1",
        proxyPort: 18645,
        plannerModel: "grok-4.3",
        plannerTimeoutMs: 10_000,
        videoStartTimeoutMs: 10_000,
        videoPollIntervalMs: 1,
        videoTimeoutMs: 60_000,
        videoDownloadTimeoutMs: 10_000,
      },
    },
    packageVersion: "test",
    ...overrides,
  } as any;
}

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => "application/json" },
  } as any;
}

function videoBytesRes() {
  const buf = Buffer.from("FAKE-MP4-BYTES");
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "video/mp4" : null) },
  } as any;
}

const SEARCH_RES = jsonRes({ output: [{ type: "message", content: [{ type: "text", text: "current cinematic references" }] }] });

function plannerRes(prompt = "An English cinematic 1-second push-in shot.") {
  return jsonRes({
    choices: [
      {
        message: {
          tool_calls: [
            { type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt, mode: "text-to-video", duration: 99, resolution: "720p" }) } },
          ],
        },
      },
    ],
  });
}

// Install a URL-routing fetch mock. pollSequence is consumed in order for poll GETs.
function installFetch(opts: { pollSequence: unknown[]; start?: unknown; captureStart?: (body: any) => void }) {
  let pollIdx = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes("/v1/responses")) return SEARCH_RES;
    if (url.includes("/v1/chat/completions")) return plannerRes();
    if (url.includes("/v1/videos/generations")) {
      opts.captureStart?.(JSON.parse(init?.body || "{}"));
      return jsonRes(opts.start ?? { request_id: "vid-1" });
    }
    if (url.includes("/v1/videos/vid-1")) {
      const next = opts.pollSequence[Math.min(pollIdx, opts.pollSequence.length - 1)];
      pollIdx += 1;
      return jsonRes(next);
    }
    if (url.includes("vidgen.example")) return videoBytesRes();
    throw new Error(`unexpected fetch: ${url}`);
  }) as any;
}

const DONE_POLL = { status: "done", progress: 100, video: { url: "https://vidgen.example/v.mp4", duration: 1, respect_moderation: true }, usage: { cost_in_usd_ticks: 500000000 } };

describe("Grok video adapter", () => {
  it("builds a T2V payload and omits aspect_ratio when auto", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "text-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video" });
    assert.equal(payload.model, "grok-imagine-video");
    assert.equal(payload.duration, 5);
    assert.equal(payload.resolution, "480p");
    assert.equal("aspect_ratio" in payload, false);
    assert.equal("image" in payload, false);
  });

  it("includes aspect_ratio when explicitly set", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "text-to-video", duration: 3, resolution: "720p", aspectRatio: "16:9", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video" });
    assert.equal(payload.aspect_ratio, "16:9");
  });

  it("builds an I2V payload with image url", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "image-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video", sourceImageUrl: "data:image/png;base64,AAAA" });
    assert.deepEqual(payload.image, { url: "data:image/png;base64,AAAA" });
  });

  it("rejects I2V without a source image", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "image-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    assert.throws(() => buildVideoGenerationPayload(plan, { model: "grok-imagine-video" }), (e: any) => e.code === "GROK_VIDEO_INVALID_MODE");
  });

  it("parses the generate_video planner prompt", () => {
    const prompt = parseGrokVideoPlanPrompt({
      choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt: "hello" }) } }] } }],
    });
    assert.equal(prompt, "hello");
  });

  it("throws when the planner does not call generate_video", () => {
    assert.throws(() => parseGrokVideoPlanPrompt({ choices: [{ message: { tool_calls: [] } }] }), (e: any) => e.code === "GROK_PLANNER_EMPTY_TOOL_CALL");
  });

  it("normalizes pending and done poll responses", () => {
    assert.equal(normalizeVideoPoll({ status: "pending", progress: 40 }).status, "pending");
    const done = normalizeVideoPoll(DONE_POLL);
    assert.equal(done.videoUrl, "https://vidgen.example/v.mp4");
    assert.equal(done.respectModeration, true);
    assert.equal(done.usage?.grok_cost_usd_ticks, 500000000);
  });

  it("runs the full T2V flow: search -> planner -> start -> poll -> download", async () => {
    const events: GrokVideoEvent[] = [];
    installFetch({ pollSequence: [{ status: "pending", progress: 10 }, DONE_POLL] });
    const result = await generateVideoViaGrok("makje a clip", ctx(), {
      duration: 5,
      resolution: "480p",
      onEvent: (ev) => events.push(ev),
    });
    assert.equal(result.videoBuffer.toString(), "FAKE-MP4-BYTES");
    assert.equal(result.contentType, "video/mp4");
    assert.equal(result.mode, "text-to-video");
    assert.equal(result.xaiVideoRequestId, "vid-1");
    assert.equal(result.duration, 1);
    assert.ok(events.some((e) => e.phase === "planning"));
    assert.ok(events.some((e) => e.phase === "submitted" && e.xaiVideoRequestId === "vid-1"));
    assert.ok(events.some((e) => e.phase === "progress"));
  });

  it("request settings win over planner duration/resolution", async () => {
    let startBody: any = null;
    installFetch({ pollSequence: [DONE_POLL], captureStart: (b) => (startBody = b) });
    await generateVideoViaGrok("clip", ctx(), { duration: 5, resolution: "480p" });
    // planner returned duration 99 / 720p, but request 5 / 480p must win
    assert.equal(startBody.duration, 5);
    assert.equal(startBody.resolution, "480p");
  });

  it("auto-selects I2V when a source image is supplied", async () => {
    let startBody: any = null;
    installFetch({ pollSequence: [DONE_POLL], captureStart: (b) => (startBody = b) });
    const result = await generateVideoViaGrok("animate", ctx(), { sourceImage: Buffer.from("img").toString("base64"), duration: 1, resolution: "480p" });
    assert.equal(result.mode, "image-to-video");
    assert.ok(startBody.image?.url?.startsWith("data:image/"));
  });

  it("maps moderation-suppressed done to GROK_VIDEO_MODERATION_BLOCKED", async () => {
    installFetch({ pollSequence: [{ status: "done", progress: 100, video: { url: "https://vidgen.example/v.mp4", respect_moderation: false } }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_MODERATION_BLOCKED");
  });

  it("maps done-without-url to GROK_VIDEO_EMPTY_RESPONSE", async () => {
    installFetch({ pollSequence: [{ status: "done", progress: 100, video: {} }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_EMPTY_RESPONSE");
  });

  it("maps failed status to GROK_VIDEO_FAILED", async () => {
    installFetch({ pollSequence: [{ status: "failed", error: { code: "internal_error" } }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_FAILED");
  });

  it("maps expired status to GROK_VIDEO_EXPIRED", async () => {
    installFetch({ pollSequence: [{ status: "expired" }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_EXPIRED");
  });
});
