import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAttemptSequence,
  buildPromptAttempts,
  getCompliantPromptVariant,
  getStrongCompliantVariant,
  hasCompliantRetry,
} from "../lib/safetyRetry.js";

describe("safety retry prompt variants", () => {
  it("adds adult non-sexual framing for Korean swimwear selfies", () => {
    const prompt = "수영복 셀카";
    const variant = getCompliantPromptVariant(prompt);

    assert.ok(variant);
    assert.match(variant, /성인\(25세 이상\)/);
    assert.match(variant, /일반인이 폰으로 찍은/);
    assert.match(variant, /배경은 한국/);
    assert.match(variant, /미성년자 없음/);
    assert.equal(hasCompliantRetry(prompt), true);
  });

  it("adds adult non-sexual framing for English beachwear prompts", () => {
    const attempts = buildPromptAttempts("bikini selfie at a resort pool");

    // bikini alone is a soft trigger → tier 1 only.
    assert.equal(attempts.length, 2);
    assert.match(attempts[1], /adults aged 25 or older/);
    assert.match(attempts[1], /amateur smartphone photo/);
    assert.match(attempts[1], /South Korea setting/);
    assert.match(attempts[1], /no minors/);
  });

  it("does not rewrite explicit or minor prompts", () => {
    assert.equal(getCompliantPromptVariant("여고생 수영복 셀카"), null);
    assert.equal(getCompliantPromptVariant("nude bikini selfie"), null);
    assert.equal(hasCompliantRetry("풍경 사진"), false);
    // strong-tier rewrite must also bail on explicit/minor cues.
    assert.equal(getStrongCompliantVariant("초등학생 비키니"), null);
    assert.equal(getStrongCompliantVariant("nude lingerie set"), null);
  });
});

describe("strong-tier rewrite (high-risk triggers)", () => {
  it("escalates fitting-room + bralette to strong English variant", () => {
    const prompt =
      "한국 여자 20대\n자라 매장에서\n브라렛 속옷 세트 입어보고 피팅룸에서 셀카, " +
      "167kg에 54kg 여성, E컵, 잘록한 허리, 골반 라인 도드라짐, 전신 다 보이게";
    const attempts = buildPromptAttempts(prompt);

    // [original, korean wrapper, strong English variant]
    assert.equal(attempts.length, 3);
    assert.equal(attempts[0], prompt);
    assert.match(attempts[1], /성인\(25세 이상\)/);

    const strong = attempts[2];
    assert.match(strong, /AI-generated synthetic character/);
    assert.match(strong, /amateur smartphone snapshot/);
    assert.match(strong, /South Korea setting/);
    assert.doesNotMatch(strong, /Editorial fashion catalog/);
    // keyword substitutions applied
    assert.match(strong, /casual loungewear set/);
    assert.match(strong, /clothing store interior/);
    // body emphasis stripped
    assert.doesNotMatch(strong, /E컵/);
    assert.doesNotMatch(strong, /잘록한 허리/);
    assert.doesNotMatch(strong, /골반 라인/);
    assert.doesNotMatch(strong, /167\s*kg|54\s*kg/);
    assert.doesNotMatch(strong, /전신 다 보이게/);
    // raw underwear/swimwear vocabulary should be gone
    assert.doesNotMatch(strong, /브라렛/);
    assert.doesNotMatch(strong, /속옷/);
    assert.doesNotMatch(strong, /피팅룸/);
  });

  it("escalates see-through clothing to strong variant", () => {
    const prompt =
      "한국 20대 여성\n[의상]\n안이 비치는 시스루 티셔츠, 돌핀 팬츠\n" +
      "[신체 강조]\n가슴 볼륨, 쇄골, 잘록한 허리";
    const attempts = buildPromptAttempts(prompt);

    assert.ok(attempts.length >= 3, `expected >=3 variants, got ${attempts.length}`);
    const strong = attempts[attempts.length - 1];

    assert.match(strong, /AI-generated synthetic character/);
    assert.match(strong, /lightweight summer top/);
    assert.match(strong, /athletic shorts/);
    // body-emphasis section block removed entirely
    assert.doesNotMatch(strong, /신체 강조/);
    assert.doesNotMatch(strong, /가슴 볼륨/);
    assert.doesNotMatch(strong, /쇄골/);
    assert.doesNotMatch(strong, /시스루/);
  });

  it("substitutes keywords in short edit prompts", () => {
    // Short edit-mode prompts ('비키니로 변경', '치마를 돌핀팬츠로 변경') were
    // the most frequent reject pattern in production logs.
    const v = getStrongCompliantVariant("비키니로 변경");
    assert.ok(v);
    assert.match(v, /AI-generated synthetic character/);
    assert.match(v, /two-piece swimwear/);
    assert.doesNotMatch(v, /비키니/);

    const v2 = getStrongCompliantVariant("치마를 돌핀팬츠로 변경");
    // 돌핀팬츠 alone is not a strong trigger, so this returns null
    // (only soft triggers handled by tier 1). Verify expected shape.
    assert.equal(v2, null);

    const v3 = getStrongCompliantVariant("시스루로 체인지");
    assert.ok(v3);
    assert.match(v3, /lightweight summer top/);
  });

  it("does not duplicate the strong wrapper if already present", () => {
    const v = getStrongCompliantVariant("비키니");
    assert.ok(v);
    const v2 = getStrongCompliantVariant(v);
    // Once wrapped, applying again should bail (wrapper already present
    // OR no further trigger keywords to substitute).
    if (v2) {
      const occurrences = (v2.match(/AI-generated synthetic character/g) || []).length;
      assert.equal(occurrences, 1, "wrapper must appear at most once");
    }
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
    assert.match(seq[1], /일반인이 폰으로 찍은/);
    assert.equal(seq[2], "수영복 셀카");
    assert.match(seq[3], /성인\(25세 이상\)/);
    assert.equal(seq[4], "수영복 셀카");
  });

  it("cycles through 3 variants for strong-trigger prompts", () => {
    const prompt = "한국 여자 20대 시스루 티셔츠 피팅룸 셀카";
    const seq = buildAttemptSequence(prompt, 4);
    assert.equal(seq.length, 4);
    assert.equal(seq[0], prompt);
    assert.match(seq[1], /성인\(25세 이상\)/);
    assert.match(seq[2], /AI-generated synthetic character/);
    // wraps back to original
    assert.equal(seq[3], prompt);
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
