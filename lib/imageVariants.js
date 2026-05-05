import sharp from "sharp";
import { mkdir, access } from "fs/promises";
import { join, dirname } from "path";

const DIR = "generated";
const THUMBS_DIR = ".thumbs";

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
      await sharp(sourcePath, { failOn: "none" })
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
