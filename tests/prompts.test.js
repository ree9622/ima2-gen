// Prompt library CRUD + search (Phase 6.3). 임시 DB 파일에 격리된 환경에서
// roundtrip, 검색, 핀 정렬, use 카운트 증가, 권한 격리를 검증한다.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = mkdtempSync(join(tmpdir(), "ima2-prompt-test-"));
process.env.IMA2_DB_PATH = join(tmpDir, "test.db");

const {
  listPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  bumpPromptUse,
  _resetPromptsForTest,
  PROMPT_ERRORS,
  PROMPT_LIMITS,
} = await import("../lib/promptStore.js");

const { closeDb } = await import("../lib/db.js");

beforeEach(() => {
  _resetPromptsForTest();
});

after(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("createPrompt rejects empty body", () => {
  assert.equal(createPrompt({ body: "" }).error, PROMPT_ERRORS.BODY_REQUIRED);
  assert.equal(createPrompt({ body: "   " }).error, PROMPT_ERRORS.BODY_REQUIRED);
});

test("createPrompt rejects oversize body and title", () => {
  const big = "A".repeat(PROMPT_LIMITS.MAX_BODY + 1);
  assert.equal(createPrompt({ body: big }).error, PROMPT_ERRORS.BODY_TOO_LONG);
  const longTitle = "T".repeat(PROMPT_LIMITS.MAX_TITLE + 1);
  assert.equal(createPrompt({ title: longTitle, body: "ok" }).error, PROMPT_ERRORS.TITLE_TOO_LONG);
});

test("createPrompt happy path returns item with id and timestamps", () => {
  const r = createPrompt({ title: "shiba", body: "shiba in space" });
  assert.equal(r.error, undefined);
  assert.match(r.item.id, /^p_[a-f0-9]+$/);
  assert.equal(r.item.title, "shiba");
  assert.equal(r.item.body, "shiba in space");
  assert.equal(r.item.pinned, false);
  assert.equal(r.item.useCount, 0);
  assert.equal(r.item.lastUsedAt, null);
  assert.ok(r.item.createdAt > 0);
});

test("listPrompts orders pinned DESC, then last_used_at DESC, then created_at DESC", async () => {
  const a = createPrompt({ title: "a", body: "alpha" }).item;
  await sleep(2);
  const b = createPrompt({ title: "b", body: "beta" }).item;
  await sleep(2);
  const c = createPrompt({ title: "c", body: "gamma" }).item;

  // No use, no pin → newest first
  assert.deepEqual(listPrompts().map((p) => p.id), [c.id, b.id, a.id]);

  // Use 'a' once → 'a' should jump to top
  bumpPromptUse(a.id);
  assert.deepEqual(listPrompts().map((p) => p.id), [a.id, c.id, b.id]);

  // Pin 'b' → 'b' on top regardless of use
  updatePrompt(b.id, { pinned: true });
  assert.deepEqual(listPrompts().map((p) => p.id), [b.id, a.id, c.id]);
});

test("listPrompts q matches title and body (case insensitive, NFC)", () => {
  createPrompt({ title: "Shiba", body: "in space" });
  createPrompt({ title: "Cat", body: "shiba inu reference" });
  createPrompt({ title: "Other", body: "totally different" });

  const r = listPrompts({ q: "shiba" });
  assert.equal(r.length, 2);

  const r2 = listPrompts({ q: "TOTALLY" });
  assert.equal(r2.length, 1);

  const r3 = listPrompts({ q: "" });
  assert.equal(r3.length, 3);
});

test("listPrompts q is LIKE-escaped (no SQL injection / wildcard leak)", () => {
  createPrompt({ body: "100% pure" });
  createPrompt({ body: "literally a percent sign here %" });
  createPrompt({ body: "underscore_test" });

  // Searching for '%' should match only rows literally containing '%'
  const r = listPrompts({ q: "%" });
  assert.equal(r.length, 2); // both rows with literal '%'

  const r2 = listPrompts({ q: "_test" });
  assert.equal(r2.length, 1);
});

test("listPrompts caps limit", () => {
  for (let i = 0; i < 10; i++) createPrompt({ body: `body ${i}` });
  const r = listPrompts({ limit: 3 });
  assert.equal(r.length, 3);
  // limit > MAX_LIMIT clamps
  const all = listPrompts({ limit: 999 });
  assert.equal(all.length, 10);
});

test("updatePrompt patches title/body/pinned and bumps updated_at", async () => {
  const created = createPrompt({ body: "original" }).item;
  await sleep(2);
  const r = updatePrompt(created.id, { title: "new title", pinned: true });
  assert.equal(r.error, undefined);
  assert.equal(r.item.title, "new title");
  assert.equal(r.item.pinned, true);
  assert.ok(r.item.updatedAt > created.updatedAt);
});

test("updatePrompt rejects empty body in patch", () => {
  const created = createPrompt({ body: "x" }).item;
  assert.equal(updatePrompt(created.id, { body: "  " }).error, PROMPT_ERRORS.BODY_REQUIRED);
});

test("updatePrompt no-op patch returns existing item", () => {
  const created = createPrompt({ body: "x" }).item;
  const r = updatePrompt(created.id, {});
  assert.deepEqual(r.item, created);
});

test("deletePrompt removes the row", () => {
  const created = createPrompt({ body: "tmp" }).item;
  deletePrompt(created.id);
  assert.equal(getPrompt(created.id).error, PROMPT_ERRORS.NOT_FOUND);
});

test("bumpPromptUse increments count and sets lastUsedAt", async () => {
  const created = createPrompt({ body: "x" }).item;
  await sleep(2);
  const r = bumpPromptUse(created.id);
  assert.equal(r.useCount, 1);
  assert.ok(r.lastUsedAt > created.createdAt);
  bumpPromptUse(created.id);
  assert.equal(getPrompt(created.id).item.useCount, 2);
});

test("not found errors propagate consistently", () => {
  assert.equal(getPrompt("p_nope").error, PROMPT_ERRORS.NOT_FOUND);
  assert.equal(updatePrompt("p_nope", { title: "x" }).error, PROMPT_ERRORS.NOT_FOUND);
  assert.equal(deletePrompt("p_nope").error, PROMPT_ERRORS.NOT_FOUND);
  assert.equal(bumpPromptUse("p_nope").error, PROMPT_ERRORS.NOT_FOUND);
});

test("owner isolation — listPrompts filters by owner, getPrompt rejects cross-owner", () => {
  createPrompt({ body: "alice's", owner: "alice" });
  createPrompt({ body: "bob's", owner: "bob" });
  assert.equal(listPrompts({ owner: "alice" }).length, 1);
  assert.equal(listPrompts({ owner: "bob" }).length, 1);
  // Without owner filter, all rows visible (admin / single-user mode)
  assert.equal(listPrompts().length, 2);

  const aliceItem = listPrompts({ owner: "alice" })[0];
  assert.equal(getPrompt(aliceItem.id, { owner: "bob" }).error, PROMPT_ERRORS.FORBIDDEN);
  assert.equal(getPrompt(aliceItem.id, { owner: "alice" }).item.body, "alice's");
});

test("UTF-8 Korean prompts roundtrip", () => {
  const r = createPrompt({ title: "한글 시바", body: "우주를 나는 시바견, 마스터피스" });
  assert.equal(r.item.title, "한글 시바");
  assert.equal(r.item.body, "우주를 나는 시바견, 마스터피스");
  const found = listPrompts({ q: "시바견" });
  assert.equal(found.length, 1);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
