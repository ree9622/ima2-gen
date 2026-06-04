import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { backfillPreviews } from "../lib/imageVariants.js";

function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "ima2-variants-"));
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

async function seedPng(root, rel) {
  const target = join(root, "generated", rel);
  await mkdir(dirname(target), { recursive: true });
  await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 50, g: 90, b: 130, alpha: 1 },
    },
  }).png().toFile(target);
  return target;
}

describe("backfillPreviews", () => {
  it("dry-run discovers generated images and skips internal dirs", async () => {
    await withTempRoot(async (root) => {
      await seedPng(root, "top.png");
      await seedPng(root, "nested/child.png");
      await seedPng(root, ".trash/hidden.png");

      const result = await backfillPreviews(root, { dryRun: true });
      assert.equal(result.dryRun, true);
      assert.equal(result.total, 2);
      assert.deepEqual(result.sample.sort(), ["nested/child.png", "top.png"]);
      assert.equal(existsSync(join(root, "generated", ".thumbs")), false);
    });
  });

  it("creates missing thumb and web variants once", async () => {
    await withTempRoot(async (root) => {
      await seedPng(root, "top.png");
      await seedPng(root, "nested/child.png");

      const first = await backfillPreviews(root, { concurrency: 2 });
      assert.equal(first.ok, true);
      assert.equal(first.total, 2);
      assert.equal(first.processed, 2);
      assert.equal(first.created, 4);
      assert.equal(existsSync(join(root, "generated", ".thumbs", "top.png.thumb.webp")), true);
      assert.equal(existsSync(join(root, "generated", ".thumbs", "top.png.web.webp")), true);
      assert.equal(existsSync(join(root, "generated", ".thumbs", "nested", "child.png.thumb.webp")), true);

      const second = await backfillPreviews(root, { concurrency: 2 });
      assert.equal(second.total, 2);
      assert.equal(second.processed, 2);
      assert.equal(second.created, 0);
    });
  });
});
