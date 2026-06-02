import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import {
  editViaResponses,
  generateMultimodeViaResponses,
  generateViaResponses,
} from "../lib/responsesImageAdapter.ts";

const FINAL_B64 = Buffer.from("fallback image").toString("base64");
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function testContext(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      ...config,
      oauth: {
        ...config.oauth,
        generationTimeoutMs: 100,
        statusTimeoutMs: 100,
      },
      log: { ...config.log, level: "silent" },
    },
    ...overrides,
  };
}

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function rawSseResponse(body: string) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function expectNoImageCode(eventsOrBody: unknown[] | string, code: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => typeof eventsOrBody === "string"
    ? rawSseResponse(eventsOrBody)
    : sseResponse(eventsOrBody)) as typeof fetch;
  try {
    await assert.rejects(
      () => generateViaResponses(
        "api",
        "cat",
        "low",
        "1024x1024",
        "low",
        [],
        null,
        "auto",
        testContext({ apiKey: "sk-test" }),
        { webSearchEnabled: false },
      ),
      (err: any) => {
        assert.equal(err.code, code);
        assert.equal(err.status, 422);
        assert.equal(err.diagnosticReason, code.toLowerCase());
        assert.ok(err.responseDiagnostics);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Responses no-image outcomes classify into specific diagnostic codes", async () => {
  await expectNoImageCode("data: {not json}\n\n", "STREAM_PARSE_FAILED");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "web_search_call", status: "completed" } },
    { type: "response.completed", response: { output: [] } },
  ], "WEB_SEARCH_ONLY_RESPONSE");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text: "text only" }] } },
    { type: "response.completed", response: { output: [] } },
  ], "IMAGE_TOOL_NOT_CALLED");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "image_generation_call", status: "failed", error: { code: "tool_failed" } } },
    { type: "response.completed", response: { output: [] } },
  ], "IMAGE_TOOL_FAILED");
  await expectNoImageCode([
    { type: "response.output_item.done", item: { type: "image_generation_call", status: "completed" } },
    { type: "response.completed", response: { output: [] } },
  ], "IMAGE_TOOL_COMPLETED_WITHOUT_RESULT");
});

test("OAuth no-image stream retries once with prompt-only non-stream image tool", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: any }> = [];
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ body });
    if (calls.length === 1) {
      return sseResponse([{ type: "response.completed", response: { output: [] } }]);
    }
    return new Response(JSON.stringify({
      output: [{ type: "image_generation_call", result: FINAL_B64, revised_prompt: "fallback revised" }],
      usage: { total_tokens: 7 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await generateViaResponses(
      "oauth",
      "cat",
      "low",
      "1024x1024",
      "low",
      ["ZmFrZS1yZWY="],
      "req_retry",
      "auto",
      testContext(),
      { webSearchEnabled: true, allowPromptOnlyOAuthFallback: true },
    );
    assert.equal(result.b64, FINAL_B64);
    const retryResult = result as typeof result & {
      retryKind?: string;
      initialEventCount?: number;
      referencesDroppedOnRetry?: boolean;
      developerPromptDroppedOnRetry?: boolean;
      webSearchDroppedOnRetry?: boolean;
    };
    assert.equal(retryResult.retryKind, "prompt_only_with_developer");
    assert.equal(retryResult.initialEventCount, 1);
    assert.equal(retryResult.referencesDroppedOnRetry, true);
    assert.equal(retryResult.developerPromptDroppedOnRetry, false);
    assert.equal(retryResult.webSearchDroppedOnRetry, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.stream, true);
    assert.deepEqual(calls[0].body.tools.map((tool: any) => tool.type), ["web_search", "image_generation"]);
    assert.equal(calls[1].body.stream, false);
    assert.deepEqual(calls[1].body.tool_choice, { type: "image_generation" });
    assert.deepEqual(calls[1].body.tools.map((tool: any) => tool.type), ["image_generation"]);
    assert.equal(calls[1].body.input.length, 2);
    assert.equal(calls[1].body.input[0].role, "developer");
    assert.equal(calls[1].body.input[1].role, "user");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth prompt-only fallback is opt-in for classic generate", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return sseResponse([{ type: "response.completed", response: { output: [] } }]);
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => generateViaResponses(
        "oauth",
        "cat",
        "low",
        "1024x1024",
        "low",
        [],
        "req_no_retry",
        "auto",
        testContext(),
        { webSearchEnabled: false },
      ),
      (err: any) => {
        assert.equal(err.code, "EMPTY_RESPONSE");
        assert.equal(err.status, 422);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth edit no-image stream does not use prompt-only fallback", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return sseResponse([{ type: "response.completed", response: { output: [] } }]);
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => editViaResponses(
        "oauth",
        "remove background",
        TINY_PNG_B64,
        "low",
        "1024x1024",
        "low",
        "auto",
        testContext(),
        "req_edit_no_retry",
        { webSearchEnabled: false },
      ),
      (err: any) => {
        assert.equal(err.code, "EMPTY_RESPONSE");
        assert.equal(err.status, 422);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth multimode no-image stream does not use prompt-only fallback", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return sseResponse([{ type: "response.completed", response: { output: [] } }]);
  }) as typeof fetch;
  try {
    const result = await generateMultimodeViaResponses(
      "oauth",
      "cat sequence",
      "low",
      "1024x1024",
      "low",
      [],
      "req_multi_no_retry",
      "auto",
      testContext(),
      { webSearchEnabled: false, maxImages: 2 },
    );
    assert.equal(result.images.length, 0);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
