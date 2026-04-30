// Batch tracking for client-side fan-out flows (texte일괄: N prompts in one
// burst). The client mints a batchId + per-prompt batchIndex/batchTotal and
// echoes them on every /api/generate call. Each call appends one JSON file
// under generated/.batches/<batchId>/<index>.json (index is 0-padded so
// directory listing sorts naturally), plus a single batch-level
// _meta.json that records start time and totals.
//
// Why a directory of files, not one append-only log: 31 concurrent
// /api/generate calls write at the same time. Per-file writes are
// independent and atomic via writeFile (no locking, no torn JSON).
// GET /api/batch/:id walks the dir at read time.
//
// Schema kept deliberately small — full attempt detail still lives in the
// per-image sidecars (or .failed/<id>.json). batch entries are pointers
// + summary, not duplicates.

import { mkdir, writeFile, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// Hard cap on entries we'll list back from a batch. 31 was the canonical
// burst that triggered the original fix; 1000 is the client's
// TXT_BATCH_HARD_CAP — keep it as a safety bound rather than a tight one.
const MAX_BATCH_ENTRIES = 1000;
const BATCH_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function batchDirRoot(generatedDir) {
  return join(generatedDir, ".batches");
}

export function isValidBatchId(id) {
  return typeof id === "string" && BATCH_ID_RE.test(id);
}

function batchDir(generatedDir, batchId) {
  return join(batchDirRoot(generatedDir), batchId);
}

function indexToFilename(idx) {
  // 0-padded so dirent listing sorts in batch order without numeric parsing.
  const safeIdx = Number.isFinite(idx) ? Math.max(0, Math.floor(idx)) : 0;
  return `${String(safeIdx).padStart(5, "0")}.json`;
}

// Idempotent — called from the route handler before each /api/generate
// fan-out write. Writes _meta.json only on first arrival (best-effort,
// no lock; later callers race-overwrite with the same content which is fine).
export async function ensureBatchMeta({
  generatedDir,
  batchId,
  batchTotal,
  startedAt,
  owner,
  source,
  billingBefore = null,
}) {
  if (!isValidBatchId(batchId)) return;
  const dir = batchDir(generatedDir, batchId);
  await mkdir(dir, { recursive: true });
  const metaPath = join(dir, "_meta.json");
  try {
    // Don't clobber a stricter total once set — the first call wins.
    const existing = JSON.parse(await readFile(metaPath, "utf8"));
    if (existing && existing.batchId === batchId) return;
  } catch {
    // not yet written — fall through and create
  }
  const meta = {
    batchId,
    batchTotal: Number.isFinite(batchTotal) ? batchTotal : null,
    startedAt: startedAt || Date.now(),
    owner: owner || null,
    source: source || null,
    billingBefore,
  };
  await writeFile(metaPath, JSON.stringify(meta));
}

// Append one entry to the batch directory. Each entry is one /api/generate
// call result (success or failure) — minimal pointer payload, NOT a full
// duplicate of the sidecar.
export async function appendBatchEntry({
  generatedDir,
  batchId,
  batchIndex,
  entry,
}) {
  if (!isValidBatchId(batchId)) return;
  const dir = batchDir(generatedDir, batchId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, indexToFilename(batchIndex));
  const enriched = {
    batchId,
    batchIndex: Number.isFinite(batchIndex) ? batchIndex : null,
    recordedAt: Date.now(),
    ...entry,
  };
  await writeFile(file, JSON.stringify(enriched));
}

// Read the full batch back: meta + sorted entries. Used by GET /api/batch/:id.
export async function readBatch({ generatedDir, batchId }) {
  if (!isValidBatchId(batchId)) return null;
  const dir = batchDir(generatedDir, batchId);
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const entries = [];
  let meta = null;
  for (const name of names.slice(0, MAX_BATCH_ENTRIES + 1)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = JSON.parse(raw);
      if (name === "_meta.json") {
        meta = parsed;
      } else {
        entries.push(parsed);
      }
    } catch {
      // skip torn writes
    }
  }
  entries.sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
  return { meta, entries };
}

// List recent batches. Pure dir listing — no aggregation.
export async function listBatches({ generatedDir, limit = 50 }) {
  const root = batchDirRoot(generatedDir);
  let names;
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!isValidBatchId(name)) continue;
    const metaPath = join(root, name, "_meta.json");
    try {
      const [s, raw] = await Promise.all([
        stat(metaPath),
        readFile(metaPath, "utf8"),
      ]);
      const parsed = JSON.parse(raw);
      out.push({
        ...parsed,
        mtime: s.mtimeMs,
      });
    } catch {
      // missing meta — surface the dir name + mtime only
      try {
        const s = await stat(join(root, name));
        out.push({ batchId: name, mtime: s.mtimeMs, batchTotal: null, startedAt: null });
      } catch {
        // gone between readdir and stat — skip
      }
    }
  }
  out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return out.slice(0, limit);
}

// Aggregate metrics across a batch's entries — used by both
// GET /api/batch/:id and the batch.summary log line.
export function summarizeBatch(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      total: 0,
      succeeded: 0,
      failed: 0,
      totalAttempts: 0,
      totalUsage: null,
      reasons: {},
    };
  }
  let succeeded = 0;
  let failed = 0;
  let totalAttempts = 0;
  let totalUsage = null;
  const reasons = {};
  for (const e of entries) {
    if (e.ok) succeeded += 1;
    else failed += 1;
    if (Number.isFinite(e.attemptsCount)) totalAttempts += e.attemptsCount;
    if (e.usage && typeof e.usage === "object") {
      if (!totalUsage) totalUsage = {};
      for (const [k, v] of Object.entries(e.usage)) {
        if (typeof v === "number") totalUsage[k] = (totalUsage[k] || 0) + v;
      }
    }
    if (!e.ok) {
      const r = e.errorCode || "UNKNOWN";
      reasons[r] = (reasons[r] || 0) + 1;
    }
  }
  return {
    total: entries.length,
    succeeded,
    failed,
    totalAttempts,
    totalUsage,
    reasons,
  };
}
