#!/usr/bin/env node
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { backfillPreviews } from "../lib/imageVariants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const concArg = process.argv.find((a) => a.startsWith("--concurrency="));
const concurrency = concArg ? parseInt(concArg.split("=")[1], 10) : 4;

console.log(`[backfill] root=${ROOT} dryRun=${dryRun} force=${force} limit=${limit} concurrency=${concurrency}`);

let lastLogged = 0;
const t0 = Date.now();
const result = await backfillPreviews(ROOT, {
  dryRun,
  force,
  limit,
  concurrency,
  onProgress(stats) {
    if (stats.processed % 25 !== 0 && stats.processed !== stats.total) return;
    if (stats.processed === lastLogged) return;
    lastLogged = stats.processed;
    const dt = (Date.now() - t0) / 1000;
    const rate = stats.processed / Math.max(dt, 0.001);
    const eta = ((stats.total - stats.processed) / Math.max(rate, 0.001)).toFixed(0);
    console.log(`[${stats.processed}/${stats.total}] derived=${stats.created} failed=${stats.failed} rate=${rate.toFixed(1)}/s eta=${eta}s`);
  },
});

console.log(`[backfill] discovered ${result.total} image files`);
if (dryRun) {
  for (const rel of result.sample) console.log("  sample:", rel);
  process.exit(0);
}

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[done] processed=${result.processed} derived=${result.created} failed=${result.failed} elapsed=${dt}s`);
if (!result.ok) process.exitCode = 1;
