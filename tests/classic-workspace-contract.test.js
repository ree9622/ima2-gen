import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateBackground, validateCompression } from "../lib/validate.js";

test("image output options validate official ranges", () => {
  for (const value of ["auto", "opaque", "transparent"]) {
    assert.deepEqual(validateBackground(value), { ok: true, value });
  }
  assert.equal(validateBackground("clear").code, "INVALID_BACKGROUND");
  assert.deepEqual(validateCompression(0), { ok: true, value: 0 });
  assert.deepEqual(validateCompression(100), { ok: true, value: 100 });
  assert.equal(validateCompression(101).code, "INVALID_COMPRESSION");
  assert.equal(validateCompression(12.5).code, "INVALID_COMPRESSION");
});

test("classic generation exposes progressive previews before POST completion", () => {
  const api = readFileSync("ui/src/lib/api.ts", "utf8");
  const store = readFileSync("ui/src/store/useAppStore.ts", "utf8");
  const server = readFileSync("server.js", "utf8");
  const subscribeAt = api.indexOf("subscribeToJob(payload.requestId");
  const postAt = api.indexOf("return await postGenerate(payload)", subscribeAt);
  assert.ok(subscribeAt > 0 && postAt > subscribeAt);
  assert.match(store, /postGenerateWithProgress/);
  assert.match(store, /partialImages:\s*2/);
  assert.match(server, /publishJobEvent\(eventOwner, requestId, "partial"/);
});

test("classic editor sends masks and keeps response-chain context", () => {
  const server = readFileSync("server.js", "utf8");
  const editor = readFileSync("ui/src/components/EditWorkspaceModal.tsx", "utf8");
  assert.match(server, /input_image_mask:\s*\{ image_url:/);
  assert.match(server, /previous_response_id:\s*previousResponseId/);
  assert.match(server, /action:\s*"edit"/);
  assert.match(editor, /"whole" \| "area" \| "outpaint"/);
  assert.match(editor, /되돌리기/);
  assert.match(editor, /다시 실행/);
});

test("official image output fields and reference roles reach the tool", () => {
  const server = readFileSync("server.js", "utf8");
  const composer = readFileSync("ui/src/components/PromptComposer.tsx", "utf8");
  assert.match(server, /output_format:\s*outputFormat/);
  assert.match(server, /output_compression:\s*compression/);
  assert.match(server, /background,/);
  assert.match(server, /Reference image roles:/);
  assert.match(composer, /포즈·구도/);
  assert.match(composer, /제품·로고/);
});

test("classic history strip stays bounded while the gallery remains paged", () => {
  const strip = readFileSync("ui/src/components/HistoryStrip.tsx", "utf8");
  const store = readFileSync("ui/src/store/useAppStore.ts", "utf8");
  assert.match(strip, /history\.slice\(0, 40\)/);
  assert.match(store, /HISTORY_INITIAL_LIMIT = 50/);
  assert.match(store, /HISTORY_PAGE_LIMIT = 100/);
});
