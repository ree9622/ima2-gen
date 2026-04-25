import { describe, it } from "node:test";
import assert from "node:assert";

import { DEFAULT_PROMPT_INJECTION, withDefaultPrompt } from "../lib/defaultPrompt.js";

describe("Default prompt injection", () => {
  it("prepends the always-on prompt to a base developer prompt", () => {
    const merged = withDefaultPrompt("Base image instruction.");

    assert.ok(merged.startsWith(DEFAULT_PROMPT_INJECTION));
    assert.ok(merged.endsWith("Base image instruction."));
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
});
