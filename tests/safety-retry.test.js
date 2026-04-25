import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAttemptSequence,
  buildPromptAttempts,
  getCompliantPromptVariant,
  hasCompliantRetry,
} from "../lib/safetyRetry.js";

describe("safety retry prompt variants", () => {
  it("adds adult non-sexual framing for Korean swimwear selfies", () => {
    const prompt = "수영복 셀카";
    const variant = getCompliantPromptVariant(prompt);

    assert.ok(variant);
    assert.match(variant, /성인\(25세 이상\)/);
    assert.match(variant, /비성적 수영복/);
    assert.match(variant, /미성년자 없음/);
    assert.equal(hasCompliantRetry(prompt), true);
  });

  it("adds adult non-sexual framing for English beachwear prompts", () => {
    const attempts = buildPromptAttempts("bikini selfie at a resort pool");

    assert.equal(attempts.length, 2);
    assert.match(attempts[1], /adults aged 25 or older/);
    assert.match(attempts[1], /non-sexual swimwear/);
    assert.match(attempts[1], /no minors/);
  });

  it("does not rewrite explicit or minor prompts", () => {
    assert.equal(getCompliantPromptVariant("여고생 수영복 셀카"), null);
    assert.equal(getCompliantPromptVariant("nude bikini selfie"), null);
    assert.equal(hasCompliantRetry("풍경 사진"), false);
  });
});

describe("buildAttemptSequence (max retry count)", () => {
  it("defaults to a single attempt when maxAttempts is 1", () => {
    const seq = buildAttemptSequence("수영복 셀카", 1);
    assert.equal(seq.length, 1);
    assert.equal(seq[0], "수영복 셀카");
  });

  it("alternates between original and compliant variant for N > 1", () => {
    const seq = buildAttemptSequence("수영복 셀카", 5);
    assert.equal(seq.length, 5);
    assert.equal(seq[0], "수영복 셀카");
    assert.match(seq[1], /성인\(25세 이상\)/);
    assert.equal(seq[2], "수영복 셀카");
    assert.match(seq[3], /성인\(25세 이상\)/);
    assert.equal(seq[4], "수영복 셀카");
  });

  it("repeats the original prompt when no compliant variant is available", () => {
    const seq = buildAttemptSequence("풍경 사진", 4);
    assert.equal(seq.length, 4);
    for (const s of seq) assert.equal(s, "풍경 사진");
  });

  it("clamps out-of-range values (0 → 1, 99 → 10)", () => {
    assert.equal(buildAttemptSequence("x", 0).length, 1);
    assert.equal(buildAttemptSequence("x", 99).length, 10);
    assert.equal(buildAttemptSequence("x", -3).length, 1);
  });

  it("floors non-integer counts", () => {
    assert.equal(buildAttemptSequence("x", 3.7).length, 3);
  });
});
