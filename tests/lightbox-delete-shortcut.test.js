import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("lightbox delete shortcut survives IME key values and stopped bubbling", () => {
  const source = readFileSync("ui/src/components/Lightbox.tsx", "utf8");

  assert.match(source, /e\.key === "Delete"/);
  assert.match(source, /e\.key === "Del"/);
  assert.match(source, /e\.key === "Backspace"/);
  assert.match(source, /e\.code === "Delete"/);
  assert.match(source, /addEventListener\("keydown", onDeleteKey, true\)/);
  assert.match(source, /removeEventListener\("keydown", onDeleteKey, true\)/);
  assert.match(source, /addEventListener\("keydown", onKey\)/);
  assert.match(source, /if \(e\.repeat\) return/);
});
