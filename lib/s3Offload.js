// S3 offload: move old local media to S3 to keep generated/ under a size cap.
//
// This is DISTINCT from lib/prune.js (which permanently deletes assets and
// marks nodes asset-missing). Offload moves a local image to S3 and deletes
// ONLY the local copy — the sidecar JSON stays on disk so history + ACL keep
// working, and server.js proxies S3 on a local miss, so the image is still
// fully viewable. No missing-asset marking.
//
// Policy: oldest-first until total local media <= capMb. Favorites and recent
// items are kept on local disk. Each offload verifies the S3 object exists
// (HEAD) before unlinking the local file.

import { readdir, stat, unlink, readFile } from "fs/promises";
import { createReadStream } from "fs";
import { join, relative, sep } from "path";
import { s3Enabled, s3Head, s3Put, contentTypeFor } from "./s3Store.js";

const MEDIA_RE = /\.(png|jpe?g|webp)$/i;
const EXCLUDE_DIRS = new Set([".trash", ".failed"]);

function toKey(generatedDir, full) {
  return relative(generatedDir, full).split(sep).join("/");
}

async function walkMedia(generatedDir, depth = 2) {
  const out = [];
  async function rec(d, left) {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory() && left > 0) {
        await rec(full, left - 1);
      } else if (e.isFile() && MEDIA_RE.test(e.name)) {
        const st = await stat(full).catch(() => null);
        if (st) out.push({ full, key: toKey(generatedDir, full), size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  await rec(generatedDir, depth);
  return out;
}

async function isFavorite(full) {
  try {
    const m = JSON.parse(await readFile(full + ".json", "utf-8"));
    return m?.favorite === true;
  } catch {
    return false;
  }
}

// Ensure the asset is in S3 (upload if absent, then verify), then delete the
// local copy. Sidecar JSON is intentionally left in place. Returns bytes freed.
async function offloadOne(item) {
  const head = await s3Head(item.key);
  if (!head) {
    await s3Put(item.key, createReadStream(item.full), contentTypeFor(item.key));
    const verify = await s3Head(item.key);
    if (!verify) throw new Error("verify failed after put: " + item.key);
  }
  await unlink(item.full);
  return item.size;
}

export async function offloadToS3(generatedDir, opts = {}) {
  const {
    capMb = 2048,
    keepFavorites = true,
    keepRecentMs = 0,
    dryRun = false,
    now = Date.now(),
  } = opts;

  if (!s3Enabled()) return { enabled: false };

  const cap = capMb * 1024 * 1024;
  const items = await walkMedia(generatedDir);
  let total = items.reduce((s, it) => s + it.size, 0);

  const result = {
    enabled: true,
    dryRun,
    capMb,
    scanned: items.length,
    totalBeforeBytes: total,
    offloaded: 0,
    freedBytes: 0,
    keptFavorites: 0,
    errors: 0,
  };

  if (total <= cap) {
    result.totalAfterBytes = total;
    return result;
  }

  const eligible = [];
  for (const it of items) {
    if (keepRecentMs && now - it.mtimeMs < keepRecentMs) continue;
    if (keepFavorites && (await isFavorite(it.full))) {
      result.keptFavorites++;
      continue;
    }
    eligible.push(it);
  }
  eligible.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

  for (const it of eligible) {
    if (total <= cap) break;
    if (dryRun) {
      result.offloaded++;
      result.freedBytes += it.size;
      total -= it.size;
      continue;
    }
    try {
      const freed = await offloadOne(it);
      result.offloaded++;
      result.freedBytes += freed;
      total -= freed;
    } catch (err) {
      result.errors++;
      console.warn("[s3-offload] failed:", it.key, err?.message || err);
    }
  }

  result.totalAfterBytes = total;
  return result;
}
