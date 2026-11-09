import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSafetyViolation } from "../lib/safetyRetry.js";
import { isSafetyRefusal, throwIfSafetyRefusal } from "../lib/safetyRefusal.js";
import { isUpstreamBusy, upstreamBusyError } from "../lib/upstreamBusy.js";

// Exercise the production retry loop without starting HTTP, SQLite, or OAuth.
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const start = server.indexOf("async function runPromptAttempts(");
const end = server.indexOf("// Sum numeric usage fields", start);
assert.ok(start >= 0 && end > start);
const waits = [];
const deps = {
  console: { log() {}, warn() {}, error() {} },
  throwIfGenerationCanceled() {},
  throwIfSafetyRefusal,
  isUpstreamBusy,
  upstreamBusyError,
  imageRateCooldownUntil: 0,
  waitWithGenerationCancel: async (ms, signal) => {
    waits.push(ms);
    if (signal?.aborted) throw signal.reason;
  },
  parseSafetyViolation,
  isNetworkError: () => false,
  isAuthError: () => false,
  isGenerationCanceledError: () => false,
  isTransientRateLimit: () => false,
  isUsageLimitError: () => false,
  OAUTH_URL: "http://never-call",
  rewritePromptForSafety: () => assert.fail("must not rewrite a policy rejection"),
};
const run = new Function(...Object.keys(deps), `${server.slice(start, end)}; return runPromptAttempts;`)(...Object.values(deps));
const refusal = "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID example-request-id.";

for (const [label, error] of [
  ["uncategorized Images API rejection", new Error(refusal)],
  ["structured upstream code", Object.assign(new Error("Blocked"), { upstreamCode: "content_policy_violation" })],
  ["categorized rejection", new Error("safety_violations=[sexual]")],
  ["unrecoverable category", new Error("safety_violations=[minors]")],
]) {
  test(`${label} stops after one call with evidence intact`, async () => {
    let calls = 0;
    await assert.rejects(run("ordinary test input", async () => {
      calls++;
      throw error;
    }, "test", 7, null, { disablePromptMutation: true }), (e) => {
      assert.equal(e.code, "SAFETY_REFUSAL");
      assert.equal(e.status, 422);
      assert.equal(e.cause, error);
      assert.equal(e.attempts.length, 1);
      assert.equal(e.attempts[0].errorCode, "SAFETY_REFUSAL");
      assert.ok(e.message.includes(error.message));
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("explicit Responses refusal stops without a second tool call", async () => {
  let calls = 0;
  await assert.rejects(run("test", async () => {
    calls++;
    return { b64: null, refusalText: "I cannot generate that image." };
  }, "test", 7, null, { disablePromptMutation: true }), (e) => {
    assert.equal(e.code, "SAFETY_REFUSAL");
    assert.match(e.message, /I cannot generate/);
    assert.equal(e.attempts.length, 1);
    return true;
  });
  assert.equal(calls, 1);
});

test("temporary server error and empty reasoning response still recover", async () => {
  for (const first of [new Error("upstream unavailable"), { b64: null, reasoningSummary: "Image tool timed out" }]) {
    let calls = 0;
    const result = await run("test", async () => {
      if (++calls === 1) {
        if (first instanceof Error) throw first;
        return first;
      }
      return { b64: "image-result" };
    }, "test", 7, null, { disablePromptMutation: true });
    assert.equal(calls, 2);
    assert.equal(result.b64, "image-result");
    assert.equal(result.attempts[0].errorCode, first instanceof Error ? null : "EMPTY_RESPONSE");
  }
});

test("ordinary input, auth, quota, and network errors are not policy refusals", () => {
  for (const e of [null, "", new Error("Invalid image data"), new Error("fetch failed"),
    { upstreamCode: "image_generation_user_error", message: "Invalid image size" },
    { status: 401, message: "Unauthorized" }, { status: 429, message: "Usage limit reached" }]) {
    assert.equal(isSafetyRefusal(e), false);
  }
});

test("a saturated account pool recovers with the same prompt after waiting", async () => {
  const before = waits.length;
  let calls = 0;
  const result = await run("unchanged prompt", async (prompt) => {
    assert.equal(prompt, "unchanged prompt");
    if (++calls === 1) throw Object.assign(new Error("all codex accounts busy (try again shortly)"), { status: 503 });
    return { b64: "image-result" };
  }, "test", 1, null, { disablePromptMutation: true });
  assert.equal(calls, 2);
  assert.equal(result.attempts[0].errorCode, "UPSTREAM_BUSY");
  assert.equal(waits.length, before + 1);
  assert.equal(waits.at(-1), 8000);
});

test("continued account saturation stops at two calls even with a seven-attempt budget", async () => {
  let calls = 0;
  await assert.rejects(run("test", async () => {
    calls++;
    throw Object.assign(new Error("all codex accounts busy (try again shortly)"), { status: 503 });
  }, "test", 7, null, { disablePromptMutation: true }), (e) => {
    assert.equal(e.code, "UPSTREAM_BUSY");
    assert.equal(e.status, 503);
    assert.equal(e.attempts.length, 2);
    return true;
  });
  assert.equal(calls, 2);
});

test("cancellation during capacity backoff prevents the next request", async () => {
  const controller = new AbortController();
  const canceled = new Error("canceled during wait");
  let calls = 0;
  await assert.rejects(run("test", async () => {
    calls++;
    controller.abort(canceled);
    throw Object.assign(new Error("all codex accounts busy"), { status: 503 });
  }, "test", 7, null, { disablePromptMutation: true, abortSignal: controller.signal }), (e) => e === canceled);
  assert.equal(calls, 1);
});
