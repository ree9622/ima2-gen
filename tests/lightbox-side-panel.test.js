import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop lightbox places prompt metadata beside the image", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("../ui/src/components/Lightbox.tsx", import.meta.url), "utf8"),
    readFile(new URL("../ui/src/index.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /lightbox--with-caption/);
  assert.match(styles, /@media \(min-width: 1200px\)[\s\S]*\.lightbox--with-caption\s*\{/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) var\(--lightbox-caption-width\)/);
  assert.match(styles, /\.lightbox--with-caption \.lightbox__caption\s*\{[\s\S]*position:\s*relative/);
});
