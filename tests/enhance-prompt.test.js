import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEnhancePayload, extractEnhancedText } from "../lib/enhance.js";

describe("buildEnhancePayload", () => {
  it("emits a responses-api body with no image tool", () => {
    const body = buildEnhancePayload("셀카 한 장", "ko");
    assert.equal(body.model, "gpt-5.4");
    assert.equal(body.stream, false);
    assert.ok(Array.isArray(body.input));
    assert.ok(!body.tools || body.tools.length === 0);
  });
  it("bakes language hint into the instructions", () => {
    const body = buildEnhancePayload("selfie", "en");
    const sys = body.input.find((m) => m.role === "system");
    assert.ok(sys);
    assert.match(JSON.stringify(sys), /English/);
  });
  it("keeps swimwear enhancement in adult non-sexual framing", () => {
    const body = buildEnhancePayload("swimsuit selfie", "en");
    const sys = body.input.find((m) => m.role === "system");
    assert.ok(sys);
    assert.match(JSON.stringify(sys), /adult \(25\+\)/);
    assert.match(JSON.stringify(sys), /non-sexual/);
    assert.match(JSON.stringify(sys), /minors/);
  });
});

describe("extractEnhancedText", () => {
  it("pulls text from output_text block", () => {
    const raw = {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "자세히 다듬은 프롬프트" }],
        },
      ],
    };
    assert.equal(extractEnhancedText(raw), "자세히 다듬은 프롬프트");
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
