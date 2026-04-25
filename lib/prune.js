// Disk hygiene for generated/, generated/.trash, and generated/.failed.
//
// Two operations:
//   getStorageStats(rootDir)              → byte/file counts per bucket
//   pruneStorage(rootDir, opts)           → delete by TTL + optional size cap
//
// Policy notes:
//   - Favorites in generated/ are skipped by default (keepFavorites=true).
//   - Trash uses unlinkBoth (image + .json); failed/ stores sidecar-only records.
//   - Size cap deletes oldest non-favorite first until under cap.
//   - dryRun computes what *would* be freed without touching disk.

import { readdir, stat, unlink, readFile } from "fs/promises";
import { join, relative } from "path";

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const DAY_MS = 86_400_000;

async function walkAll(dir, { excludeDirs = [], depth = 2 } = {}) {
  const out = [];
  async function rec(d, left) {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (excludeDirs.includes(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory() && left > 0) {
        await rec(full, left - 1);
      } else if (e.isFile()) {
        const st = await stat(full).catch(() => null);
        if (st) out.push({ full, name: e.name, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  await rec(dir, depth);
  return out;
}

async function readMeta(imageFull) {
  try {
    return JSON.parse(await readFile(imageFull + ".json", "utf-8"));
  } catch {
    return null;
  }
}

async function sidecarSize(imageFull) {
  try {
    const st = await stat(imageFull + ".json");
    return st.size;
  } catch {
    return 0;
  }
}

async function unlinkBoth(fullPath) {
  let bytes = 0;
  try {
    const st = await stat(fullPath);
    bytes += st.size;
    await unlink(fullPath);
  } catch {}
  try {
    const st = await stat(fullPath + ".json");
    bytes += st.size;
    await unlink(fullPath + ".json");
  } catch {}
  return bytes;
}

export async function getStorageStats(rootDir) {
  const generatedDir = join(rootDir, "generated");
  const trashDir = join(generatedDir, ".trash");
  const failedDir = join(generatedDir, ".failed");

  const genItems = await walkAll(generatedDir, { excludeDirs: [".trash", ".failed"] });
  let genBytes = 0;
  let genImages = 0;
  let genFavorites = 0;
  let oldestGen = null;
  for (const it of genItems) {
    genBytes += it.size;
    if (IMAGE_RE.test(it.name)) {
      genImages++;
      if (oldestGen == null || it.mtimeMs < oldestGen) oldestGen = it.mtimeMs;
      const meta = await readMeta(it.full);
      if (meta?.favorite === true) genFavorites++;
    }
  }

  const trashItems = await walkAll(trashDir, { depth: 0 });
  let trashBytes = 0;
  let oldestTrash = null;
  for (const it of trashItems) {
    trashBytes += it.size;
    if (oldestTrash == null || it.mtimeMs < oldestTrash) oldestTrash = it.mtimeMs;
  }

  const failedItems = await walkAll(failedDir, { depth: 0 });
  let failedBytes = 0;
  let oldestFailed = null;
  for (const it of failedItems) {
    failedBytes += it.size;
    if (oldestFailed == null || it.mtimeMs < oldestFailed) oldestFailed = it.mtimeMs;
  }

  return {
    generated: {
      bytes: genBytes,
      files: genItems.length,
      images: genImages,
      favorites: genFavorites,
      oldestMs: oldestGen,
    },
    trash: { bytes: trashBytes, files: trashItems.length, oldestMs: oldestTrash },
    failed: { bytes: failedBytes, files: failedItems.length, oldestMs: oldestFailed },
    totalBytes: genBytes + trashBytes + failedBytes,
  };
}

export async function pruneStorage(rootDir, opts = {}) {
  const {
    trashTtlDays = 7,
    failedTtlDays = 14,
    genMaxMb = null,
    genTtlDays = null,
    keepFavorites = true,
    dryRun = false,
    now = Date.now(),
  } = opts;

  const generatedDir = join(rootDir, "generated");
  const trashDir = join(generatedDir, ".trash");
  const failedDir = join(generatedDir, ".failed");

  const result = {
    dryRun,
    policy: { trashTtlDays, failedTtlDays, genMaxMb, genTtlDays, keepFavorites },
    trash: { scanned: 0, deleted: 0, freedBytes: 0 },
    failed: { scanned: 0, deleted: 0, freedBytes: 0 },
    generated: {
      scanned: 0,
      deleted: 0,
      freedBytes: 0,
      skippedFavorites: 0,
      deletedFilenames: [],
    },
  };

  if (trashTtlDays != null) {
    const cutoff = now - trashTtlDays * DAY_MS;
    const items = await walkAll(trashDir, { depth: 0 });
    result.trash.scanned = items.length;
    const sidecarsHandled = new Set();
    for (const it of items) {
      if (it.name.endsWith(".json")) continue;
      if (it.mtimeMs >= cutoff) continue;
      sidecarsHandled.add(it.full + ".json");
      result.trash.deleted++;
      result.trash.freedBytes += dryRun
        ? it.size + (await sidecarSize(it.full))
        : await unlinkBoth(it.full);
    }
    for (const it of items) {
      if (!it.name.endsWith(".json")) continue;
      if (sidecarsHandled.has(it.full)) continue;
      if (it.mtimeMs >= cutoff) continue;
      result.trash.deleted++;
      result.trash.freedBytes += it.size;
      if (!dryRun) {
        try { await unlink(it.full); } catch {}
      }
    }
  }

  if (failedTtlDays != null) {
    const cutoff = now - failedTtlDays * DAY_MS;
    const items = await walkAll(failedDir, { depth: 0 });
    result.failed.scanned = items.length;
    for (const it of items) {
      if (!it.name.endsWith(".json")) continue;
      if (it.mtimeMs >= cutoff) continue;
      result.failed.deleted++;
      result.failed.freedBytes += it.size;
      if (!dryRun) {
        try { await unlink(it.full); } catch {}
      }
    }
  }

  const genItems = await walkAll(generatedDir, { excludeDirs: [".trash", ".failed"] });
  const images = genItems.filter((it) => IMAGE_RE.test(it.name));
  result.generated.scanned = images.length;

  const annotated = await Promise.all(
    images.map(async (it) => {
      const meta = await readMeta(it.full);
      const sc = await sidecarSize(it.full);
      return {
        ...it,
        favorite: meta?.favorite === true,
        totalSize: it.size + sc,
        relPath: relative(generatedDir, it.full),
      };
    }),
  );

  const toDelete = new Set();

  if (genTtlDays != null) {
    const cutoff = now - genTtlDays * DAY_MS;
    for (const it of annotated) {
      if (it.mtimeMs >= cutoff) continue;
      if (keepFavorites && it.favorite) {
        result.generated.skippedFavorites++;
        continue;
      }
      toDelete.add(it.full);
    }
  }

  if (genMaxMb != null) {
    const cap = genMaxMb * 1024 * 1024;
    let total = annotated.reduce((s, it) => s + it.totalSize, 0);
    for (const it of annotated) if (toDelete.has(it.full)) total -= it.totalSize;

    if (total > cap) {
      const eligible = annotated
        .filter((it) => !toDelete.has(it.full) && (!keepFavorites || !it.favorite))
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const it of eligible) {
        if (total <= cap) break;
        toDelete.add(it.full);
        total -= it.totalSize;
      }
    }
  }

  for (const fullPath of toDelete) {
    const it = annotated.find((x) => x.full === fullPath);
    if (!it) continue;
    result.generated.deleted++;
    result.generated.deletedFilenames.push(it.relPath);
    if (dryRun) {
      result.generated.freedBytes += it.totalSize;
    } else {
      result.generated.freedBytes += await unlinkBoth(fullPath);
    }
  }

  return result;
}
