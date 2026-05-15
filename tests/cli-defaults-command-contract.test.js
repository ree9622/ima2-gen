import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path) {
  return readFileSync(path, "utf-8");
}

describe("CLI defaults command contract", () => {
  it("defaults set model/reasoning writes OAuth and API provider keys together", () => {
    const src = readSource("bin/commands/defaults.ts");

    assert.match(src, /MODEL_KEYS = \["imageModels\.default", "apiProvider\.defaultImageModel"\]/);
    assert.match(src, /REASONING_KEYS = \["imageModels\.reasoningEffort", "apiProvider\.defaultReasoningEffort"\]/);
    assert.match(src, /validateModel\(value\)/);
    assert.match(src, /validateReasoning\(value\)/);
    assert.match(src, /setDefaults\(MODEL_KEYS, value\)/);
    assert.match(src, /setDefaults\(REASONING_KEYS, value\)/);
  });

  it("shared config-store owns writable keys and env override warnings", () => {
    const keys = readSource("lib/configKeys.ts");
    const store = readSource("bin/lib/config-store.ts");
    const configCmd = readSource("bin/commands/config.ts");

    assert.match(keys, /"apiProvider\.defaultImageModel"/);
    assert.match(keys, /"apiProvider\.defaultReasoningEffort"/);
    assert.match(keys, /"apiProvider\.defaultImageModel": "IMA2_API_IMAGE_MODEL_DEFAULT"/);
    assert.match(keys, /"apiProvider\.defaultReasoningEffort": "IMA2_API_REASONING_EFFORT"/);
    assert.match(store, /from "\.\.\/\.\.\/lib\/configKeys\.js"/);
    assert.match(configCmd, /from "\.\.\/lib\/config-store\.js"/);
    assert.match(configCmd, /isWritableConfigKey\(key\)/);
  });

  it("top-level CLI dispatch lets defaults and capabilities show their own help", () => {
    const src = readSource("bin/ima2.ts");

    assert.match(src, /defaults <sub> Inspect\/change model defaults/);
    assert.match(src, /capabilities\s+Agent capability metadata/);
    assert.match(src, /"defaults"/);
    assert.match(src, /"capabilities"/);
    assert.match(src, /case "defaults":/);
    assert.match(src, /case "capabilities":/);
  });
});
