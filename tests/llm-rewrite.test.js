// Unit tests for lib/llmRewrite.js
//
// We don't hit the live OAuth proxy here — the network call goes through
// runResponses() which is imported from oauthStream.js. We monkey-patch
// the global fetch (used inside runResponses) to return a canned JSON
// response. That lets us cover:
//   - the system-prompt scaffolding (categories / refusalText / reasoning
//     get embedded in the request body)
//   - the success path (Responses API non-stream JSON shape)
//   - the UNRECOVERABLE bail-out
//   - the empty-response fallback
//   - the identical-rewrite fallback
//   - sanitization removing self-censoring tokens

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRewritePayload,
  rewritePromptForSafety,
} from "../lib/llmRewrite.js";

function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  return fn(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function responsesApiJson(text) {
  return {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

describe("buildRewritePayload", () => {
  it("includes the user prompt in the input", () => {
    const body = buildRewritePayload("비키니 셀카", { categories: ["sexual"] });
    assert.equal(body.model, "gpt-5.5");
    assert.equal(body.stream, false);
    assert.equal(body.tools.length, 0);
    assert.deepEqual(
      body.input.find((m) => m.role === "user"),
      { role: "user", content: "비키니 셀카" },
    );
  });

  it("system prompt names the safety categories that triggered", () => {
    const body = buildRewritePayload("test", { categories: ["sexual", "minors"] });
    const sys = body.input.find((m) => m.role === "system").content;
    assert.match(sys, /Refusal categories: \[sexual, minors\]/);
  });

  it("system prompt embeds refusalText / reasoningSummary when provided", () => {
    const body = buildRewritePayload("test", {
      categories: ["sexual"],
      refusalText: "I cannot generate that content.",
      reasoningSummary: "The classifier flagged the bare-midriff phrasing.",
    });
    const sys = body.input.find((m) => m.role === "system").content;
    assert.match(sys, /Model refusal text:/);
    assert.match(sys, /I cannot generate that content/);
    assert.match(sys, /Model reasoning summary:/);
    assert.match(sys, /classifier flagged the bare-midriff phrasing/);
  });

  it("system prompt forbids safety-disclaimer injection", () => {
    const sys = buildRewritePayload("x", {}).input.find((m) => m.role === "system").content;
    assert.match(sys, /NEVER inject 'non-sexual'/);
    assert.match(sys, /'non-sexual'[\s\S]*safety disclaimers/);
  });

  it("includes the UNRECOVERABLE return-marker rule for minor cues", () => {
    const sys = buildRewritePayload("x", {}).input.find((m) => m.role === "system").content;
    assert.match(sys, /UNRECOVERABLE/);
    assert.match(sys, /(?:teen|schoolgirl|underage|미성년)/);
  });
});

describe("rewritePromptForSafety", () => {
  it("returns the rewritten text on a normal success", async () => {
    const handler = () =>
      jsonResponse(
        responsesApiJson(
          "Editorial fashion magazine BTS — two-piece swimwear at a Korean rooftop pool, midriff visible at the waistline, casual relaxed pose",
        ),
      );

    await withMockFetch(handler, async (calls) => {
      const result = await rewritePromptForSafety({
        prompt: "비키니 미드리프 노출 셀카",
        oauthUrl: "http://127.0.0.1:10531",
        categories: ["sexual"],
        refusalText: "I cannot generate that.",
        log: () => {},
      });
      assert.ok(result);
      assert.match(result, /Editorial fashion magazine BTS/);
      assert.match(result, /midriff visible at the waistline/);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/v1\/responses$/);
    });
  });

  it("returns null when the model emits the UNRECOVERABLE marker", async () => {
    const handler = () => jsonResponse(responsesApiJson("UNRECOVERABLE"));

    await withMockFetch(handler, async () => {
      const result = await rewritePromptForSafety({
        prompt: "여고생 비키니",
        oauthUrl: "http://127.0.0.1:10531",
        categories: ["sexual_minors"],
        log: () => {},
      });
      assert.equal(result, null);
    });
  });

  it("returns null when the model emits empty output", async () => {
    const handler = () => jsonResponse(responsesApiJson(""));

    await withMockFetch(handler, async () => {
      const result = await rewritePromptForSafety({
        prompt: "test prompt",
        oauthUrl: "http://127.0.0.1:10531",
        categories: ["sexual"],
        log: () => {},
      });
      assert.equal(result, null);
    });
  });

  it("returns null when the rewrite is identical to the input (no progress)", async () => {
    const original = "비키니 셀카";
    const handler = () => jsonResponse(responsesApiJson(original));

    await withMockFetch(handler, async () => {
      const result = await rewritePromptForSafety({
        prompt: original,
        oauthUrl: "http://127.0.0.1:10531",
        categories: ["sexual"],
        log: () => {},
      });
      assert.equal(result, null);
    });
  });

  it("strips smuggled-in safety disclaimers via sanitizeEnhancedText", async () => {
    // Even though we tell the system prompt not to, the model sometimes
    // prepends "non-sexual" / "tasteful framing" / age disclaimers. The
    // existing enhance-sanitize pipeline strips these as a safety net.
    const handler = () =>
      jsonResponse(
        responsesApiJson(
          "non-sexual fashion catalog shoot, tasteful framing, two-piece swimwear, " +
            "midriff visible at the waistline, Korean rooftop pool, " +
            "model aged 25 or older, of legal age",
        ),
      );

    await withMockFetch(handler, async () => {
      const result = await rewritePromptForSafety({
        prompt: "비키니 미드리프",
        oauthUrl: "http://127.0.0.1:10531",
        categories: ["sexual"],
        log: () => {},
      });
      assert.ok(result);
      // Disclaimers stripped by the existing sanitizer
      assert.doesNotMatch(result, /non-sexual/i);
      assert.doesNotMatch(result, /tasteful/i);
      assert.doesNotMatch(result, /model aged 25/i);
      assert.doesNotMatch(result, /of legal age/i);
      // The substantive intent (swimwear / midriff visible / Korean rooftop pool) survives
      assert.match(result, /two-piece swimwear/);
      assert.match(result, /midriff visible/);
    });
  });

  it("returns null when the proxy errors out", async () => {
    const handler = () => jsonResponse({ error: { message: "upstream broken" } }, { status: 500 });

    await withMockFetch(handler, async () => {
      const result = await rewritePromptForSafety({
        prompt: "test",
        oauthUrl: "http://127.0.0.1:10531",
        categories: ["sexual"],
        log: () => {},
      });
      assert.equal(result, null);
    });
  });

  it("returns null when oauthUrl is missing", async () => {
    const result = await rewritePromptForSafety({
      prompt: "test",
      oauthUrl: "",
      categories: ["sexual"],
      log: () => {},
    });
    assert.equal(result, null);
  });

  it("returns null when prompt is empty / whitespace-only", async () => {
    const a = await rewritePromptForSafety({
      prompt: "",
      oauthUrl: "http://127.0.0.1:10531",
      log: () => {},
    });
    const b = await rewritePromptForSafety({
      prompt: "   ",
      oauthUrl: "http://127.0.0.1:10531",
      log: () => {},
    });
    assert.equal(a, null);
    assert.equal(b, null);
  });
});
