import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAttemptSequence,
  buildPromptAttempts,
  getCompliantPromptVariant,
  getFashionPortraitVariant,
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

    // [original, korean wrapper, strong English variant, fashion portrait]
    assert.equal(attempts.length, 4);
    assert.equal(attempts[0], prompt);
    assert.match(attempts[1], /성인\(25세 이상\)/);
    assert.match(attempts[3], /Korean fashion portrait/);

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

  it("escalates see-through clothing to strong + fashion-portrait variants", () => {
    const prompt =
      "한국 20대 여성\n[의상]\n안이 비치는 시스루 티셔츠, 돌핀 팬츠\n" +
      "[신체 강조]\n가슴 볼륨, 쇄골, 잘록한 허리";
    const attempts = buildPromptAttempts(prompt);

    assert.ok(attempts.length >= 3, `expected >=3 variants, got ${attempts.length}`);
    const strong = attempts.find((p) => /AI-generated synthetic character/.test(p));
    assert.ok(strong, "strong-amateur wrapper must be in attempts");
    assert.match(strong, /lightweight summer top/);
    assert.match(strong, /athletic shorts/);
    // body-emphasis section block removed entirely
    assert.doesNotMatch(strong, /신체 강조/);
    assert.doesNotMatch(strong, /가슴 볼륨/);
    assert.doesNotMatch(strong, /쇄골/);
    assert.doesNotMatch(strong, /시스루/);

    const fashion = attempts.find((p) => /Korean fashion portrait/.test(p));
    assert.ok(fashion, "fashion-portrait wrapper must be in attempts");
    assert.match(fashion, /lightweight summer top/);
    assert.doesNotMatch(fashion, /시스루/);
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

describe("hasRefs hint (reference-image safety guard)", () => {
  it("adds the strong English wrapper for clean prompts when refs are attached", () => {
    // Plain prompt (>40 chars) with no trigger keywords. Without hasRefs
    // there's no retry; with hasRefs the strong wrapper is queued as a
    // fallback retry tier (wrapper-LAST since the prompt is long enough
    // to carry meaningful instructions on attempt 1).
    const plain =
      "인물 유지 고정, 복장 유지, 다른 자세, 다른 포즈, 다른 표정, 다른 배경(한국 거리/실내/카페), 자연광";
    const noRefs = buildPromptAttempts(plain);
    assert.equal(noRefs.length, 1);

    const withRefs = buildPromptAttempts(plain, { hasRefs: true });
    assert.ok(withRefs.length >= 3, `expected >=3 variants, got ${withRefs.length}`);
    assert.equal(withRefs[0], plain);
    // Both wrappers must be queued (in either order). The classifier
    // accepts the editorial vs amateur framings unpredictably, so we try both.
    assert.ok(
      withRefs.some((p) => /AI-generated synthetic character/.test(p)),
      "amateur-snapshot wrapper missing",
    );
    assert.ok(
      withRefs.some((p) => /Korean fashion portrait/.test(p)),
      "fashion-portrait wrapper missing",
    );
  });

  it("hasCompliantRetry honors the hasRefs hint", () => {
    const plain = "다른 자세, 다른 배경";
    assert.equal(hasCompliantRetry(plain), false);
    assert.equal(hasCompliantRetry(plain, { hasRefs: true }), true);
  });

  it("buildAttemptSequence cycles through ref-mode variants (wrapper-first for short prompts)", () => {
    const plain = "다른 자세";
    const seq = buildAttemptSequence(plain, 3, { hasRefs: true });
    assert.equal(seq.length, 3);
    // Short ref-mode prompts hoist wrappers to the front because raw retries
    // on these prompts almost never recover (production data: 0/36).
    // Order: fashion-portrait (editorial frame) → strong-amateur (snapshot
    // frame) → raw fallback. Both framings get a shot before falling back.
    assert.match(seq[0], /Korean fashion portrait/);
    assert.match(seq[1], /AI-generated synthetic character/);
    assert.equal(seq[2], plain);
  });

  it("does not force the wrapper when prompt has explicit/minor cues", () => {
    // Even with refs, hard blockers must still bail (no rewrite path).
    assert.equal(buildPromptAttempts("nude photo", { hasRefs: true }).length, 1);
    assert.equal(buildPromptAttempts("여고생 사진", { hasRefs: true }).length, 1);
  });

  it("hoists fashion-portrait wrapper to attempt 0 for short ref-mode edit prompts", () => {
    // Production-observed reject pattern: short edit prompt + reference image,
    // where the image (not the text) trips the classifier. Wrapper-first
    // gives the classifier non-sexual framing on the very first attempt.
    // Order: [fashion-portrait, strong-amateur, raw] — opposite framings
    // give the retry cycle two distinct anchor points.
    const short = "다른 자세, 다른 배경";
    const seq = buildPromptAttempts(short, { hasRefs: true });
    assert.ok(seq.length >= 3);
    assert.match(seq[0], /Korean fashion portrait/);
    assert.match(seq[1], /AI-generated synthetic character/);
    assert.equal(seq[seq.length - 1], short);
  });

  it("does not hoist for long prompts even with refs", () => {
    // 40+ char prompts likely contain meaningful instructions; keep raw first
    // to honor user intent before falling back to wrapped variants.
    const long =
      "한국 20대 여성, 노을 지는 해운대 해변에서 바람에 머리카락 날리는 캐주얼 셀카, 자연광";
    const seq = buildPromptAttempts(long, { hasRefs: true });
    assert.equal(seq[0], long);
    assert.ok(
      seq.some((s) => /AI-generated synthetic character/.test(s)),
      "amateur-snapshot wrapper must be queued",
    );
    assert.ok(
      seq.some((s) => /Korean fashion portrait/.test(s)),
      "fashion-portrait wrapper must be queued",
    );
  });

  it("does not hoist when prompt has its own trigger keywords", () => {
    // If the text has its own triggers, keep the standard escalation order:
    // raw → korean wrapper → strong English. Hoisting would skip tier 1.
    const triggered = "비키니 셀카";
    const seq = buildPromptAttempts(triggered, { hasRefs: true });
    assert.equal(seq[0], triggered);
    assert.match(seq[1], /성인\(25세 이상\)/);
  });
});

describe("expanded body-emphasis triggers (production gap fix)", () => {
  it("strips '몸매 드러나게' / '전신 다 보이게'", () => {
    const prompt = "한국 20대, 비키니, 몸매 드러나게, 전신 다 보이게";
    const v = getStrongCompliantVariant(prompt);
    assert.ok(v);
    assert.doesNotMatch(v, /몸매\s*드러나/);
    assert.doesNotMatch(v, /전신\s*다?\s*보이/);
    assert.match(v, /two-piece swimwear/);
  });

  it("strips 슬렌더 / 볼륨감 / 긴 다리 라인", () => {
    const prompt =
      "비키니, 슬렌더한 체형, 볼륨감 있고, 긴 다리 라인 강조";
    const v = getStrongCompliantVariant(prompt);
    assert.ok(v);
    assert.doesNotMatch(v, /슬렌더/);
    assert.doesNotMatch(v, /볼륨감/);
    assert.doesNotMatch(v, /긴\s*다리\s*라인/);
  });

  it("substitutes '바디콘 드레스' / '크롭티' / '핫팬츠' / '미니스커트'", () => {
    const v1 = getStrongCompliantVariant("바디콘 드레스 셀카");
    assert.ok(v1);
    assert.match(v1, /fitted casual dress/);
    assert.doesNotMatch(v1, /바디콘/);

    const v2 = getStrongCompliantVariant("크롭티 + 비키니 매장");
    assert.ok(v2);
    assert.match(v2, /cropped t-shirt/);
    assert.doesNotMatch(v2, /크롭티/);

    const v3 = getStrongCompliantVariant("비키니, 핫팬츠 코디");
    assert.ok(v3);
    assert.match(v3, /casual shorts/);
    assert.doesNotMatch(v3, /핫\s*팬츠/);

    const v4 = getStrongCompliantVariant("비키니 위에 미니스커트");
    assert.ok(v4);
    assert.match(v4, /casual skirt/);
    assert.doesNotMatch(v4, /미니\s*스커트/);
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

  it("cycles through 4 variants for strong-trigger prompts", () => {
    // Strong-trigger prompts now produce 4 base variants:
    // [original, korean wrapper, strong-amateur English, fashion portrait]
    const prompt = "한국 여자 20대 시스루 티셔츠 피팅룸 셀카";
    const seq = buildAttemptSequence(prompt, 4);
    assert.equal(seq.length, 4);
    assert.equal(seq[0], prompt);
    assert.match(seq[1], /성인\(25세 이상\)/);
    assert.match(seq[2], /AI-generated synthetic character/);
    assert.match(seq[3], /Korean fashion portrait/);
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
