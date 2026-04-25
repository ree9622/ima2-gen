import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile, utimes, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getStorageStats, pruneStorage } from "../lib/prune.js";

const DAY_MS = 86_400_000;

let root;
let genDir;
let trashDir;
let failedDir;

async function seedImage(dir, name, { age = 0, sidecar = {}, size = 1024 } = {}) {
  await mkdir(dir, { recursive: true });
  const full = join(dir, name);
  await writeFile(full, Buffer.alloc(size, 0x00));
  await writeFile(full + ".json", JSON.stringify({ prompt: "test", ...sidecar }));
  if (age > 0) {
    const past = new Date(Date.now() - age);
    await utimes(full, past, past);
    await utimes(full + ".json", past, past);
  }
  return full;
}

async function seedFailedSidecar(dir, name, { age = 0, payload = {} } = {}) {
  await mkdir(dir, { recursive: true });
  const full = join(dir, name);
  await writeFile(full, JSON.stringify({ status: "failed", ...payload }));
  if (age > 0) {
    const past = new Date(Date.now() - age);
    await utimes(full, past, past);
  }
  return full;
}

async function seedTrashItem(dir, name, { age = 0, size = 2048 } = {}) {
  await mkdir(dir, { recursive: true });
  const imgFull = join(dir, name);
  await writeFile(imgFull, Buffer.alloc(size, 0x00));
  await writeFile(imgFull + ".json", JSON.stringify({ prompt: "trashed" }));
  if (age > 0) {
    const past = new Date(Date.now() - age);
    await utimes(imgFull, past, past);
    await utimes(imgFull + ".json", past, past);
  }
  return imgFull;
}

