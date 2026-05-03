import { writeFile, readFile, access, link, copyFile } from "fs/promises";
import { join, resolve, sep, extname } from "path";
import { randomBytes } from "crypto";

const DIR = "generated";

export function newNodeId() {
  return "n_" + randomBytes(5).toString("hex");
}

export async function saveNode(rootDir, { nodeId, b64, meta, ext = "png" }) {
  const filename = `${nodeId}.${ext}`;
  await writeFile(join(rootDir, DIR, filename), Buffer.from(b64, "base64"));
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
