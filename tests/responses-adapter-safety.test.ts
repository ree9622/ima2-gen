import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { editViaResponses, generateViaResponses } from "../lib/responsesImageAdapter.ts";

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

function emptyCompletedStreamResponse() {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"output":[]}}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

test("Responses adapter does not echo OAuth URL credentials on fetch failures", async () => {
  await assert.rejects(
    () => generateViaResponses(
      "oauth",
      "cat",
      "low",
      "1024x1024",
      "low",
      [],
      null,
      "auto",
      testContext({ oauthUrl: "http://user:pass@127.0.0.1:9" }),
      { webSearchEnabled: false },
    ),
    (err: any) => {
      assert.equal(err.code, "NETWORK_FAILED");
      assert.doesNotMatch(String(err.message), /user:pass|http:\/\/user|pass@/);
      assert.doesNotMatch(String(err.stack), /user:pass|http:\/\/user|pass@/);
      return true;
    },
  );
});

test("Responses adapter rejects malformed API keys without echoing token material", async () => {
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
      testContext({ apiKey: "sk-test\nSECRET" }),
      { webSearchEnabled: false },
    ),
    (err: any) => {
      assert.equal(err.code, "AUTH_API_KEY_INVALID");
      assert.equal(err.status, 401);
      assert.doesNotMatch(String(err.message), /SECRET|sk-test/);
      assert.doesNotMatch(String(err.stack), /SECRET|sk-test/);
      return true;
    },
  );
});

test("Responses adapter wraps coded fetch failures without echoing token material", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw Object.assign(
      new Error('Headers.append: "Bearer sk-SECRET" failed for http://user:pass@example.test'),
      { code: "UND_ERR_HEADERS", status: 400 },
    );
  }) as typeof fetch;
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
        assert.equal(err.code, "NETWORK_FAILED");
        assert.equal(err.status, 502);
        assert.doesNotMatch(String(err.message), /SECRET|user:pass|Bearer|sk-/);
        assert.doesNotMatch(String(err.stack), /SECRET|user:pass|Bearer|sk-/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses adapter preserves marked stream errors", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = (async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"error","error":{"code":"rate_limit_exceeded"}}\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
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
        assert.equal(err.code, "rate_limit_exceeded");
        assert.equal(err.eventCount, 1);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses edit EMPTY_RESPONSE carries 422 diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => emptyCompletedStreamResponse()) as typeof fetch;
  try {
    await assert.rejects(
      () => editViaResponses(
        "api",
        "cat",
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "low",
        "1024x1024",
        "low",
        "auto",
        testContext({ apiKey: "sk-test" }),
        null,
        { webSearchEnabled: false },
      ),
      (err: any) => {
        assert.equal(err.code, "EMPTY_RESPONSE");
        assert.equal(err.status, 422);
        assert.equal(err.eventCount, 1);
        assert.equal(err.responseDiagnostics?.streamStats?.sawResponseCompleted, true);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