beforeEach(async () => {
  root = join(tmpdir(), `ima2-prune-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  genDir = join(root, "generated");
  trashDir = join(genDir, ".trash");
  failedDir = join(genDir, ".failed");
  await mkdir(genDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("getStorageStats", () => {
  it("returns zero counts for empty storage", async () => {
    const stats = await getStorageStats(root);
    assert.equal(stats.generated.files, 0);
    assert.equal(stats.generated.images, 0);
    assert.equal(stats.generated.favorites, 0);
    assert.equal(stats.trash.files, 0);
    assert.equal(stats.failed.files, 0);
    assert.equal(stats.totalBytes, 0);
  });

  it("counts generated images, sidecars, favorites separately from trash/failed", async () => {
    await seedImage(genDir, "a.png", { sidecar: { favorite: true }, size: 100 });
    await seedImage(genDir, "b.png", { sidecar: { favorite: false }, size: 200 });
    await seedTrashItem(trashDir, "1700000000_old.png", { size: 300 });
    await seedFailedSidecar(failedDir, "f1.json", { payload: { errorCode: "X" } });

    const stats = await getStorageStats(root);
    assert.equal(stats.generated.images, 2);
    assert.equal(stats.generated.favorites, 1);
    assert.ok(stats.generated.bytes >= 300, "image bytes counted");
    assert.equal(stats.trash.files, 2, "trash image + sidecar");
    assert.equal(stats.failed.files, 1);
  });

  it("excludes .trash and .failed from generated walk", async () => {
    await seedImage(genDir, "a.png", { size: 50 });
    await seedTrashItem(trashDir, "old.png", { size: 99999 });
    await seedFailedSidecar(failedDir, "f.json", {});

    const stats = await getStorageStats(root);
    assert.equal(stats.generated.images, 1);
    assert.ok(stats.generated.bytes < 1000, "trash bytes must not leak into generated");
  });
});

describe("pruneStorage — trash TTL", () => {
  it("deletes trash items older than trashTtlDays", async () => {
    await seedTrashItem(trashDir, "old.png", { age: 10 * DAY_MS });
    await seedTrashItem(trashDir, "new.png", { age: 1 * DAY_MS });

    const r = await pruneStorage(root, { trashTtlDays: 7, failedTtlDays: null });
    assert.equal(r.trash.deleted, 1);
    assert.ok(!existsSync(join(trashDir, "old.png")));
    assert.ok(!existsSync(join(trashDir, "old.png.json")));
    assert.ok(existsSync(join(trashDir, "new.png")));
  });

  it("dryRun reports without deleting", async () => {
    const file = await seedTrashItem(trashDir, "old.png", { age: 30 * DAY_MS });

    const r = await pruneStorage(root, { trashTtlDays: 7, failedTtlDays: null, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.trash.deleted, 1);
    assert.ok(r.trash.freedBytes > 0);
    assert.ok(existsSync(file), "file should still exist in dry-run");
  });

  it("trashTtlDays=null skips trash entirely", async () => {
    await seedTrashItem(trashDir, "old.png", { age: 365 * DAY_MS });
    const r = await pruneStorage(root, { trashTtlDays: null, failedTtlDays: null });
    assert.equal(r.trash.scanned, 0);
    assert.equal(r.trash.deleted, 0);
  });
});

describe("pruneStorage — failed TTL", () => {
  it("deletes failed sidecars older than failedTtlDays", async () => {
    await seedFailedSidecar(failedDir, "old.json", { age: 30 * DAY_MS });
    await seedFailedSidecar(failedDir, "fresh.json", { age: 1 * DAY_MS });

    const r = await pruneStorage(root, { trashTtlDays: null, failedTtlDays: 14 });
    assert.equal(r.failed.deleted, 1);
    assert.ok(!existsSync(join(failedDir, "old.json")));
    assert.ok(existsSync(join(failedDir, "fresh.json")));
  });
});

describe("pruneStorage — generated TTL", () => {
  it("deletes images older than genTtlDays, preserves favorites by default", async () => {
    await seedImage(genDir, "old.png", { age: 100 * DAY_MS });
    await seedImage(genDir, "old-fav.png", {
      age: 100 * DAY_MS,
      sidecar: { favorite: true },
    });
    await seedImage(genDir, "fresh.png", { age: 1 * DAY_MS });

    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genTtlDays: 30,
    });
    assert.equal(r.generated.deleted, 1);
    assert.equal(r.generated.skippedFavorites, 1);
    assert.ok(!existsSync(join(genDir, "old.png")));
    assert.ok(!existsSync(join(genDir, "old.png.json")));
    assert.ok(existsSync(join(genDir, "old-fav.png")));
    assert.ok(existsSync(join(genDir, "fresh.png")));
  });

  it("keepFavorites=false also removes old favorites", async () => {
    await seedImage(genDir, "old-fav.png", {
      age: 100 * DAY_MS,
      sidecar: { favorite: true },
    });

    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genTtlDays: 30,
      keepFavorites: false,
    });
    assert.equal(r.generated.deleted, 1);
    assert.equal(r.generated.skippedFavorites, 0);
    assert.ok(!existsSync(join(genDir, "old-fav.png")));
  });

  it("walks session subdirectories up to 2 levels deep", async () => {
    const sessionDir = join(genDir, "session-1", "nodes");
    await seedImage(sessionDir, "deep.png", { age: 100 * DAY_MS, size: 64 });

    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genTtlDays: 30,
    });
    assert.equal(r.generated.deleted, 1);
    assert.ok(!existsSync(join(sessionDir, "deep.png")));
  });
});

describe("pruneStorage — generated size cap", () => {
  it("removes oldest non-favorite first until under cap", async () => {
    // 4 files × 200KB each = 800KB; cap at 500KB → expect 2 oldest removed
    await seedImage(genDir, "oldest.png", { age: 4 * DAY_MS, size: 200 * 1024 });
    await seedImage(genDir, "older.png", { age: 3 * DAY_MS, size: 200 * 1024 });
    await seedImage(genDir, "newer.png", { age: 2 * DAY_MS, size: 200 * 1024 });
    await seedImage(genDir, "newest.png", { age: 1 * DAY_MS, size: 200 * 1024 });

    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genMaxMb: 0.5,
    });
    assert.ok(r.generated.deleted >= 2, `expected ≥2 deleted, got ${r.generated.deleted}`);
    assert.ok(!existsSync(join(genDir, "oldest.png")));
    assert.ok(!existsSync(join(genDir, "older.png")));
    assert.ok(existsSync(join(genDir, "newest.png")));

    const stats = await getStorageStats(root);
    assert.ok(stats.generated.bytes <= 0.5 * 1024 * 1024, "should be under cap after prune");
  });

  it("preserves favorites even under size pressure", async () => {
    await seedImage(genDir, "fav-old.png", {
      age: 5 * DAY_MS,
      size: 300 * 1024,
      sidecar: { favorite: true },
    });
    await seedImage(genDir, "regular-new.png", { age: 1 * DAY_MS, size: 300 * 1024 });

    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genMaxMb: 0.1, // forces deletion
    });
    // Only the non-favorite is eligible
    assert.equal(r.generated.deleted, 1);
    assert.ok(existsSync(join(genDir, "fav-old.png")), "favorite must survive");
    assert.ok(!existsSync(join(genDir, "regular-new.png")));
  });

  it("does not delete anything when total is already under cap", async () => {
    await seedImage(genDir, "small.png", { age: 1 * DAY_MS, size: 100 });
    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genMaxMb: 10,
    });
    assert.equal(r.generated.deleted, 0);
  });
});

describe("pruneStorage — combined policies", () => {
  it("returns deletedFilenames for caller to act on (e.g. mark nodes asset-missing)", async () => {
    await seedImage(genDir, "a.png", { age: 100 * DAY_MS });
    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genTtlDays: 30,
      dryRun: true,
    });
    assert.deepEqual(r.generated.deletedFilenames, ["a.png"]);
  });

  it("freedBytes is non-zero when files are deleted", async () => {
    await seedImage(genDir, "a.png", { age: 100 * DAY_MS, size: 1024 });
    const r = await pruneStorage(root, {
      trashTtlDays: null,
      failedTtlDays: null,
      genTtlDays: 30,
    });
    assert.ok(r.generated.freedBytes >= 1024);
  });

  it("handles missing generated/.trash/.failed directories gracefully", async () => {
    // root exists but generated/ subdirs do not — stats and prune both succeed
    await rm(genDir, { recursive: true, force: true });
    const stats = await getStorageStats(root);
    assert.equal(stats.totalBytes, 0);
    const r = await pruneStorage(root, { trashTtlDays: 1, failedTtlDays: 1, genTtlDays: 1 });
    assert.equal(r.generated.deleted, 0);
    assert.equal(r.trash.deleted, 0);
    assert.equal(r.failed.deleted, 0);
  });
});
