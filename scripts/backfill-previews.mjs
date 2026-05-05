#!/usr/bin/env node
import { readdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { derivePreviews } from "../lib/imageVariants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const GEN = join(ROOT, "generated");

const SKIP_DIRS = new Set([".trash", ".failed", ".refs", ".thumbs", ".results"]);
const IMG_RE = /\.(png|jpe?g|webp)$/i;

async function* walk(dir, depth = 2, base = "") {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 0) yield* walk(full, depth - 1, rel);
    else if (e.isFile() && IMG_RE.test(e.name)) yield rel;
  }
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const concArg = process.argv.find((a) => a.startsWith("--concurrency="));
const CONCURRENCY = concArg ? parseInt(concArg.split("=")[1], 10) : 4;

console.log(`[backfill] root=${ROOT} dryRun=${dryRun} force=${force} limit=${limit} concurrency=${CONCURRENCY}`);

const items = [];
for await (const rel of walk(GEN)) {
  items.push(rel);
  if (items.length >= limit) break;
}
console.log(`[backfill] discovered ${items.length} image files`);

if (dryRun) {
  for (const rel of items.slice(0, 5)) console.log("  sample:", rel);
  process.exit(0);
}

let processed = 0;
let derivedTotal = 0;
const t0 = Date.now();

async function worker(start) {
  for (let i = start; i < items.length; i += CONCURRENCY) {
    const rel = items[i];
    const n = await derivePreviews(ROOT, rel, { force });
    derivedTotal += n;
    processed++;
    if (processed % 25 === 0 || processed === items.length) {
      const dt = (Date.now() - t0) / 1000;
      const rate = processed / dt;
      const eta = ((items.length - processed) / rate).toFixed(0);
      console.log(`[${processed}/${items.length}] derived=${derivedTotal} rate=${rate.toFixed(1)}/s eta=${eta}s`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[done] processed=${processed} derived=${derivedTotal} elapsed=${dt}s`);
