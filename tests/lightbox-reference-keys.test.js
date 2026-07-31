import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("lightbox reference thumbnails keep unique keys when a reference is repeated", () => {
  const source = readFileSync("ui/src/components/Lightbox.tsx", "utf8");

  assert.match(source, /references\.map\(\(ref, index\) =>/);
  assert.match(source, /key=\{`\$\{ref\.hash\}:\$\{index\}`\}/);
  assert.doesNotMatch(source, /key=\{ref\.hash\}/);
});
