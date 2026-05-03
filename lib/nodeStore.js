import { writeFile, readFile, access, link, copyFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { join, resolve, sep, extname } from "path";
import { randomBytes } from "crypto";
import { writeTextChunks, IMA2_METADATA_VERSION } from "./imageMetadata.js";

const DIR = "generated";

export function newNodeId() {
  return "n_" + randomBytes(5).toString("hex");
}

export async function saveNode(rootDir, { nodeId, b64, meta, ext = "png" }) {
  const filename = `${nodeId}.${ext}`;
  let imageBuf = Buffer.from(b64, "base64");
  if (ext === "png") {
    try {
      imageBuf = writeTextChunks(imageBuf, {
        "ima2:version": IMA2_METADATA_VERSION,
        "ima2:prompt": meta?.prompt ?? "",
        "ima2:revisedPrompt": meta?.revisedPrompt ?? "",
        "ima2:size": meta?.options?.size ?? "",
        "ima2:quality": meta?.options?.quality ?? "",
        "ima2:model": "gpt-image-2",
        "ima2:createdAt": new Date(meta?.createdAt || Date.now()).toISOString(),
      });
    } catch (err) {
      console.warn("[image-metadata] node embed failed:", err?.message || err);
    }
  }
  await writeFile(join(rootDir, DIR, filename), imageBuf);
  await writeFile(join(rootDir, DIR, filename + ".json"), JSON.stringify(meta, null, 2));
  return { filename };
}

// Adopt an existing generated/ file under a new nodeId so node-mode children
// can branch from it (loadNodeB64 expects `<nodeId>.<ext>`). Tries hardlink
// first to avoid a 2nd copy on disk; falls back to copyFile when the FS
// rejects (cross-device, permissions, Windows w/o privilege, etc.).
export async function importExistingFile(rootDir, { sourceFilename, nodeId, meta }) {
  const baseDir = resolve(rootDir, DIR);
  const sourcePath = resolveGeneratedPath(rootDir, sourceFilename);
  const ext = (extname(sourceFilename).slice(1) || "png").toLowerCase();
  const targetFilename = `${nodeId}.${ext}`;
  const targetPath = join(baseDir, targetFilename);
  try {
    await link(sourcePath, targetPath);
  } catch (err) {
    if (err && (err.code === "EEXIST")) throw err;
    await copyFile(sourcePath, targetPath);
  }
  await writeFile(targetPath + ".json", JSON.stringify(meta, null, 2));
  return { filename: targetFilename, ext };
}

export async function loadNodeB64(rootDir, filename) {
  const p = resolveGeneratedPath(rootDir, filename);
  try { await access(p); } catch {
    const err = new Error(`Node file not found: ${filename}`);
    err.code = "NODE_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const buf = await readFile(p);
  return buf.toString("base64");
}

export async function loadNodeMeta(rootDir, nodeId, ext = "png") {
  try {
    return JSON.parse(await readFile(join(rootDir, DIR, `${nodeId}.${ext}.json`), "utf-8"));
  } catch {
    return null;
  }
}

export async function loadAssetB64(rootDir, externalSrc) {
  const p = resolveGeneratedPath(rootDir, externalSrc);
  try { await access(p); } catch {
    const err = new Error(`Asset file not found: ${externalSrc}`);
    err.code = "NODE_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const buf = await readFile(p);
  return buf.toString("base64");
}

// Read the sidecar JSON for any generated/ asset (history image or node).
// Returns null when the sidecar is missing — callers that need owner checks
// must treat null as "no metadata, no claim of ownership".
export async function loadAssetSidecar(rootDir, sourceFilename) {
  const p = resolveGeneratedPath(rootDir, sourceFilename + ".json");
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

function resolveGeneratedPath(rootDir, relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) {
    const err = new Error("Asset path is required");
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }
  const baseDir = resolve(rootDir, DIR);
  const target = resolve(baseDir, relPath);
  if (target !== baseDir && !target.startsWith(baseDir + sep)) {
    const err = new Error(`Asset path escapes generated/: ${relPath}`);
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }
  return target;
}


// ── Node generate result store (Step 4-B) ──────────────────────────────
// Persists every /api/node/generate completion (success or failure) to
// a per-requestId JSON file so the client can recover when the streaming
// response was lost (long generation, tab suspended, network blip).
//
// Lives under generated/.results/<requestId>.json. TTL-pruned at server
// boot and on each write. requestId comes from the client (`fn_<clientId>`
// for node-mode), so collisions are not a concern.
const RESULTS_DIR = ".results";
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

function safeRequestId(requestId) {
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(requestId)) return null;
  return requestId;
}

export async function writeNodeResult(rootDir, requestId, result) {
  const safe = safeRequestId(requestId);
  if (!safe) return false;
  const dir = resolve(rootDir, DIR, RESULTS_DIR);
  try { await mkdir(dir, { recursive: true }); } catch {}
  const target = resolve(dir, safe + ".json");
  if (!target.startsWith(dir + sep)) return false;
  const payload = { ...result, savedAt: Date.now() };
  try {
    await writeFile(target, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn("[node-result] write failed:", requestId, err.message);
    return false;
  }
}

export async function readNodeResult(rootDir, requestId) {
  const safe = safeRequestId(requestId);
  if (!safe) return null;
  const target = resolve(rootDir, DIR, RESULTS_DIR, safe + ".json");
  try {
    const raw = await readFile(target, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function pruneNodeResults(rootDir, ttlMs = RESULT_TTL_MS) {
  const dir = resolve(rootDir, DIR, RESULTS_DIR);
  let removed = 0;
  try {
    const entries = await readdir(dir);
    const cutoff = Date.now() - ttlMs;
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      const target = resolve(dir, f);
      try {
        const st = await stat(target);
        if (st.mtimeMs < cutoff) {
          await unlink(target);
          removed++;
        }
      } catch {}
    }
  } catch {}
  return removed;
}
