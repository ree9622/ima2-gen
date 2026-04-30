import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isValidBatchId,
  ensureBatchMeta,
  appendBatchEntry,
  readBatch,
  listBatches,
  closeBatch,
  summarizeBatch,
} from "../lib/batchLog.js";

async function makeTempGeneratedDir() {
  const dir = await mkdtemp(join(tmpdir(), "ima2-batch-"));
  return dir;
}

test("isValidBatchId accepts UUID/short tokens, rejects unsafe input", () => {
  assert.equal(isValidBatchId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidBatchId("txt_1727440000_abc12"), true);
  assert.equal(isValidBatchId("a"), true);
  // Path traversal / shell injection attempts
  assert.equal(isValidBatchId("../etc/passwd"), false);
  assert.equal(isValidBatchId("foo/bar"), false);
  assert.equal(isValidBatchId("foo bar"), false);
  assert.equal(isValidBatchId(""), false);
  assert.equal(isValidBatchId(null), false);
  assert.equal(isValidBatchId(undefined), false);
  assert.equal(isValidBatchId(123), false);
  // Length cap (80 char)
  assert.equal(isValidBatchId("x".repeat(80)), true);
  assert.equal(isValidBatchId("x".repeat(81)), false);
});

test("ensureBatchMeta + appendBatchEntry + readBatch round trip", async () => {
  const generatedDir = await makeTempGeneratedDir();
  try {
    const batchId = "test-batch-001";
    await ensureBatchMeta({
      generatedDir,
      batchId,
      batchTotal: 3,
      startedAt: 1000,
      owner: "alice",
      source: "txt-batch",
    });
    await appendBatchEntry({
      generatedDir,
      batchId,
      batchIndex: 2,
      entry: {
        ok: true,
        promptChars: 50,
        usage: { input_tokens: 100, output_tokens: 50 },
        attemptsCount: 1,
      },
    });
    await appendBatchEntry({
      generatedDir,
      batchId,
      batchIndex: 0,
      entry: {
        ok: false,
        promptChars: 30,
        errorCode: "AUTH_INVALIDATED",
        attemptsCount: 1,
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    });

    const result = await readBatch({ generatedDir, batchId });
    assert.equal(result.meta.batchId, batchId);
    assert.equal(result.meta.batchTotal, 3);
    assert.equal(result.meta.owner, "alice");
    assert.equal(result.meta.source, "txt-batch");
    // entries sorted by batchIndex
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].batchIndex, 0);
    assert.equal(result.entries[1].batchIndex, 2);
    assert.equal(result.entries[0].errorCode, "AUTH_INVALIDATED");
    assert.equal(result.entries[1].ok, true);
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("readBatch returns null for unknown batchId, ignores invalid id", async () => {
  const generatedDir = await makeTempGeneratedDir();
  try {
    assert.equal(await readBatch({ generatedDir, batchId: "../../etc" }), null);
    assert.equal(await readBatch({ generatedDir, batchId: "no-such-batch" }), null);
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("appendBatchEntry uses 0-padded indices so dirent listing sorts correctly", async () => {
  const generatedDir = await makeTempGeneratedDir();
  try {
    const batchId = "pad-test";
    await ensureBatchMeta({ generatedDir, batchId, batchTotal: 30, startedAt: 1 });
    for (const idx of [0, 5, 31, 100]) {
      await appendBatchEntry({
        generatedDir,
        batchId,
        batchIndex: idx,
        entry: { ok: true, batchIndex: idx },
      });
    }
    const dir = join(generatedDir, ".batches", batchId);
    const names = (await readdir(dir)).filter((n) => n !== "_meta.json").sort();
    assert.deepEqual(names, ["00000.json", "00005.json", "00031.json", "00100.json"]);
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("summarizeBatch counts ok / failed / attempts / usage / reasons", () => {
  const summary = summarizeBatch([
    { ok: true, attemptsCount: 1, usage: { input_tokens: 100, output_tokens: 50 } },
    { ok: true, attemptsCount: 2, usage: { input_tokens: 200, output_tokens: 80 } },
    { ok: false, attemptsCount: 5, errorCode: "AUTH_INVALIDATED", usage: { input_tokens: 30 } },
    { ok: false, attemptsCount: 5, errorCode: "AUTH_INVALIDATED" },
    { ok: false, attemptsCount: 1, errorCode: "SAFETY_REFUSAL" },
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 3);
  assert.equal(summary.totalAttempts, 14);
  assert.equal(summary.totalUsage.input_tokens, 330);
  assert.equal(summary.totalUsage.output_tokens, 130);
  assert.deepEqual(summary.reasons, {
    AUTH_INVALIDATED: 2,
    SAFETY_REFUSAL: 1,
  });
});

test("summarizeBatch handles empty entries", () => {
  const summary = summarizeBatch([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.totalAttempts, 0);
  assert.equal(summary.totalUsage, null);
  assert.deepEqual(summary.reasons, {});
});

test("closeBatch stamps _meta.completedAt + _meta.summary, returns summary", async () => {
  const generatedDir = await makeTempGeneratedDir();
  try {
    const batchId = "close-test";
    await ensureBatchMeta({ generatedDir, batchId, batchTotal: 2, startedAt: 1000 });
    await appendBatchEntry({
      generatedDir,
      batchId,
      batchIndex: 0,
      entry: { ok: true, attemptsCount: 1, usage: { input_tokens: 50 } },
    });
    await appendBatchEntry({
      generatedDir,
      batchId,
      batchIndex: 1,
      entry: { ok: false, attemptsCount: 5, errorCode: "AUTH_INVALIDATED" },
    });

    const closed = await closeBatch({ generatedDir, batchId });
    assert.ok(closed);
    assert.equal(closed.summary.total, 2);
    assert.equal(closed.summary.succeeded, 1);
    assert.equal(closed.summary.failed, 1);
    assert.equal(closed.summary.totalAttempts, 6);
    assert.ok(closed.meta.completedAt > 0);
    assert.equal(closed.meta.summary.failed, 1);

    // _meta.json on disk should have the summary persisted
    const onDisk = JSON.parse(
      await readFile(join(generatedDir, ".batches", batchId, "_meta.json"), "utf8"),
    );
    assert.equal(onDisk.summary.total, 2);
    assert.ok(onDisk.completedAt > 0);
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("listBatches returns most-recent first with meta", async () => {
  const generatedDir = await makeTempGeneratedDir();
  try {
    await ensureBatchMeta({
      generatedDir,
      batchId: "old-one",
      batchTotal: 5,
      startedAt: 1000,
      owner: "alice",
    });
    // small delay to ensure stat mtime differs
    await new Promise((r) => setTimeout(r, 10));
    await ensureBatchMeta({
      generatedDir,
      batchId: "new-one",
      batchTotal: 3,
      startedAt: 2000,
      owner: "bob",
    });
    const batches = await listBatches({ generatedDir, limit: 10 });
    assert.equal(batches.length, 2);
    assert.equal(batches[0].batchId, "new-one");
    assert.equal(batches[1].batchId, "old-one");
    assert.equal(batches[0].owner, "bob");
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});

test("ensureBatchMeta is idempotent — first call wins", async () => {
  const generatedDir = await makeTempGeneratedDir();
  try {
    const batchId = "idempotent-test";
    await ensureBatchMeta({
      generatedDir,
      batchId,
      batchTotal: 31,
      startedAt: 1000,
      owner: "first",
    });
    // Second call with different total should NOT overwrite
    await ensureBatchMeta({
      generatedDir,
      batchId,
      batchTotal: 999,
      startedAt: 2000,
      owner: "second",
    });
    const result = await readBatch({ generatedDir, batchId });
    assert.equal(result.meta.batchTotal, 31);
    assert.equal(result.meta.startedAt, 1000);
    assert.equal(result.meta.owner, "first");
  } finally {
    await rm(generatedDir, { recursive: true, force: true });
  }
});
