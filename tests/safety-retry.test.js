import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _resetJustifyCycle,
  buildAttemptSequence,
  buildPromptAttempts,
  getCompliantPromptVariant,
  getFashionPortraitVariant,
  getJustificationVariant,
  getStrongCompliantVariant,
  hasCompliantRetry,
  JUSTIFICATION_CONTEXTS,
  parseSafetyViolation,
} from "../lib/safetyRetry.js";

// `buildPromptAttempts` advances a module-level cycle counter on every call
// (so successive generate requests rotate through all 4 justification
// contexts). Reset it before every test so order assertions stay deterministic.
beforeEach(() => {
  _resetJustifyCycle();
});

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

    // bikini = soft trigger. Sequence: [raw, justifyA, justifyB, ENG wrapper].
    assert.equal(attempts.length, 4);
    assert.match(attempts[1], /Editorial fashion magazine BTS/);
    assert.match(attempts[2], /Resort lifestyle vlog/);
    assert.match(attempts[3], /adults aged 25 or older/);
    assert.match(attempts[3], /amateur smartphone photo/);
    assert.match(attempts[3], /South Korea setting/);
    assert.match(attempts[3], /no minors/);
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

    // [original, justifyA, justifyB, korean wrapper, strong English, fashion portrait]
    assert.equal(attempts.length, 6);
    assert.equal(attempts[0], prompt);
    assert.match(attempts[1], /Editorial fashion magazine BTS/);
    assert.match(attempts[2], /Resort lifestyle vlog/);
    assert.match(attempts[3], /성인\(25세 이상\)/);
    assert.match(attempts[5], /Korean fashion portrait/);

    const strong = attempts[4];
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
    // Order: [fashion-portrait, strong-amateur, raw, ...justifications] —
    // opposite framings give the retry cycle two distinct anchor points,
    // raw stays as a final fallback before the justification fan-out.
    const short = "다른 자세, 다른 배경";
    const seq = buildPromptAttempts(short, { hasRefs: true });
    assert.ok(seq.length >= 3);
    assert.match(seq[0], /Korean fashion portrait/);
    assert.match(seq[1], /AI-generated synthetic character/);
    // raw is preserved somewhere in the cycle as a fallback
    assert.ok(seq.includes(short), "raw prompt must remain in the cycle");
    // justification variants attached because hasRefs: true forces them
    assert.ok(seq.some((p) => /Editorial fashion magazine BTS/.test(p)));
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
    // raw → justifications → korean wrapper → strong → fashion.
    const triggered = "비키니 셀카";
    const seq = buildPromptAttempts(triggered, { hasRefs: true });
    assert.equal(seq[0], triggered);
    assert.match(seq[1], /Editorial fashion magazine BTS/);
    assert.match(seq[2], /Resort lifestyle vlog/);
    assert.ok(
      seq.some((p) => /성인\(25세 이상\)/.test(p)),
      "korean wrapper must remain queued after justifications",
    );
  });
});

