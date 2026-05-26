import mysql from "mysql2/promise";

import {
  enqueueGenerationJob as sqliteEnqueueGenerationJob,
  getGenerationJob as sqliteGetGenerationJob,
  claimNextGenerationJob as sqliteClaimNextGenerationJob,
  setGenerationJobPhase as sqliteSetGenerationJobPhase,
  requeueGenerationJob as sqliteRequeueGenerationJob,
  completeGenerationJob as sqliteCompleteGenerationJob,
  failGenerationJob as sqliteFailGenerationJob,
  cancelGenerationJob as sqliteCancelGenerationJob,
  recoverQueuedGenerationJobs as sqliteRecoverQueuedGenerationJobs,
  listGenerationJobs as sqliteListGenerationJobs,
} from "./generationQueue.js";
import { logEvent } from "./logger.js";

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);
const MYSQL_URL = process.env.IMA2_QUEUE_DB_URL || "";
const MYSQL_ENABLED = /^mysql(?:2)?:\/\//i.test(MYSQL_URL);

let poolPromise = null;
let schemaReady = false;

function nowMs() {
  return Date.now();
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
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

function mysqlConfigFromUrl() {
  const u = new URL(MYSQL_URL);
  return {
    host: u.hostname || "127.0.0.1",
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: Number(process.env.IMA2_QUEUE_DB_POOL || 4),
    queueLimit: 0,
    enableKeepAlive: true,
  };
}

async function getPool() {
  if (!MYSQL_ENABLED) return null;
  if (!poolPromise) {
    poolPromise = Promise.resolve(mysql.createPool(mysqlConfigFromUrl()));
  }
  const pool = await poolPromise;
  if (!schemaReady) {
    await ensureMysqlSchema(pool);
    schemaReady = true;
  }
  return pool;
}

async function ensureMysqlSchema(pool) {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS generation_queue (" +
      "request_id VARCHAR(128) NOT NULL PRIMARY KEY," +
      "kind VARCHAR(32) NOT NULL DEFAULT 'classic'," +
      "owner VARCHAR(191) NULL," +
      "prompt VARCHAR(500) NOT NULL DEFAULT ''," +
      "payload LONGTEXT NOT NULL," +
      "meta LONGTEXT NOT NULL," +
      "status VARCHAR(32) NOT NULL DEFAULT 'queued'," +
      "phase VARCHAR(32) NOT NULL DEFAULT 'queued'," +
      "result LONGTEXT NULL," +
      "error LONGTEXT NULL," +
      "run_count INT NOT NULL DEFAULT 0," +
      "created_at BIGINT NOT NULL," +
      "updated_at BIGINT NOT NULL," +
      "started_at BIGINT NULL," +
      "finished_at BIGINT NULL," +
      "KEY idx_generation_queue_status_kind_created (status, kind, created_at)," +
      "KEY idx_generation_queue_owner (owner)," +
      "KEY idx_generation_queue_kind_created (kind, created_at)" +
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"
  );
}

export function generationQueueBackend() {
  return MYSQL_ENABLED ? "mysql" : "sqlite";
}

export async function enqueueGenerationJob(args) {
  if (!MYSQL_ENABLED) return sqliteEnqueueGenerationJob(args);
  const { requestId, kind = "classic", owner = null, prompt = "", payload = {}, meta = {} } = args || {};
  if (!requestId) throw new Error("requestId required");
  const existing = await getGenerationJob(requestId);
  if (existing && !TERMINAL.has(existing.status)) return existing;
  const t = nowMs();
  const pool = await getPool();
  await pool.execute(
    "INSERT INTO generation_queue (" +
      "request_id, kind, owner, prompt, payload, meta, status, phase, result, error, run_count, created_at, updated_at, started_at, finished_at" +
    ") VALUES (?, ?, ?, ?, ?, ?, 'queued', 'queued', NULL, NULL, 0, ?, ?, NULL, NULL) " +
    "ON DUPLICATE KEY UPDATE " +
      "kind=VALUES(kind), owner=VALUES(owner), prompt=VALUES(prompt), payload=VALUES(payload), meta=VALUES(meta), " +
      "status='queued', phase='queued', result=NULL, error=NULL, run_count=0, created_at=VALUES(created_at), updated_at=VALUES(updated_at), started_at=NULL, finished_at=NULL",
    [
      requestId,
      kind,
      owner,
      typeof prompt === "string" ? prompt.slice(0, 500) : "",
      JSON.stringify(normalizeObject(payload)),
      JSON.stringify(normalizeObject(meta)),
      t,
      t,
    ],
  );
  logEvent("generation_queue", "enqueue", { requestId, kind, owner, backend: "mysql" });
  return getGenerationJob(requestId);
}

export async function getGenerationJob(requestId) {
  if (!MYSQL_ENABLED) return sqliteGetGenerationJob(requestId);
  if (!requestId) return null;
  const pool = await getPool();
  const [rows] = await pool.execute("SELECT * FROM generation_queue WHERE request_id = ?", [requestId]);
  return rowToJob(rows[0]);
}

export async function claimNextGenerationJob(kind = "classic") {
  if (!MYSQL_ENABLED) return sqliteClaimNextGenerationJob(kind);
  const pool = await getPool();
  const conn = await pool.getConnection();
  const t = nowMs();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      "SELECT * FROM generation_queue WHERE status = 'queued' AND kind = ? ORDER BY created_at ASC LIMIT 1 FOR UPDATE",
      [kind],
    );
    const row = rows[0];
    if (!row) {
      await conn.commit();
      return null;
    }
    const [res] = await conn.execute(
      "UPDATE generation_queue SET status='running', phase='running', run_count=run_count+1, started_at=COALESCE(started_at, ?), updated_at=? WHERE request_id=? AND status='queued'",
      [t, t, row.request_id],
    );
    await conn.commit();
    if (res.affectedRows !== 1) return null;
    return getGenerationJob(row.request_id);
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

export async function setGenerationJobPhase(requestId, phase) {
  if (!MYSQL_ENABLED) return sqliteSetGenerationJobPhase(requestId, phase);
  if (!requestId || typeof phase !== "string" || !phase) return;
  const pool = await getPool();
  const t = nowMs();
  const [res] = await pool.execute(
    "UPDATE generation_queue SET phase=?, updated_at=? WHERE request_id=? AND status IN ('queued', 'running')",
    [phase, t, requestId],
  );
  if (res.affectedRows > 0) logEvent("generation_queue", "phase", { requestId, phase, backend: "mysql" });
}

export async function requeueGenerationJob(requestId) {
  if (!MYSQL_ENABLED) return sqliteRequeueGenerationJob(requestId);
  if (!requestId) return false;
  const pool = await getPool();
  const t = nowMs();
  const [res] = await pool.execute(
    "UPDATE generation_queue SET status='queued', phase='queued', updated_at=?, started_at=NULL WHERE request_id=? AND status='running'",
    [t, requestId],
  );
  return res.affectedRows > 0;
}

export async function completeGenerationJob(requestId, result = {}) {
  if (!MYSQL_ENABLED) return sqliteCompleteGenerationJob(requestId, result);
  if (!requestId) return false;
  const pool = await getPool();
  const t = nowMs();
  const [res] = await pool.execute(
    "UPDATE generation_queue SET status='succeeded', phase='done', result=?, error=NULL, updated_at=?, finished_at=? WHERE request_id=? AND status != 'canceled'",
    [JSON.stringify(normalizeObject(result)), t, t, requestId],
  );
  if (res.affectedRows > 0) logEvent("generation_queue", "complete", { requestId, backend: "mysql" });
  return res.affectedRows > 0;
}

export async function failGenerationJob(requestId, error = {}) {
  if (!MYSQL_ENABLED) return sqliteFailGenerationJob(requestId, error);
  if (!requestId) return false;
  const normalizedError = error instanceof Error
    ? { message: error.message, code: error.code || null, status: error.status || null }
    : normalizeObject(error);
  const pool = await getPool();
  const t = nowMs();
  const [res] = await pool.execute(
    "UPDATE generation_queue SET status='failed', phase='error', error=?, updated_at=?, finished_at=? WHERE request_id=? AND status != 'canceled'",
    [JSON.stringify(normalizedError), t, t, requestId],
  );
  if (res.affectedRows > 0) {
    logEvent("generation_queue", "fail", {
      requestId,
      errorCode: normalizedError.code || null,
      errorMessage: normalizedError.message || null,
      backend: "mysql",
    });
  }
  return res.affectedRows > 0;
}

export async function cancelGenerationJob(requestId) {
  if (!MYSQL_ENABLED) return sqliteCancelGenerationJob(requestId);
  if (!requestId) return false;
  const pool = await getPool();
  const t = nowMs();
  const [res] = await pool.execute(
    "UPDATE generation_queue SET status='canceled', phase='canceled', updated_at=?, finished_at=? WHERE request_id=? AND status IN ('queued', 'running')",
    [t, t, requestId],
  );
  if (res.affectedRows > 0) logEvent("generation_queue", "cancel", { requestId, backend: "mysql" });
  return res.affectedRows > 0;
}

export async function recoverQueuedGenerationJobs() {
  if (!MYSQL_ENABLED) return sqliteRecoverQueuedGenerationJobs();
  const pool = await getPool();
  const t = nowMs();
  const [res] = await pool.execute(
    "UPDATE generation_queue SET status='queued', phase='queued', updated_at=?, started_at=NULL WHERE status='running'",
    [t],
  );
  if (res.affectedRows > 0) {
    logEvent("generation_queue", "recover_running", { count: res.affectedRows, backend: "mysql" });
  }
  return res.affectedRows;
}

export async function listGenerationJobs(filters = {}) {
  if (!MYSQL_ENABLED) return sqliteListGenerationJobs(filters);
  const { status, kind, owner = null, updatedSince, limit } = filters;
  const clauses = [];
  const params = [];
  if (status) { clauses.push("status = ?"); params.push(status); }
  if (kind) { clauses.push("kind = ?"); params.push(kind); }
  if (owner) { clauses.push("owner = ?"); params.push(owner); }
  if (Number.isFinite(Number(updatedSince))) {
    clauses.push("updated_at >= ?");
    params.push(Math.floor(Number(updatedSince)));
  }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const cappedLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(500, Math.floor(Number(limit))))
    : null;
  const suffix = cappedLimit ? " LIMIT " + cappedLimit : "";
  const pool = await getPool();
  const [rows] = await pool.execute(
    "SELECT * FROM generation_queue" + where + " ORDER BY created_at ASC" + suffix,
    params,
  );
  return rows.map(rowToJob);
}
