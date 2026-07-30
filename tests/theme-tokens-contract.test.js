import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// index.css의 :root가 정의하는 토큰만 쓴다. 정의되지 않은 이름(--muted/--fg/--line)은
// 폴백값으로 굳어져 라이트 테마에서 흰 배경 + 회색 글자 = 안 보이는 상태가 된다.
test("components only use CSS variables that index.css defines", async () => {
  const css = await readFile("ui/src/index.css", "utf8");
  const defined = new Set(
    [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
  );
  assert.ok(defined.has("--text"), "sanity: --text should be defined");

  const dir = "ui/src/components";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".tsx"));
  const bad = [];
  for (const file of files) {
    const src = await readFile(`${dir}/${file}`, "utf8");
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)/gi)) {
      if (!defined.has(m[1])) bad.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `undefined CSS variables used:\n${bad.join("\n")}`);
});

test("failure popup thumbnails surface load errors instead of blanking", async () => {
  const modal = await readFile("ui/src/components/ActivityDetailModal.tsx", "utf8");
  assert.match(modal, /onError=\{\(e\) => \{/);
  assert.match(modal, /dataset\.broken = "true"/);
});
