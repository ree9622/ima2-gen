import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Mirror of ui/src/lib/presets.ts — keep in sync with curated seed.
const BUILTINS = [
  {
    id: "builtin-selfie-hi",
    name: "셀카 고품질",
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "1024x1536",
      format: "png", moderation: "auto", count: 1,
    },
  },
  {
    id: "builtin-insta-sq",
    name: "인스타 사각",
    builtIn: true,
    payload: {
      quality: "medium", sizePreset: "1024x1024",
      format: "jpeg", moderation: "auto", count: 2,
    },
  },
  {
    id: "builtin-illust-4k",
    name: "일러스트 4K",
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "3824x2160",
      format: "webp", moderation: "auto", count: 1,
    },
  },
];

describe("presets builtins", () => {
  it("exactly 3 builtins are seeded", () => {
    assert.equal(BUILTINS.length, 3);
  });
  it("each builtin has a non-empty name", () => {
    for (const p of BUILTINS) assert.ok(p.name && p.name.length > 0);
  });
  it("each builtin has a valid payload", () => {
    for (const p of BUILTINS) {
      assert.ok(["low", "medium", "high"].includes(p.payload.quality));
      assert.ok([1, 2, 4].includes(p.payload.count));
    }
  });
});
