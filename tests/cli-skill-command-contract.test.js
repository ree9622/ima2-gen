import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI packaged skill contract", () => {
  it("ships a Markdown ima2 skill with agent usage guidance", () => {
    const skill = readSource("skills/ima2/SKILL.md");

    assert.match(skill, /name:\s*ima2/);
    assert.match(skill, /ima2 capabilities --json/);
    assert.match(skill, /ima2 defaults --json/);
    assert.match(skill, /ima2 edit input\.png --prompt/);
    assert.match(skill, /--quality high/);
    assert.match(skill, /There is no `--parallel` flag/);
    assert.match(skill, /generic OpenAI image-generation/);
    assert.match(skill, /GPT Image 2/);
    assert.match(skill, /exact words in the target language/);
    assert.match(skill, /reduce garbled lettering/);
    assert.match(skill, /manga panel/);
    assert.match(skill, /webtoon style/);
    assert.match(skill, /photorealistic product photo/);
    assert.match(skill, /not a typesetting engine/);
  });

  it("documents Grok video continuity contracts and audio prompt controls", () => {
    const skill = readSource("skills/ima2/SKILL.md");

    assert.match(skill, /reference-to-video \| 10s/);
    assert.match(skill, /does not support `reference_images` Ref2V/);
    assert.match(skill, /supports image-to-video/);
    assert.match(skill, /requestedModel/);
    assert.match(skill, /effectiveModel/);
    assert.match(skill, /modelFallback/);
    assert.match(skill, /Structured Video Prompt Template/);
    assert.match(skill, /Expected Motion/);
    assert.match(skill, /Dialogue/);
    assert.match(skill, /Ending Frame/);
    assert.match(skill, /no background music/);
    assert.match(skill, /Sound Effects/);
    assert.match(skill, /Continuity Handoff/);
    assert.match(skill, /Video edit\/extend: grok-imagine-video only/);
  });

  it("skill command wraps Markdown content instead of inventing a schema skill", () => {
    const src = readSource("bin/commands/skill.ts");

    assert.match(src, /SKILL_PATH = join\(ROOT, "skills", "ima2", "SKILL\.md"\)/);
    assert.match(src, /format:\s*"markdown-skill"/);
    assert.match(src, /formatVersion:\s*"1"/);
    assert.match(src, /packageVersion: readPackageVersion\(\)/);
    assert.match(src, /content,/);
    assert.match(src, /packaged skill not found/);
  });

  it("top-level CLI dispatch lets skill help reach the subcommand", () => {
    const src = readSource("bin/ima2.ts");

    assert.match(src, /skill\s+Print packaged agent skill/);
    assert.match(src, /"skill"/);
    assert.match(src, /case "skill":/);
  });
});
