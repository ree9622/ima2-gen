import sharp from "sharp";
import { mkdir, access, readdir } from "fs/promises";
import { join, dirname } from "path";

const DIR = "generated";
const THUMBS_DIR = ".thumbs";
export const MAX_INPUT_PIXELS = 64_000_000;
export const PREVIEW_SKIP_DIRS = new Set([".trash", ".failed", ".refs", ".thumbs", ".results", ".batches"]);
const IMG_RE = /\.(png|jpe?g|webp)$/i;

const VARIANTS = [
  { suffix: ".thumb.webp", width: 480,  quality: 78 },
  { suffix: ".web.webp",   width: 1536, quality: 85 },
];

function thumbAbsPath(rootDir, rel, suffix) {
  return join(rootDir, DIR, THUMBS_DIR, rel + suffix);
}

export async function derivePreviews(rootDir, rel, { force = false } = {}) {
  const sourcePath = join(rootDir, DIR, rel);
  let derivedCount = 0;
  for (const v of VARIANTS) {
    const target = thumbAbsPath(rootDir, rel, v.suffix);
    if (!force) {
      try { await access(target); continue; } catch {}
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await sharp(sourcePath, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: v.width, withoutEnlargement: true })
        .webp({ quality: v.quality, effort: 4, smartSubsample: true })
        .toFile(target);
      derivedCount++;
    } catch (err) {
      console.warn("[image-variants] derive failed:", rel, v.suffix, err?.message || err);
    }
  }
  return derivedCount;
}

function normalizePositiveInteger(value, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export async function* walkGeneratedImages(rootDir, { depth = 8, base = "" } = {}) {
  const dir = join(rootDir, DIR, base);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (PREVIEW_SKIP_DIRS.has(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (depth > 0) yield* walkGeneratedImages(rootDir, { depth: depth - 1, base: rel });
    } else if (entry.isFile() && IMG_RE.test(entry.name)) {
      yield rel;
    }
  }
}

export async function backfillPreviews(rootDir, options = {}) {
  const force = options.force === true;
  const dryRun = options.dryRun === true;
  const limit = normalizePositiveInteger(options.limit, Infinity);
  const concurrency = normalizePositiveInteger(options.concurrency, 4, { max: 16 });
  const depth = normalizePositiveInteger(options.depth, 8, { max: 32 });
  const items = [];
  for await (const rel of walkGeneratedImages(rootDir, { depth })) {
    items.push(rel);
    if (items.length >= limit) break;
  }

  const stats = {
    ok: true,
    dryRun,
    force,
    total: items.length,
    processed: 0,
    created: 0,
    failed: 0,
    errors: [],
    sample: items.slice(0, 5),
  };
  if (dryRun) return stats;

  async function worker(start) {
    for (let i = start; i < items.length; i += concurrency) {
      const rel = items[i];
      try {
        const created = await derivePreviews(rootDir, rel, { force });
        stats.created += created;
      } catch (err) {
        stats.ok = false;
        stats.failed++;
        if (stats.errors.length < 10) {
          stats.errors.push({ rel, message: err?.message || String(err) });
        }
      } finally {
        stats.processed++;
        if (typeof options.onProgress === "function") {
          options.onProgress({ ...stats, errors: [...stats.errors] });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, (_, i) => worker(i)));
  return stats;
}

const encodeRel = (p) => p.split(/[/\\]/).map(encodeURIComponent).join("/");

export function variantUrls(rel) {
  return {
    url:   `/${DIR}/${encodeRel(rel)}`,
    thumb: `/${DIR}/${THUMBS_DIR}/${encodeRel(rel)}.thumb.webp`,
    web:   `/${DIR}/${THUMBS_DIR}/${encodeRel(rel)}.web.webp`,
  };
}

export function thumbsRelFromAssetRel(rel, suffix = ".thumb.webp") {
  return `${THUMBS_DIR}/${rel}${suffix}`;
}
