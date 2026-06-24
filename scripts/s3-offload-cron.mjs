#!/usr/bin/env node
// Cron entry point: keep generated/ local media under IMA2_LOCAL_CAP_MB by
// offloading the oldest images to S3 (sidecars stay local). No-op if S3 is
// disabled or already under cap.
//
// Usage (cron):
//   IMA2_S3_BUCKET=samlab-ima2-gen IMA2_LOCAL_CAP_MB=2048 \
//     node scripts/s3-offload-cron.mjs [--dry-run]

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { offloadToS3 } from "../lib/s3Offload.js";
import { s3Enabled } from "../lib/s3Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN = join(__dirname, "..", "generated");
const stamp = () => new Date().toISOString();

if (!s3Enabled()) {
  console.log(`[${stamp()}] IMA2_S3_BUCKET not set — skip offload`);
  process.exit(0);
}

const capMb = Number(process.env.IMA2_LOCAL_CAP_MB || 2048);
const dryRun = process.argv.includes("--dry-run");

const result = await offloadToS3(GEN, { capMb, dryRun, keepFavorites: true });
console.log(`[${stamp()}]`, JSON.stringify(result));
process.exit(result.errors > 0 ? 2 : 0);
