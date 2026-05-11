import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("ima2 gen exposes UI parity options and sends them to /api/generate", () => {
  const gen = readFileSync("bin/commands/gen.js", "utf8");

  assert.match(gen, /format:\s*\{\s*type:\s*"string",\s*default:\s*"png"\s*\}/);
  assert.match(gen, /moderation:\s*\{\s*type:\s*"string",\s*default:\s*"low"\s*\}/);
  assert.match(gen, /"max-attempts":\s*\{\s*type:\s*"string",\s*default:\s*"7"\s*\}/);
  assert.match(gen, /requestId:\s*newRequestId\(\)/);
  assert.match(gen, /format:\s*format/);
  assert.match(gen, /moderation:\s*args\.moderation/);
  assert.match(gen, /maxAttempts/);
  assert.match(gen, /defaultOutName\(i,\s*norm\.images\.length,\s*outExt\)/);
});

test("ima2 edit sends moderation, maxAttempts, and requestId to /api/edit", () => {
  const edit = readFileSync("bin/commands/edit.js", "utf8");

  assert.match(edit, /moderation:\s*\{\s*type:\s*"string",\s*default:\s*"low"\s*\}/);
  assert.match(edit, /"max-attempts":\s*\{\s*type:\s*"string",\s*default:\s*"7"\s*\}/);
  assert.match(edit, /requestId:\s*newRequestId\(\)/);
  assert.match(edit, /moderation:\s*args\.moderation/);
  assert.match(edit, /maxAttempts/);
});