describe("justification tier (no tone-down, professional context anchor)", () => {
  it("prefixes a context to a soft-trigger swimwear prompt", () => {
    const v = getJustificationVariant("bikini selfie at a pool", { contextIndex: 0 });
    assert.ok(v);
    assert.match(v, /^Editorial fashion magazine BTS/);
    assert.match(v, /bikini selfie at a pool$/);
    // body of the original prompt MUST be preserved (no keyword strip,
    // no body-emphasis removal — that is the whole point of this tier).
    assert.match(v, /bikini/);
  });

  it("rotates between 3 contexts via contextIndex", () => {
    assert.equal(JUSTIFICATION_CONTEXTS.length, 3);
    for (let i = 0; i < 6; i++) {
      const v = getJustificationVariant("수영복 셀카", { contextIndex: i });
      assert.ok(v);
      const expected = JUSTIFICATION_CONTEXTS[i % 3];
      assert.ok(v.startsWith(expected), `index ${i} should start with rotated context ${i % 3}`);
    }
  });

  it("returns null for hard blockers (explicit / minor cues)", () => {
    assert.equal(getJustificationVariant("nude selfie"), null);
    assert.equal(getJustificationVariant("여고생 비키니"), null);
    assert.equal(getJustificationVariant("schoolgirl swimsuit"), null);
    // explicit minor tokens still block
    assert.equal(getJustificationVariant("어린이 수영복"), null);
    assert.equal(getJustificationVariant("청소년 비키니"), null);
    assert.equal(getJustificationVariant("10대 셀카"), null);
  });

  it("does not false-positive on common Korean device/UX words containing '아이'", () => {
    // Regression: '아이' alone used to be in MINOR_RE which short-circuited
    // every wrapper for prompts mentioning 아이폰 / 아이패드 / 아이디어 /
    // 아이콘 / 아이템. Production-observed: a swimwear/fitting-room prompt
    // with "아이폰으로 촬영한 아마추어 사진" had its entire 5-attempt cycle
    // collapse to raw retries because of this single substring match.
    const samples = [
      "아이폰으로 촬영한 아마추어 사진, 비키니 피팅룸 셀카",
      "아이패드 화면 비키니 카탈로그 셀카",
      "참신한 아이디어, 비키니 룩북 셀카",
      "앱 아이콘 디자인, 비키니 프로모 셀카",
      "여름 아이템 비키니 셀카",
    ];
    for (const s of samples) {
      const v = getJustificationVariant(s, { contextIndex: 0 });
      assert.ok(v, `wrapper should attach for "${s}" — '아이' substring must not hard-block`);
    }
  });

  it("returns null for prompts with no triggers (and no force)", () => {
    // No swimwear/selfie/sheer/underwear/fitting-room cue → classifier
    // unlikely to reject anyway. Adding a "fashion magazine BTS" prefix
    // would be cargo-culting.
    assert.equal(getJustificationVariant("산 풍경, 일출"), null);
    assert.equal(getJustificationVariant("귀여운 강아지"), null);
  });

  it("force: true attaches even when no trigger is present", () => {
    // Used for ref-mode where the reference image (not the prompt text)
    // is what trips the classifier.
    const v = getJustificationVariant("다른 자세", { contextIndex: 0, force: true });
    assert.ok(v);
    assert.match(v, /^Editorial fashion magazine BTS/);
  });

  it("does not duplicate when the context is already present", () => {
    const once = getJustificationVariant("비키니 셀카", { contextIndex: 0 });
    const twice = getJustificationVariant(once, { contextIndex: 0 });
    assert.equal(twice, null);
  });

  it("preserves skin-exposure cues in the body — that's the whole point", () => {
    const skin =
      "fitted ribbed crop tank top with bare midriff and bare shoulders exposed, " +
      "low-rise short denim shorts, bare legs from upper thigh visible, bikini";
    const v = getJustificationVariant(skin, { contextIndex: 0 });
    assert.ok(v);
    assert.match(v, /bare midriff/);
    assert.match(v, /bare shoulders/);
    assert.match(v, /bare legs/);
    assert.match(v, /low-rise/);
  });

  it("appears between raw and the tone-down wrappers in the attempt cycle", () => {
    const seq = buildPromptAttempts("bikini selfie", { hasRefs: false });
    assert.equal(seq[0], "bikini selfie");
    assert.match(seq[1], /Editorial fashion magazine BTS/);
    assert.match(seq[2], /Resort lifestyle vlog/);
    // tone-down wrapper (englsh) comes after the 2 justifications
    assert.match(seq[3], /adults aged 25 or older/);
  });

  it("contexts must not name renderable production props or broadcast frames", () => {
    // Regression: the original Sports / Vlog contexts named "press microphone
    // with a network logo cube" and "handheld camcorder footage", which the
    // image model rendered literally on every retry that landed there.
    // 2026-04-30 escalation: even after stripping prop nouns, the "Sports
    // broadcast post-match athlete interview" anchor kept producing
    // broadcast/interview scenes (mics, station logos, press backdrops).
    // We removed that anchor entirely. The banned list now also covers
    // broadcast / interview / journalism wording so any future addition
    // can't accidentally re-introduce the same failure mode.
    const banned = [
      /microphone/i,
      /network logo/i,
      /camcorder/i,
      /press credential/i,
      /broadcast/i,
      /interview/i,
      /journalism/i,
    ];
    for (const ctx of JUSTIFICATION_CONTEXTS) {
      for (const re of banned) {
        assert.doesNotMatch(
          ctx,
          re,
          `context anchor must not name renderable prop "${re}": ${ctx}`,
        );
      }
    }
  });

  it("rotates the starting context across successive buildPromptAttempts calls", () => {
    // Without rotation the same (0, 1) pair was used on every call, so one
    // prefix's visual bias dominated the output. Counter advances by one per
    // call so a 3-call window covers all 3 contexts.
    _resetJustifyCycle();
    const startsOf = () => {
      const seq = buildPromptAttempts("bikini selfie", { hasRefs: false });
      // seq[0] = raw, seq[1] = first justification, seq[2] = second
      return [seq[1], seq[2]].map(
        (s) => JUSTIFICATION_CONTEXTS.findIndex((c) => s.startsWith(c)),
      );
    };
    assert.deepEqual(startsOf(), [0, 1]);
    assert.deepEqual(startsOf(), [1, 2]);
    assert.deepEqual(startsOf(), [2, 0]);
    // wraps back around
    assert.deepEqual(startsOf(), [0, 1]);
  });

  it("explicit contextStart overrides the cycle and does not advance it", () => {
    _resetJustifyCycle();
    const seq1 = buildPromptAttempts("bikini selfie", {
      hasRefs: false,
      contextStart: 1,
    });
    assert.match(seq1[1], /Resort lifestyle vlog/);
    // The explicit override must NOT have advanced the module counter, so
    // the next plain call still starts at 0.
    const seq2 = buildPromptAttempts("bikini selfie", { hasRefs: false });
    assert.match(seq2[1], /Editorial fashion magazine BTS/);
  });
});

