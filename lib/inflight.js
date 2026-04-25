// In-memory inflight job registry.
// Tracks generation requests that are currently running on the server so clients
// can reconcile optimistic UI state after a reload or across tabs.
//
// This is intentionally process-local: if the server restarts, inflight jobs
// are lost (which is correct — the fetch they came from is already gone).

const jobs = new Map(); // requestId -> { requestId, kind, prompt, meta, startedAt, phase, phaseAt }

// Phases: "queued" → "streaming" (upstream connection open, waiting for image)
//                 → "decoding" (b64 received, writing to disk)
// finishJob removes the entry entirely.
export function startJob({ requestId, kind, prompt, meta = {}, maxAttempts = 1, owner = null }) {
  if (!requestId) return;
  const max = Math.max(1, Math.floor(Number(maxAttempts) || 1));
  jobs.set(requestId, {
    requestId,
    kind,
    prompt: typeof prompt === "string" ? prompt.slice(0, 500) : "",
    meta,
    owner,
    startedAt: Date.now(),
    phase: "queued",
    phaseAt: Date.now(),
    attempt: 1,
    maxAttempts: max,
  });
}

export function getJob(requestId) {
  return jobs.get(requestId) || null;
}

export function setJobPhase(requestId, phase) {
  if (!requestId) return;
  const j = jobs.get(requestId);
  if (!j) return;
  j.phase = phase;
  j.phaseAt = Date.now();
}

export function setJobAttempt(requestId, attempt) {
  if (!requestId) return;
  const j = jobs.get(requestId);
  if (!j) return;
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  j.attempt = Math.min(n, j.maxAttempts);
  j.phase = "queued";
  j.phaseAt = Date.now();
}

export function finishJob(requestId, _options = {}) {
  if (!requestId) return;
  jobs.delete(requestId);
}

export function listJobs(filters = {}) {
  // Stale reaping: > 10 min is almost certainly a crashed fetch.
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.startedAt > 10 * 60 * 1000) jobs.delete(id);
  }
  const { kind, sessionId, owner = null } = filters;
  return Array.from(jobs.values())
    .filter((j) => {
      if (kind && j.kind !== kind) return false;
      if (sessionId && j.meta?.sessionId !== sessionId) return false;
      if (owner && j.owner !== owner) return false;
      return true;
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function _resetForTests() {
  jobs.clear();
}
