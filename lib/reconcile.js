import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getDb } from "./db.js";

// Recover orphan node-mode generations.
//
// When a long /api/node/generate stream completes but the client side
// dropped (tab closed, network blip, browser tab suspended), the image
// file + sidecar land on disk but the graph node never gets the imageUrl
// update. reconcileGraphPending only checks the inflight table, so the
// node stays "reconciling" / "pending" forever even after a refresh.
//
// This walks generated/<n_*.png.json> and generated/.failed/*.json,
// filters to this session via the sidecar's sessionId, and matches each
// to a graph node by clientNodeId. Successful sidecars promote the node
// to "ready" (with imageUrl + serverNodeId); failure sidecars promote
// it to "stale" with a user-visible error. graph_version is bumped once
// at the end so any open client picks up the change on its next save.
export async function reconcileSessionFromDisk(sessionId, rootDir, owner = null) {
  const db = getDb();

  const sessRow = db
    .prepare("SELECT id, owner FROM sessions WHERE id = ?")
    .get(sessionId);
  if (!sessRow) {
    const err = new Error(`Session not found: ${sessionId}`);
    err.code = "SESSION_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  if (owner && sessRow.owner && sessRow.owner !== owner) {
    const err = new Error("Access denied");
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }

  const GENERATED = join(rootDir, "generated");
  const FAILED_DIR = join(GENERATED, ".failed");

  const succByClient = new Map();
  let succScanned = 0;
  try {
    const entries = await readdir(GENERATED);
    for (const f of entries) {
      if (!/^n_[0-9a-f]+\.[a-z]+\.json$/.test(f)) continue;
      succScanned++;
      try {
        const meta = JSON.parse(await readFile(join(GENERATED, f), "utf-8"));
        if (!meta.clientNodeId || meta.sessionId !== sessionId) continue;
        const prev = succByClient.get(meta.clientNodeId);
        if (!prev || (meta.createdAt || 0) > (prev.createdAt || 0)) {
          succByClient.set(meta.clientNodeId, meta);
        }
      } catch {}
    }
  } catch {}

  const failByClient = new Map();
  let failScanned = 0;
  try {
    const entries = await readdir(FAILED_DIR);
    for (const f of entries) {
      if (!/\.json$/.test(f)) continue;
      failScanned++;
      try {
        const meta = JSON.parse(await readFile(join(FAILED_DIR, f), "utf-8"));
        if (!meta.clientNodeId || meta.sessionId !== sessionId) continue;
        const prev = failByClient.get(meta.clientNodeId);
        if (!prev || (meta.createdAt || 0) > (prev.createdAt || 0)) {
          failByClient.set(meta.clientNodeId, meta);
        }
      } catch {}
    }
  } catch {}

  const nodes = db
    .prepare("SELECT id, data FROM nodes WHERE session_id = ?")
    .all(sessionId);
  let recovered = 0;
  let stalified = 0;
  let brokenBefore = 0;
  const updateStmt = db.prepare(
    "UPDATE nodes SET data = ? WHERE session_id = ? AND id = ?",
  );
  const versionStmt = db.prepare(
    "UPDATE sessions SET graph_version = graph_version + 1, updated_at = ? WHERE id = ?",
  );

  const tx = db.transaction(() => {
    for (const n of nodes) {
      let d;
      try { d = JSON.parse(n.data); } catch { continue; }
      if (d.imageUrl) continue;
      brokenBefore++;

      if (succByClient.has(n.id)) {
        const meta = succByClient.get(n.id);
        const ext = (meta.options && meta.options.format) || "png";
        const next = {
          ...d,
          serverNodeId: meta.nodeId,
          imageUrl: `/generated/${meta.nodeId}.${ext}`,
          status: "ready",
          pendingRequestId: null,
          pendingPhase: null,
          partialImageUrl: null,
          elapsed: meta.elapsed,
          size: (meta.options && meta.options.size) || d.size || null,
        };
        delete next.error;
        updateStmt.run(JSON.stringify(next), sessionId, n.id);
        recovered++;
      } else if (failByClient.has(n.id)) {
        const next = {
          ...d,
          status: "stale",
          pendingRequestId: null,
          pendingPhase: null,
          partialImageUrl: null,
          error: "안전 시스템에서 거부됨. 프롬프트를 수정하고 다시 시도하세요.",
        };
        updateStmt.run(JSON.stringify(next), sessionId, n.id);
        stalified++;
      }
    }
    if (recovered > 0 || stalified > 0) {
      versionStmt.run(Date.now(), sessionId);
    }
  });
  tx();

  const after = db
    .prepare("SELECT graph_version AS gv FROM sessions WHERE id = ?")
    .get(sessionId).gv;

  return {
    recovered,
    stalified,
    scanned: { success: succScanned, failed: failScanned, brokenBefore },
    graphVersion: after,
  };
}
