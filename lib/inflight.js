// In-memory inflight job registry.
// Tracks generation requests that are currently running on the server so clients
// can reconcile optimistic UI state after a reload or across tabs.
//
// This is intentionally process-local: if the server restarts, inflight jobs
// are lost (which is correct — the fetch they came from is already gone).

const jobs = new Map(); // requestId -> { requestId, kind, prompt, meta, startedAt }

export function startJob({ requestId, kind, prompt, meta = {} }) {
  if (!requestId) return;
  jobs.set(requestId, {
    requestId,
    kind,
    prompt: typeof prompt === "string" ? prompt.slice(0, 500) : "",
    meta,
    startedAt: Date.now(),
  });
}

export function finishJob(requestId) {
  if (!requestId) return;
  jobs.delete(requestId);
}

export function listJobs() {
  // Stale reaping: > 10 min is almost certainly a crashed fetch.
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.startedAt > 10 * 60 * 1000) jobs.delete(id);
  }
  return Array.from(jobs.values()).sort((a, b) => a.startedAt - b.startedAt);
}

export function _resetForTests() {
  jobs.clear();
}