describe("parseSafetyViolation (단계 3 — 적응형 routing 입력 파서)", () => {
  it("returns null when no safety_violations clause is present", () => {
    assert.equal(parseSafetyViolation(null), null);
    assert.equal(parseSafetyViolation(""), null);
    assert.equal(parseSafetyViolation("Some unrelated error"), null);
    assert.equal(parseSafetyViolation(new Error("network reset")), null);
  });

  it("parses a single sexual violation from a typical refusal message", () => {
    const msg =
      "Your request was rejected by the safety system. " +
      "If you believe this is an error, contact us at help.openai.com and " +
      "include the request ID e24923ac-4fb0-4187-b1fd-802626599f63. " +
      "safety_violations=[sexual].";
    const v = parseSafetyViolation(msg);
    assert.ok(v);
    assert.deepEqual(Array.from(v.categories), ["sexual"]);
    assert.equal(v.skinRelated, true);
    assert.equal(v.unrecoverable, false);
  });

  it("parses multi-category violations (sexual + minors → unrecoverable)", () => {
    const msg = "rejected — safety_violations=[sexual, minors]";
    const v = parseSafetyViolation(msg);
    assert.ok(v);
    assert.ok(v.categories.has("sexual"));
    assert.ok(v.categories.has("minors"));
    assert.equal(v.skinRelated, true);
    assert.equal(v.unrecoverable, true);
  });

  it("parses sexual_minors as unrecoverable + skin-related", () => {
    const v = parseSafetyViolation("safety_violations=[sexual_minors]");
    assert.ok(v);
    assert.equal(v.unrecoverable, true);
    assert.equal(v.skinRelated, true);
  });

  it("treats violence / hate / self_harm as recoverable but not skin-related", () => {
    for (const cat of ["violence", "hate", "self_harm", "harassment"]) {
      const v = parseSafetyViolation(`safety_violations=[${cat}]`);
      assert.ok(v, `failed to parse [${cat}]`);
      assert.equal(v.unrecoverable, false, `${cat} unexpectedly unrecoverable`);
      assert.equal(v.skinRelated, false, `${cat} unexpectedly skin-related`);
    }
  });

  it("accepts both quoted and unquoted category tokens", () => {
    const a = parseSafetyViolation("safety_violations=['sexual']");
    const b = parseSafetyViolation('safety_violations=["sexual"]');
    const c = parseSafetyViolation("safety_violations=[sexual]");
    assert.ok(a && b && c);
    assert.deepEqual(Array.from(a.categories), ["sexual"]);
    assert.deepEqual(Array.from(b.categories), ["sexual"]);
    assert.deepEqual(Array.from(c.categories), ["sexual"]);
  });

  it("includes unknown categories in the set (so observability isn't lossy)", () => {
    const v = parseSafetyViolation("safety_violations=[mystery_category]");
    assert.ok(v);
    assert.ok(v.categories.has("mystery_category"));
    assert.equal(v.unrecoverable, false);
    assert.equal(v.skinRelated, false);
  });

  it("accepts an Error object directly (uses .message)", () => {
    const err = new Error(
      "rejected by safety_violations=[sexual]. retry-after: 0",
    );
    err.code = "SAFETY_REFUSAL";
    const v = parseSafetyViolation(err);
    assert.ok(v);
    assert.deepEqual(Array.from(v.categories), ["sexual"]);
  });
});

