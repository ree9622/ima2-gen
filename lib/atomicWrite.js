import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function tempPathFor(targetPath) {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const suffix = `${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}`;
  return join(dir, `.${base}.${suffix}.tmp`);
}

export async function atomicWriteFile(targetPath, data, options = undefined) {
  const tmp = tempPathFor(targetPath);
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await writeFile(tmp, data, options);
    await rename(tmp, targetPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function atomicWriteJson(targetPath, value, { spaces = undefined } = {}) {
  const payload = JSON.stringify(value, null, spaces);
  await atomicWriteFile(targetPath, payload);
}
