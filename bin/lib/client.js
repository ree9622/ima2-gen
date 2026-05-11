import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_PORT = 3333;

function readAdvertise() {
  const p = join(homedir(), ".ima2", "server.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

async function probe(base, timeoutMs = 600) {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function resolveServer({ serverFlag } = {}) {
  if (serverFlag) {
    const base = serverFlag.replace(/\/$/, "");
    const health = await probe(base);
    if (health) return { base, health };
    const err = new Error(`server unreachable at ${base}`);
    err.code = "SERVER_UNREACHABLE";
    throw err;
  }
  const candidates = [];
  if (process.env.IMA2_SERVER) candidates.push(process.env.IMA2_SERVER.replace(/\/$/, ""));
  const adv = readAdvertise();
  if (adv?.port) candidates.push(`http://localhost:${adv.port}`);
  candidates.push(`http://localhost:${DEFAULT_PORT}`);

  const seen = new Set();
  const uniq = candidates.filter((c) => !seen.has(c) && seen.add(c));

  for (const base of uniq) {
    const health = await probe(base);
    if (health) return { base, health };
  }
  const err = new Error("server unreachable — is 'ima2 serve' running?");
  err.code = "SERVER_UNREACHABLE";
  throw err;
}

export async function request(base, path, { method = "GET", body, timeoutMs = 180_000 } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-ima2-client": `cli/${CLI_VERSION}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = json?.code || null;
    err.body = json || text;
    throw err;
  }
  return json;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTimeoutError(e) {
  return e?.name === "TimeoutError" || /timeout|aborted due to timeout/i.test(e?.message || "");
}

function recoveryError(message, code, status, body = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.body = body;
  return err;
}

function sortRecoveredItems(a, b) {
  const at = Number(a.createdAt) || 0;
  const bt = Number(b.createdAt) || 0;
  if (at !== bt) return at - bt;
  return String(a.filename || a.url || "").localeCompare(String(b.filename || b.url || ""));
}

async function fetchGenerationLog(base, remainingMs) {
  const timeoutMs = Math.max(250, Math.min(5000, remainingMs));
  const res = await fetch(`${base}/api/generation-log?limit=3000`, {
    headers: { "X-ima2-client": `cli/${CLI_VERSION}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw recoveryError(body?.error || `HTTP ${res.status}`, body?.code || "OUTPUT_RECOVERY_FAILED", res.status, body || text);
  }
  return Array.isArray(body?.items) ? body.items : [];
}

async function fetchRecoveredImage(base, item, remainingMs) {
  if (!item?.url) {
    throw recoveryError("recovered item has no image URL", "OUTPUT_RECOVERY_BAD_ITEM", 500, item);
  }
  const timeoutMs = Math.max(250, Math.min(10000, remainingMs));
  const res = await fetch(new URL(item.url, base), {
    headers: { "X-ima2-client": `cli/${CLI_VERSION}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw recoveryError(`failed to download recovered image: HTTP ${res.status}`, "OUTPUT_RECOVERY_DOWNLOAD_FAILED", res.status, item);
  }
  const mime = (res.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return {
    image: `data:${mime};base64,${b64}`,
    filename: item.filename || null,
  };
}

export async function recoverGeneratedImages(base, requestId, { timeoutMs = 60_000, pollMs = 3000 } = {}) {
  if (!requestId) {
    throw recoveryError("requestId is required for output recovery", "OUTPUT_RECOVERY_NO_REQUEST_ID", 400);
  }

  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let lastError = null;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      const items = await fetchGenerationLog(base, remainingMs);
      const sameRequest = items.filter((item) => item.requestId === requestId);
      const failed = sameRequest.find((item) => item.status === "failed");
      if (failed) {
        throw recoveryError(failed.errorMessage || "generation failed after client timeout", failed.errorCode || "GENERATION_FAILED", 422, failed);
      }
      const successes = sameRequest.filter((item) => item.status === "success" && item.url).sort(sortRecoveredItems);
      if (successes.length > 0) {
        const images = [];
        for (const item of successes) images.push(await fetchRecoveredImage(base, item, deadline - Date.now()));
        return { images, requestId, elapsed: null, recovered: true };
      }
    } catch (err) {
      lastError = err;
      if (err.code && err.code !== "OUTPUT_RECOVERY_FAILED") throw err;
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }

  throw recoveryError(`timed out waiting for recovered output for ${requestId}`, "OUTPUT_RECOVERY_TIMEOUT", 408, lastError?.body || null);
}

export function normalizeGenerate(resp) {
  if (!resp) return { images: [], elapsed: null, requestId: null, recovered: false };
  if (Array.isArray(resp.images)) {
    return {
      images: resp.images.map((it) => ({ image: it.image, filename: it.filename })),
      elapsed: resp.elapsed ?? null,
      requestId: resp.requestId ?? null,
      recovered: resp.recovered === true,
    };
  }
  if (resp.image) {
    return {
      images: [{ image: resp.image, filename: resp.filename || null }],
      elapsed: resp.elapsed ?? null,
      requestId: resp.requestId ?? null,
      recovered: resp.recovered === true,
    };
  }
  return { images: [], elapsed: resp.elapsed ?? null, requestId: resp.requestId ?? null, recovered: resp.recovered === true };
}

export let CLI_VERSION = "dev";
export function setCliVersion(v) { CLI_VERSION = v; }
