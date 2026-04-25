#!/usr/bin/env node
// One-shot, idempotent migration: tag every existing image and failed-sidecar
// in generated/ with `owner` = LEGACY_OWNER (default "ree9622"). Sessions DB
// gets the same default via the schema migration in lib/db.js.
//
// Usage:
//   node scripts/migrate-owners.mjs           # default ree9622
//   IMA2_LEGACY_OWNER=foo node scripts/migrate-owners.mjs
//   node scripts/migrate-owners.mjs --dry

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GEN = join(ROOT, "generated");
const FAILED = join(GEN, ".failed");

const OWNER = process.env.IMA2_LEGACY_OWNER || "ree9622";
const DRY = process.argv.includes("--dry");

async function walk(dir, depth = 2, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name === ".trash" || e.name === ".failed") continue;
    const full = join(dir, e.name);
    if (e.isDirectory() && depth > 0) await walk(full, depth - 1, out);
    else if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) out.push(full);
  }
  return out;
}

async function loadOrInit(sidecarPath, fallback) {
  try {
    const raw = await readFile(sidecarPath, "utf-8");
    return { meta: JSON.parse(raw), existed: true };
  } catch (e) {
    if (e.code === "ENOENT") return { meta: { ...fallback }, existed: false };
    throw e;
  }
}

async function migrateImages() {
  const files = await walk(GEN);
  let touched = 0, created = 0, alreadyOwned = 0;
  for (const full of files) {
    const sidecar = full + ".json";
    const st = await stat(full).catch(() => null);
    const fallback = {
      createdAt: st?.mtimeMs ? Math.floor(st.mtimeMs) : Date.now(),
      format: full.split(".").pop().toLowerCase(),
      provider: "oauth",
    };
    const { meta, existed } = await loadOrInit(sidecar, fallback);
    if (typeof meta.owner === "string" && meta.owner) { alreadyOwned++; continue; }
    meta.owner = OWNER;
    if (!DRY) await writeFile(sidecar, JSON.stringify(meta));
    if (existed) touched++; else created++;
  }
  return { totalImages: files.length, touched, created, alreadyOwned };
}

async function migrateFailed() {
  let entries;
  try { entries = await readdir(FAILED, { withFileTypes: true }); }
  catch { return { totalFailed: 0, touched: 0, alreadyOwned: 0 }; }
  let touched = 0, alreadyOwned = 0, total = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    total++;
    const p = join(FAILED, e.name);
    const meta = JSON.parse(await readFile(p, "utf-8"));
    if (typeof meta.owner === "string" && meta.owner) { alreadyOwned++; continue; }
    meta.owner = OWNER;
    if (!DRY) await writeFile(p, JSON.stringify(meta));
    touched++;
  }
  return { totalFailed: total, touched, alreadyOwned };
}

async function migrateTrash() {
  const TRASH = join(GEN, ".trash");
  let entries;
  try { entries = await readdir(TRASH, { withFileTypes: true }); }
  catch { return { totalTrash: 0, touched: 0, alreadyOwned: 0 }; }
  let touched = 0, alreadyOwned = 0, total = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    total++;
    const p = join(TRASH, e.name);
    const meta = JSON.parse(await readFile(p, "utf-8"));
    if (typeof meta.owner === "string" && meta.owner) { alreadyOwned++; continue; }
    meta.owner = OWNER;
    if (!DRY) await writeFile(p, JSON.stringify(meta));
    touched++;
  }
  return { totalTrash: total, touched, alreadyOwned };
}

async function migrateSessionsDb() {
  // The lib/db.js migrate() runs at first getDb(). Calling it here bumps the
  // schema and backfills the owner column for any rows missing it.
  const { getDb, closeDb } = await import("../lib/db.js");
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(sessions)").all().map((r) => r.name);
  if (!cols.includes("owner")) {
    return { ok: false, reason: "owner column missing after migrate()" };
  }
  const before = db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE owner IS NULL OR owner = ''").get().c;
  if (!DRY && before > 0) {
    db.prepare("UPDATE sessions SET owner = ? WHERE owner IS NULL OR owner = ''").run(OWNER);
  }
  const total = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
  closeDb();
  return { ok: true, total, backfilled: before };
}

(async () => {
  console.log(`[migrate-owners] OWNER=${OWNER} DRY=${DRY} ROOT=${ROOT}`);
  const img = await migrateImages();
  console.log("[migrate-owners] images:", img);
  const fail = await migrateFailed();
  console.log("[migrate-owners] failed:", fail);
  const trash = await migrateTrash();
  console.log("[migrate-owners] trash:", trash);
  const sessions = await migrateSessionsDb();
  console.log("[migrate-owners] sessions:", sessions);
  console.log("[migrate-owners] done.");
})().catch((e) => { console.error(e); process.exit(1); });
