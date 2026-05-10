import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("lightbox supports page-key navigation in addition to arrows", () => {
  const source = readFileSync("ui/src/components/Lightbox.tsx", "utf8");

  assert.match(source, /PageDown/);
  assert.match(source, /PageUp/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
});
