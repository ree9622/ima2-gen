import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadBundles,
  saveBundles,
  bundleVisibleTo,
  normalizeTags,
  makeBundle,
  applyPatch,
  ValidationError,
  NAME_MAX,
  PROMPT_MAX,
  TAG_MAX_LEN,
  TAG_MAX_COUNT,
} from "../lib/promptBundles.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "promptbundles-"));
});

describe("normalizeTags", () => {
  it("returns [] for non-array input", () => {
    assert.deepEqual(normalizeTags(undefined), []);
    assert.deepEqual(normalizeTags(null), []);
    assert.deepEqual(normalizeTags("nope"), []);
  });

  it("trims, drops empty, and dedupes case-insensitively", () => {
    const out = normalizeTags(["  beach ", "BEACH", "Beach", "", "swim"]);
    assert.deepEqual(out, ["beach", "swim"]);
  });

  it("clamps tag length and total count", () => {
    const long = "a".repeat(TAG_MAX_LEN + 5);
    const arr = [long, "b", "c", "d", "e", "f", "g"];
    const out = normalizeTags(arr);
    assert.equal(out.length, TAG_MAX_COUNT);
    assert.equal(out[0].length, TAG_MAX_LEN);
  });

  it("ignores non-string entries", () => {
    assert.deepEqual(normalizeTags(["ok", 1, null, "two"]), ["ok", "two"]);
  });
});

describe("makeBundle", () => {
  it("builds a valid bundle with id/createdAt/updatedAt", () => {
    const b = makeBundle({ name: " 비키니 패턴 ", prompt: "한국 20대 여성", owner: "ko" });
    assert.equal(b.name, "비키니 패턴");
    assert.equal(b.prompt, "한국 20대 여성");
    assert.deepEqual(b.tags, []);
    assert.equal(b.owner, "ko");
    assert.match(b.id, /^p_\d+_[0-9a-f]{8}$/);
    assert.ok(b.createdAt > 0);
    assert.equal(b.createdAt, b.updatedAt);
  });

  it("clamps name and prompt length", () => {
    const longName = "n".repeat(NAME_MAX + 50);
    const longPrompt = "p".repeat(PROMPT_MAX + 1000);
    const b = makeBundle({ name: longName, prompt: longPrompt });
    assert.equal(b.name.length, NAME_MAX);
    assert.equal(b.prompt.length, PROMPT_MAX);
  });

  it("normalizes tags", () => {
    const b = makeBundle({
      name: "x",
      prompt: "y",
      tags: ["A", "a", "B", "", "C"],
    });
    assert.deepEqual(b.tags, ["A", "B", "C"]);
  });

  it("rejects empty name", () => {
    assert.throws(
      () => makeBundle({ name: "   ", prompt: "ok" }),
      (err) => err instanceof ValidationError && err.code === "BUNDLE_NAME_REQUIRED",
    );
  });

  it("rejects empty prompt (whitespace-only)", () => {
    assert.throws(
      () => makeBundle({ name: "ok", prompt: "   \n  " }),
      (err) => err instanceof ValidationError && err.code === "BUNDLE_PROMPT_REQUIRED",
    );
  });

  it("falls back to legacy owner when authUser is absent", () => {
    const b = makeBundle({ name: "x", prompt: "y" });
    assert.equal(b.owner, "_legacy");
  });
});

describe("applyPatch", () => {
  let target;
  beforeEach(() => {
    target = makeBundle({ name: "old", prompt: "old prompt", tags: ["a"] });
  });

  it("updates only provided fields and bumps updatedAt", async () => {
    const before = target.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    applyPatch(target, { name: "new" });
    assert.equal(target.name, "new");
    assert.equal(target.prompt, "old prompt");
    assert.deepEqual(target.tags, ["a"]);
    assert.ok(target.updatedAt > before);
  });

  it("normalizes tags on patch", () => {
    applyPatch(target, { tags: ["X", "x", "Y"] });
    assert.deepEqual(target.tags, ["X", "Y"]);
  });

  it("rejects empty name on patch", () => {
    assert.throws(
      () => applyPatch(target, { name: "" }),
      (err) => err instanceof ValidationError && err.code === "BUNDLE_NAME_REQUIRED",
    );
  });

  it("rejects whitespace-only prompt on patch", () => {
    assert.throws(
      () => applyPatch(target, { prompt: "  \t  " }),
      (err) => err instanceof ValidationError && err.code === "BUNDLE_PROMPT_REQUIRED",
    );
  });

  it("ignores undefined fields (no-op)", () => {
    applyPatch(target, {});
    assert.equal(target.name, "old");
    assert.equal(target.prompt, "old prompt");
    assert.deepEqual(target.tags, ["a"]);
  });
});

describe("bundleVisibleTo", () => {
  it("treats every bundle as visible when no auth", () => {
    assert.equal(bundleVisibleTo({ owner: "anyone" }, undefined), true);
    assert.equal(bundleVisibleTo({ owner: "anyone" }, null), true);
  });

  it("filters by owner when auth is set", () => {
    assert.equal(bundleVisibleTo({ owner: "ko" }, "ko"), true);
    assert.equal(bundleVisibleTo({ owner: "ko" }, "alice"), false);
  });

  it("treats missing owner as legacy (visible to legacy auth only)", () => {
    assert.equal(bundleVisibleTo({}, undefined), true);
    assert.equal(bundleVisibleTo({}, "_legacy"), true);
    assert.equal(bundleVisibleTo({}, "ko"), false);
  });
});

describe("loadBundles / saveBundles (atomic JSON)", () => {
  it("returns [] when file is missing", async () => {
    const out = await loadBundles({ dir });
    assert.deepEqual(out, []);
  });

  it("round-trips a saved list", async () => {
    const a = makeBundle({ name: "alpha", prompt: "AAA" });
    const b = makeBundle({ name: "bravo", prompt: "BBB" });
    await saveBundles([a, b], { dir });
    const loaded = await loadBundles({ dir });
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].name, "alpha");
    assert.equal(loaded[1].name, "bravo");
  });

  it("returns [] when JSON is corrupt", async () => {
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, "promptBundles.json"), "{ not json");
    assert.deepEqual(await loadBundles({ dir }), []);
  });

  it("creates the directory if it does not yet exist", async () => {
    const nested = join(dir, "nested-fresh");
    await saveBundles([makeBundle({ name: "x", prompt: "y" })], { dir: nested });
    const loaded = await loadBundles({ dir: nested });
    assert.equal(loaded.length, 1);
  });
});

// teardown — node:test doesn't have afterEach by default in the imports above,
// so just clean up via process exit. Tests run fast enough that a few stray
// tmpdirs are fine; but explicit cleanup would import afterEach if needed.
process.on("exit", () => {
  // Best-effort — ignore failures (the OS will reap the tmpdir eventually).
  try {
    if (dir) rmSync(dir, { recursive: true, force: true });
  } catch {}
});
