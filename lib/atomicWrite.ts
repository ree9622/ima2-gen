import { writeFile, rename, unlink } from "node:fs/promises";

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, path);
}

export async function safeWriteSidecar(path: string, data: unknown): Promise<void> {
  try {
    await atomicWriteJson(path, data);
  } catch {
    await unlink(`${path}.${process.pid}.tmp`).catch(() => {});
  }
}