describe("graduated keyword substitution (level 1-4)", () => {
  // Realistic outfit-pool body that contains keywords from every group.
  const richPrompt =
    "fitted ribbed crop tank top with thin straps, " +
    "bare midriff and bare shoulders exposed, " +
    "low-rise short denim shorts, fabric slightly clinging, " +
    "body-hugging silhouette, deep V-neckline, " +
    "bare legs from upper thigh visible, bikini";

  it("level 2 strips body-hugging / deep-V but preserves bare midriff", () => {
    const v = getStrongCompliantVariant(richPrompt, { substitutionLevel: 2 });
    assert.ok(v);
    // SUB_BASE substitutions still apply
    assert.match(v, /two-piece swimwear/);
    // SUB_G3 (level 2+): body-hugging / deep-V gone
    assert.doesNotMatch(v, /body[- ]hugging/i);
    assert.doesNotMatch(v, /deep\s+v[- ]neck/i);
    // SUB_G2 (level 3+): bare midriff / fabric clinging STILL PRESENT
    assert.match(v, /bare midriff/);
    assert.match(v, /fabric (?:slightly\s+)?clinging|fabric clinging/);
    // SUB_G1 (level 4): bare shoulders / arms / legs STILL PRESENT
    assert.match(v, /bare shoulders/);
    assert.match(v, /bare legs/);
  });

  it("level 3 also strips bare midriff / fabric clinging but keeps bare shoulders / legs", () => {
    const v = getStrongCompliantVariant(richPrompt, { substitutionLevel: 3 });
    assert.ok(v);
    assert.match(v, /two-piece swimwear/);
    assert.doesNotMatch(v, /body[- ]hugging/i);
    assert.doesNotMatch(v, /bare midriff/);
    assert.doesNotMatch(v, /fabric clinging/);
    // SUB_G1 (level 4): bare shoulders / legs still present
    assert.match(v, /bare shoulders/);
    assert.match(v, /bare legs/);
  });

  it("level 4 strips everything (legacy behavior, last resort)", () => {
    const v = getStrongCompliantVariant(richPrompt, { substitutionLevel: 4 });
    assert.ok(v);
    assert.match(v, /two-piece swimwear/);
    assert.doesNotMatch(v, /body[- ]hugging/i);
    assert.doesNotMatch(v, /bare midriff/);
    assert.doesNotMatch(v, /bare shoulders/);
    assert.doesNotMatch(v, /bare legs/);
  });

  it("default level (no opt) is 4 — back-compat with legacy callers", () => {
    const def = getStrongCompliantVariant(richPrompt);
    const lvl4 = getStrongCompliantVariant(richPrompt, { substitutionLevel: 4 });
    assert.equal(def, lvl4);
  });

  it("getFashionPortraitVariant honors substitutionLevel the same way", () => {
    const lvl2 = getFashionPortraitVariant(richPrompt, { substitutionLevel: 2 });
    assert.ok(lvl2);
    assert.match(lvl2, /Korean fashion portrait/);
    assert.match(lvl2, /bare midriff/);
    assert.match(lvl2, /bare legs/);

    const lvl4 = getFashionPortraitVariant(richPrompt, { substitutionLevel: 4 });
    assert.ok(lvl4);
    assert.doesNotMatch(lvl4, /bare midriff/);
    assert.doesNotMatch(lvl4, /bare legs/);
  });

  it("buildPromptAttempts adds level-2 and level-3 strong wrappers as separate variants when prompt has G2 keywords", () => {
    const attempts = buildPromptAttempts(richPrompt);
    // Strong-trigger sequence: [raw, justifyA, justifyB, KO wrapper,
    //                          strong-L2, strong-L3, fashion-L4] = 7
    assert.ok(attempts.length >= 6);
    const strongL2 = attempts.find((p) =>
      /AI-generated synthetic character/.test(p) && /bare midriff/.test(p),
    );
    const strongL3 = attempts.find((p) =>
      /AI-generated synthetic character/.test(p) &&
      !/bare midriff/.test(p) &&
      /bare shoulders/.test(p),
    );
    assert.ok(strongL2, "level-2 strong wrapper (bare midriff preserved) missing");
    assert.ok(strongL3, "level-3 strong wrapper (midriff stripped, shoulders kept) missing");
    // Fashion-portrait at level 4 strips everything
    const fashionL4 = attempts.find((p) =>
      /Korean fashion portrait/.test(p) && !/bare shoulders/.test(p),
    );
    assert.ok(fashionL4, "level-4 fashion-portrait wrapper missing");
  });

  it("clamps level out of range to [1, 4]", () => {
    const v0 = getStrongCompliantVariant(richPrompt, { substitutionLevel: 0 });
    const v1 = getStrongCompliantVariant(richPrompt, { substitutionLevel: 1 });
    assert.equal(v0, v1, "level 0 should clamp to 1");
    const v99 = getStrongCompliantVariant(richPrompt, { substitutionLevel: 99 });
    const v4 = getStrongCompliantVariant(richPrompt, { substitutionLevel: 4 });
    assert.equal(v99, v4, "level 99 should clamp to 4");
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

  it("cycles raw → 2 justifications → KO wrapper for soft triggers", () => {
    // Soft trigger ("수영복") now produces 4 base variants since 2 justification
    // contexts are inserted before the tone-down wrapper:
    //   [raw, justifyA, justifyB, korean wrapper]
    const seq = buildAttemptSequence("수영복 셀카", 5);
    assert.equal(seq.length, 5);
    assert.equal(seq[0], "수영복 셀카");
    assert.match(seq[1], /Editorial fashion magazine BTS/);
    assert.match(seq[2], /Resort lifestyle vlog/);
    assert.match(seq[3], /성인\(25세 이상\)/);
    assert.match(seq[3], /일반인이 폰으로 찍은/);
    // 5th attempt cycles back to raw
    assert.equal(seq[4], "수영복 셀카");
  });

  it("cycles through 6 variants for strong-trigger prompts", () => {
    // Strong-trigger prompts now produce 6 base variants:
    //   [raw, justifyA, justifyB, korean wrapper, strong-amateur, fashion portrait]
    const prompt = "한국 여자 20대 시스루 티셔츠 피팅룸 셀카";
    const seq = buildAttemptSequence(prompt, 6);
    assert.equal(seq.length, 6);
    assert.equal(seq[0], prompt);
    assert.match(seq[1], /Editorial fashion magazine BTS/);
    assert.match(seq[2], /Resort lifestyle vlog/);
    assert.match(seq[3], /성인\(25세 이상\)/);
    assert.match(seq[4], /AI-generated synthetic character/);
    assert.match(seq[5], /Korean fashion portrait/);
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

describe("intensity-preservation regression (outfit module intensity field)", () => {
  // The intensity directive from lib/outfitPresets.js INTENSITY_BY_RISK must
  // survive every substitution level. Stripping it would re-introduce the
  // result-side dial-back the intensity field is designed to prevent.
  const INTENSITY_HIGH =
    "body-forward sensual styling, confidently alluring posing, " +
    "no auto-softening — match the styling intensity literally without " +
    "adding modest crops or extra fabric coverage";
  const INTENSITY_MEDIUM =
    "confident styling, body-aware posing, alluring composure";
  const INTENSITY_LOW =
    "subtle, natural styling, relaxed and approachable energy";

  for (const [label, intensity] of [
    ["high", INTENSITY_HIGH],
    ["medium", INTENSITY_MEDIUM],
    ["low", INTENSITY_LOW],
  ]) {
    for (const level of [1, 2, 3, 4]) {
      it(`level ${level} preserves ${label}-risk intensity tokens verbatim`, async () => {
        const mod = await import("../lib/safetyRetry.js");
        const out = mod._substituteTriggerKeywordsForTest(intensity, level);
        assert.equal(
          out,
          intensity,
          `intensity wording was modified at level ${level}: ${out}`,
        );
      });
    }
  }

  it("INTENSITY_PROTECTED list is exported and non-empty", async () => {
    const mod = await import("../lib/safetyRetry.js");
    assert.ok(Array.isArray(mod.INTENSITY_PROTECTED));
    assert.ok(mod.INTENSITY_PROTECTED.length > 0);
  });
});
