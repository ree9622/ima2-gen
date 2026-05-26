import { getDb } from "./db.js";
import { logEvent } from "./logger.js";

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

function nowMs() {
  return Date.now();
}

function safeJson(value, fallback = {}) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function rowToJob(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    kind: row.kind || "classic",
    owner: row.owner || null,
    prompt: row.prompt || "",
    payload: safeJson(row.payload),
    meta: safeJson(row.meta),
    status: row.status || "queued",
    phase: row.phase || "queued",
    result: safeJson(row.result, null),
    error: safeJson(row.error, null),
    runCount: Number(row.run_count) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    startedAt: row.started_at == null ? null : Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  };
}

export function enqueueGenerationJob({
  requestId,
  kind = "classic",
  owner = null,
  prompt = "",
  payload = {},
  meta = {},
}) {
  if (!requestId) throw new Error("requestId required");
  const t = nowMs();
  const normalizedPayload = normalizeObject(payload);
  const normalizedMeta = normalizeObject(meta);
  const db = getDb();
  const existing = getGenerationJob(requestId);
  if (existing && !TERMINAL.has(existing.status)) return existing;
  db.prepare(`
    INSERT OR REPLACE INTO generation_queue (
      request_id, kind, owner, prompt, payload, meta,
      status, phase, result, error, run_count,
      created_at, updated_at, started_at, finished_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'queued', 'queued', NULL, NULL, 0, ?, ?, NULL, NULL)
  `).run(
    requestId,
    kind,
    owner,
    typeof prompt === "string" ? prompt.slice(0, 500) : "",
    JSON.stringify(normalizedPayload),
    JSON.stringify(normalizedMeta),
    t,
    t,
  );
  logEvent("generation_queue", "enqueue", { requestId, kind, owner });
  return getGenerationJob(requestId);
}

export function getGenerationJob(requestId) {
  if (!requestId) return null;
  const row = getDb()
    .prepare("SELECT * FROM generation_queue WHERE request_id = ?")
    .get(requestId);
  return rowToJob(row);
}

export function claimNextGenerationJob(kind = "classic") {
  const db = getDb();
  const t = nowMs();
  const tx = db.transaction(() => {
    const row = db
      .prepare(`
        SELECT * FROM generation_queue
        WHERE status = 'queued' AND kind = ?
        ORDER BY created_at ASC
        LIMIT 1
      `)
      .get(kind);
    if (!row) return null;
    const res = db
      .prepare(`
        UPDATE generation_queue
        SET status = 'running',
            phase = 'running',
            run_count = run_count + 1,
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE request_id = ? AND status = 'queued'
      `)
      .run(t, t, row.request_id);
    if (res.changes !== 1) return null;
    return row.request_id;
  });
  const requestId = tx();
  return requestId ? getGenerationJob(requestId) : null;
}

export function setGenerationJobPhase(requestId, phase) {
  if (!requestId || typeof phase !== "string" || !phase) return;
  const t = nowMs();
  const res = getDb()
    .prepare(`
      UPDATE generation_queue
      SET phase = ?, updated_at = ?
      WHERE request_id = ? AND status IN ('queued', 'running')
    `)
    .run(phase, t, requestId);
  if (res.changes > 0) {
    logEvent("generation_queue", "phase", { requestId, phase });
  }
}

export function requeueGenerationJob(requestId) {
  if (!requestId) return false;
  const t = nowMs();
  const res = getDb()
    .prepare(`
      UPDATE generation_queue
      SET status = 'queued',
          phase = 'queued',
          updated_at = ?,
          started_at = NULL
      WHERE request_id = ? AND status = 'running'
    `)
    .run(t, requestId);
  return res.changes > 0;
}

export function completeGenerationJob(requestId, result = {}) {
  if (!requestId) return false;
  const t = nowMs();
  const res = getDb()
    .prepare(`
      UPDATE generation_queue
      SET status = 'succeeded',
          phase = 'done',
          result = ?,
          error = NULL,
          updated_at = ?,
          finished_at = ?
      WHERE request_id = ? AND status != 'canceled'
    `)
    .run(JSON.stringify(normalizeObject(result)), t, t, requestId);
  if (res.changes > 0) logEvent("generation_queue", "complete", { requestId });
  return res.changes > 0;
}

export function failGenerationJob(requestId, error = {}) {
  if (!requestId) return false;
  const t = nowMs();
  const normalizedError = error instanceof Error
    ? { message: error.message, code: error.code || null, status: error.status || null }
    : normalizeObject(error);
  const res = getDb()
    .prepare(`
      UPDATE generation_queue
      SET status = 'failed',
          phase = 'error',
          error = ?,
          updated_at = ?,
          finished_at = ?
      WHERE request_id = ? AND status != 'canceled'
    `)
    .run(JSON.stringify(normalizedError), t, t, requestId);
  if (res.changes > 0) {
    logEvent("generation_queue", "fail", {
      requestId,
      errorCode: normalizedError.code || null,
      errorMessage: normalizedError.message || null,
    });
  }
  return res.changes > 0;
}

export function cancelGenerationJob(requestId) {
  if (!requestId) return false;
  const t = nowMs();
  const res = getDb()
    .prepare(`
      UPDATE generation_queue
      SET status = 'canceled',
          phase = 'canceled',
          updated_at = ?,
          finished_at = ?
      WHERE request_id = ? AND status IN ('queued', 'running')
    `)
    .run(t, t, requestId);
  if (res.changes > 0) logEvent("generation_queue", "cancel", { requestId });
  return res.changes > 0;
}

export function recoverQueuedGenerationJobs() {
  const t = nowMs();
  const res = getDb()
    .prepare(`
      UPDATE generation_queue
      SET status = 'queued',
          phase = 'queued',
          updated_at = ?,
          started_at = NULL
      WHERE status = 'running'
    `)
    .run(t);
  if (res.changes > 0) {
    logEvent("generation_queue", "recover_running", { count: res.changes });
  }
  return res.changes;
}

export function listGenerationJobs(filters = {}) {
  const { status, kind, owner = null, updatedSince, limit } = filters;
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (kind) {
    clauses.push("kind = ?");
    params.push(kind);
  }
  if (owner) {
    clauses.push("owner = ?");
    params.push(owner);
  }
  if (Number.isFinite(Number(updatedSince))) {
    clauses.push("updated_at >= ?");
    params.push(Math.floor(Number(updatedSince)));
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const cappedLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(500, Math.floor(Number(limit))))
    : null;
  const suffix = cappedLimit ? ` LIMIT ${cappedLimit}` : "";
  return getDb()
    .prepare(`SELECT * FROM generation_queue${where} ORDER BY created_at ASC${suffix}`)
    .all(...params)
    .map(rowToJob);
}

export function _resetGenerationQueueForTests() {
  try {
    getDb().prepare("DELETE FROM generation_queue").run();
  } catch {}
}
