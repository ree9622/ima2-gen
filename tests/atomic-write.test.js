import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteJson } from "../lib/atomicWrite.js";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "ima2-atomic-write-"));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("atomicWriteJson", () => {
  it("creates parent directories and replaces JSON without temp leftovers", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "nested", "sidecar.json");
      await atomicWriteJson(target, { ok: true, count: 1 }, { spaces: 2 });
      assert.deepStrictEqual(JSON.parse(readFileSync(target, "utf-8")), { ok: true, count: 1 });

      await atomicWriteJson(target, { ok: true, count: 2 });
      assert.deepStrictEqual(JSON.parse(readFileSync(target, "utf-8")), { ok: true, count: 2 });
      assert.deepStrictEqual(await readdir(dirname(target)), ["sidecar.json"]);
    });
  });

  it("does not create a target file when JSON serialization fails", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "bad.json");
      const circular = {};
      circular.self = circular;
      await assert.rejects(
        () => atomicWriteJson(target, circular),
        TypeError,
      );
      assert.strictEqual(existsSync(target), false);
      assert.deepStrictEqual(await readdir(dir), []);
    });
  });
});
