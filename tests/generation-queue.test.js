import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "ima2-generation-queue-"));
process.env.IMA2_DB_PATH = join(tmpDir, "sessions.db");

const {
  enqueueGenerationJob,
  claimNextGenerationJob,
  completeGenerationJob,
  failGenerationJob,
  cancelGenerationJob,
  recoverQueuedGenerationJobs,
  listGenerationJobs,
  _resetGenerationQueueForTests,
} = await import("../lib/generationQueue.js");
const { closeDb } = await import("../lib/db.js");

describe("durable generation queue", () => {
  beforeEach(() => _resetGenerationQueueForTests());
  after(() => {
    closeDb();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("claims queued jobs in FIFO order", () => {
    enqueueGenerationJob({ requestId: "a", prompt: "first", payload: { prompt: "first" } });
    enqueueGenerationJob({ requestId: "b", prompt: "second", payload: { prompt: "second" } });

    const first = claimNextGenerationJob();
    assert.equal(first.requestId, "a");
    assert.equal(first.status, "running");
    assert.equal(first.runCount, 1);

    const second = claimNextGenerationJob();
    assert.equal(second.requestId, "b");
  });

  it("stores terminal success and failure without deleting rows", () => {
    enqueueGenerationJob({ requestId: "ok", prompt: "x", payload: { prompt: "x" } });
    claimNextGenerationJob();
    completeGenerationJob("ok", { filename: "x.png" });

    enqueueGenerationJob({ requestId: "bad", prompt: "y", payload: { prompt: "y" } });
    claimNextGenerationJob();
    failGenerationJob("bad", { code: "NOPE", message: "failed" });

    const jobs = listGenerationJobs();
    assert.equal(jobs.find((j) => j.requestId === "ok").status, "succeeded");
    assert.equal(jobs.find((j) => j.requestId === "bad").status, "failed");
    assert.equal(jobs.find((j) => j.requestId === "bad").error.code, "NOPE");
  });

  it("recovers running rows to queued after a process restart", () => {
    enqueueGenerationJob({ requestId: "r", prompt: "x", payload: { prompt: "x" } });
    claimNextGenerationJob();
    assert.equal(listGenerationJobs()[0].status, "running");

    const recovered = recoverQueuedGenerationJobs();
    assert.equal(recovered, 1);
    const [job] = listGenerationJobs();
    assert.equal(job.status, "queued");
    assert.equal(job.phase, "queued");
  });

  it("cancels queued jobs before they are claimed", () => {
    enqueueGenerationJob({ requestId: "c", prompt: "x", payload: { prompt: "x" } });
    assert.equal(cancelGenerationJob("c"), true);
    assert.equal(claimNextGenerationJob(), null);
    assert.equal(listGenerationJobs()[0].status, "canceled");
  });
});
