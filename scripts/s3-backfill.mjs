#!/usr/bin/env node
// One-time (idempotent) backfill: upload every existing generated/ asset to S3
// that is not already there. Includes png/sidecar/.thumbs/.refs; excludes
// .trash and .failed. Safe to re-run — existing keys are skipped (HEAD check).
//
// Usage:
//   IMA2_S3_BUCKET=samlab-ima2-gen node scripts/s3-backfill.mjs [--dry-run]

import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { join, relative, sep, dirname } from "path";
import { fileURLToPath } from "url";
import { s3Enabled, s3Bucket, s3Head, s3Put, contentTypeFor } from "../lib/s3Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN = join(__dirname, "..", "generated");
const EXCLUDE_DIRS = new Set([".trash", ".failed"]);
const DRY = process.argv.includes("--dry-run");

if (!s3Enabled()) {
  console.error("IMA2_S3_BUCKET not set — nothing to do.");
  process.exit(1);
}

let scanned = 0;
let uploaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

async function walk(d, left) {
  const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = join(d, e.name);
    if (e.isDirectory() && left > 0) {
      await walk(full, left - 1);
      continue;
    }
    if (!e.isFile()) continue;
    const key = relative(GEN, full).split(sep).join("/");
    scanned++;
    try {
      const head = await s3Head(key);
      if (head) {
        skipped++;
        continue;
      }
      const st = await stat(full);
      if (!DRY) {
        await s3Put(key, createReadStream(full), contentTypeFor(key));
      }
      uploaded++;
      bytes += st.size;
      if (uploaded % 200 === 0) {
        console.log(`  …${uploaded} uploaded (${(bytes / 1e9).toFixed(2)} GB)`);
      }
    } catch (err) {
      failed++;
      console.warn("FAIL", key, err?.message || err);
    }
  }
}

console.log(`Backfill → s3://${s3Bucket()}  dryRun=${DRY}`);
await walk(GEN, 2);
console.log(
  `done: scanned=${scanned} uploaded=${uploaded} skipped=${skipped} failed=${failed} bytes=${(bytes / 1e9).toFixed(2)}GB`,
);
process.exit(failed > 0 ? 2 : 0);
