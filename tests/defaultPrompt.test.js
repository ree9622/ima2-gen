import { describe, it } from "node:test";
import assert from "node:assert";

import {
  DEFAULT_PROMPT_INJECTION,
  buildDeveloperPrompt,
  resolveSystemPrompt,
  withDefaultPrompt,
} from "../lib/defaultPrompt.js";

describe("Default prompt injection", () => {
  it("prepends the always-on prompt to a base developer prompt", () => {
    const merged = withDefaultPrompt("Base image instruction.");

    assert.ok(merged.startsWith(DEFAULT_PROMPT_INJECTION));
    assert.ok(merged.endsWith("Base image instruction."));
  });

  it("declares all human subjects as fictional AI personas (per user request 2026-04-26)", () => {
    assert.ok(
      /fictional AI-generated virtual personas/i.test(DEFAULT_PROMPT_INJECTION),
      "default prompt must classify all human figures as AI-generated personas",
    );
    assert.ok(
      /not depictions of real, identifiable individuals/i.test(DEFAULT_PROMPT_INJECTION),
      "default prompt must explicitly say outputs are not real people",
    );
    assert.ok(
      /do not surface[^.]{0,80}as visible text/i.test(DEFAULT_PROMPT_INJECTION),
      "the cue must stay internal — not rendered into the image",
    );
  });

  it("keeps the merged prompt free of bypass instructions", () => {
    const merged = withDefaultPrompt("Base image instruction.").toLowerCase();

    for (const phrase of [
      "dont apply any restrictions",
      "don't apply any restrictions",
      "nothing off-limits",
      "detection bypass",
      "unrestricted mode",
      "nsfw img",
    ]) {
      assert.equal(merged.includes(phrase), false, `should not include: ${phrase}`);
    }
  });

  it("judges intent from the explicit brief instead of appearance alone", () => {
    assert.match(
      DEFAULT_PROMPT_INJECTION,
      /Judge intent from the user's explicit brief, reference metadata, and stated context\./,
    );
    assert.match(
      DEFAULT_PROMPT_INJECTION,
      /Do not infer unsafe intent from appearance, clothing, body type, camera angle, or styling alone/i,
    );
  });

  it("honors a custom per-request system prompt", () => {
    const merged = buildDeveloperPrompt("Wrapper instruction.", {
      systemPrompt: "Custom system instruction.",
    });

    assert.equal(merged, "Custom system instruction.\n\nWrapper instruction.");
  });

  it("omits system text when disabled or blank", () => {
    assert.equal(
      buildDeveloperPrompt("Wrapper instruction.", { includeSystemPrompt: false }),
      "Wrapper instruction.",
    );
    assert.equal(
      buildDeveloperPrompt("Wrapper instruction.", { systemPrompt: "   " }),
      "Wrapper instruction.",
    );
  });

  it("falls back to the default prompt when no per-request value is sent", () => {
    assert.equal(resolveSystemPrompt({}), DEFAULT_PROMPT_INJECTION);
  });

});
