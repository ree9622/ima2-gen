import { describe, it } from "node:test";
import assert from "node:assert";

import {
  buildCelebrityPrompt,
  getCelebrityPromptDefaults,
} from "../ui/src/lib/celebrityPrompt.ts";

describe("celebrity prompt builder", () => {
  it("builds a natural resort prompt from celebrity name and outfit", () => {
    const prompt = buildCelebrityPrompt({
      celebrityName: "장원영",
      groupName: "IVE",
      outfit: "검정 원피스 수영복 + 흰 린넨 셔츠",
      scene: "리조트 인피니티풀",
      tone: "natural",
      facePriority: "strong",
    });

    assert.match(prompt, /장원영-like public appearance/);
    assert.match(prompt, /not a generic Korean woman/);
    assert.match(prompt, /검정 원피스 수영복 \+ 흰 린넨 셔츠/);
    assert.match(prompt, /리조트 인피니티풀/);
    assert.match(prompt, /iPhone rear-camera/);
    assert.match(prompt, /realistic skin texture/);
    assert.match(prompt, /no beauty filter/);
    assert.match(prompt, /non-sexual resort fashion/i);
    assert.doesNotMatch(prompt, /8K|masterpiece|ultra realistic|glossy idol photoshoot/i);
  });

  it("uses stable defaults that can produce a ready prompt", () => {
    const defaults = getCelebrityPromptDefaults();
    const prompt = buildCelebrityPrompt({
      ...defaults,
      celebrityName: "카리나",
      outfit: "블랙 무대 의상",
    });

    assert.match(prompt, /카리나-like public appearance/);
    assert.match(prompt, /블랙 무대 의상/);
    assert.match(prompt, /portrait 4:5/);
  });
});
