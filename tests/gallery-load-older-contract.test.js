import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("gallery history keeps a cursor and loads older pages on demand", () => {
  const store = readFileSync("ui/src/store/useAppStore.ts", "utf8");
  const modal = readFileSync("ui/src/components/GalleryModal.tsx", "utf8");

  assert.match(store, /historyNextCursor:\s*HistoryCursor\s*\|\s*null/);
  assert.match(store, /historyTotal:\s*number/);
  assert.match(store, /historyLoadingMore:\s*boolean/);
  assert.match(store, /loadOlderHistory:\s*\(\)\s*=>\s*Promise<void>/);
  assert.match(store, /getHistory\(\{\s*limit:\s*HISTORY_PAGE_LIMIT,\s*cursor:\s*s\.historyNextCursor/s);
  assert.match(store, /appendUniqueHistory\(state\.history,\s*older\)/);

  assert.match(modal, /historyNextCursor/);
  assert.match(modal, /historyLoadingMore/);
  assert.match(modal, /loadOlderHistory/);
  assert.match(modal, /이전 기록 더 불러오기/);
});
