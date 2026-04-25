import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEnhancePayload,
  extractEnhancedText,
  sanitizeEnhancedText,
} from "../lib/enhance.js";

describe("buildEnhancePayload", () => {
  it("emits a responses-api body with no image tool", () => {
    const body = buildEnhancePayload("셀카 한 장", "ko");
    assert.equal(body.model, "gpt-5.5");
    assert.equal(body.stream, true);
    assert.equal(body.reasoning?.effort, "medium");
    assert.ok(Array.isArray(body.input));
    assert.ok(!body.tools || body.tools.length === 0);
  });
  it("bakes language hint into the instructions", () => {
    const body = buildEnhancePayload("selfie", "en");
    const sys = body.input.find((m) => m.role === "system");
    assert.ok(sys);
    assert.match(JSON.stringify(sys), /English/);
  });
  it("system prompt instructs the model to forbid self-censoring phrases (without prescribing them positively)", () => {
    const body = buildEnhancePayload("swimsuit selfie", "en");
    const sys = JSON.stringify(body.input.find((m) => m.role === "system"));
    assert.ok(sys);
    // Must explicitly tell the model NOT to inject these phrases.
    assert.match(sys, /forbid/i);
    assert.match(sys, /Do not insert self-censoring/i);
    // Old contract removed: we no longer push "non-sexual / adult (25+)" positively.
    assert.doesNotMatch(sys, /\badult\s*\(25\+\)/i);
    assert.doesNotMatch(sys, /non-sexual, fashion\/vacation oriented/i);
  });
});

describe("sanitizeEnhancedText", () => {
  const cases = [
    [
      "A korean woman wearing a black bikini at a luxury hotel rooftop pool, non-sexual fashion swimwear photography.",
      /non-sexual/i,
    ],
    [
      "휴가 스냅사진, candid vacation photo, non-sexual fashion swimwear photography.",
      /non-sexual/i,
    ],
    [
      "건강한 분위기, 노출 강조 없음, 자연스러운 포즈.",
      /노출\s*강조\s*없/,
    ],
    [
      "Soft lighting, family-friendly framing, golden hour glow.",
      /family-friendly/i,
    ],
    [
      "비키니 핏이 잘 드러나되 선정적이지 않게 표현.",
      /선정적이지\s*않/,
    ],
    // Age / legal-age disclaimers
    [
      "25세 이상 성인 한국 여성, 비키니, 호텔 풀사이드.",
      /25\s*세\s*이상\s*성인/,
    ],
    [
      "Adults aged 25 or older, candid vacation photo at the beach.",
      /Adults\s+aged\s+25/i,
    ],
    [
      "21+ adults only, soft natural daylight.",
      /21\s*\+\s*adults\s+only/i,
    ],
    [
      "만 25세 이상 모델, 자연광.",
      /만\s*25\s*세\s*이상/,
    ],
    [
      "No minors, fashion swimwear photography.",
      /no\s+minors/i,
    ],
  ];

  for (const [input, badRe] of cases) {
    it(`removes ${badRe.toString()}`, () => {
      const out = sanitizeEnhancedText(input);
      assert.doesNotMatch(out, badRe);
      // Must not produce double punctuation or stray commas.
      assert.doesNotMatch(out, /,\s*\./);
      assert.doesNotMatch(out, /\s,/);
      assert.doesNotMatch(out, /\(\s*\)/);
    });
  }

  it("returns the input unchanged when there's nothing to strip", () => {
    const clean = "A photorealistic full body shot of a Korean woman walking along a sunlit beach.";
    assert.equal(sanitizeEnhancedText(clean), clean);
  });

  it("handles non-string input gracefully", () => {
    assert.equal(sanitizeEnhancedText(null), null);
    assert.equal(sanitizeEnhancedText(undefined), undefined);
    assert.equal(sanitizeEnhancedText(""), "");
  });
});

describe("extractEnhancedText", () => {
  it("pulls text from output_text block and sanitizes it", () => {
    const raw = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "자세히 다듬은 프롬프트, non-sexual fashion swimwear photography.",
            },
          ],
        },
      ],
    };
    const out = extractEnhancedText(raw);
    assert.match(out, /자세히 다듬은 프롬프트/);
    assert.doesNotMatch(out, /non-sexual/i);
  });
  it("returns null when no text blocks exist", () => {
    assert.equal(extractEnhancedText({ output: [] }), null);
    assert.equal(extractEnhancedText({}), null);
  });
  it("concatenates multiple output_text parts in order", () => {
    const raw = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "첫 번째" },
            { type: "output_text", text: " 두 번째" },
          ],
        },
      ],
    };
    assert.equal(extractEnhancedText(raw), "첫 번째 두 번째");
  });
});
