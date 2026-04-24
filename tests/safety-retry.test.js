import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
