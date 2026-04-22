import { writeFile, readFile, access } from "fs/promises";
import { join } from "path";
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

export async function loadNodeB64(rootDir, filename) {
  const p = join(rootDir, DIR, filename);
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
