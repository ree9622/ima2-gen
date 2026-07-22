import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("failed generations persist reference lineage for exact retries", async () => {
  const server = await readFile("server.js", "utf8");
  assert.match(server, /references: Array\.isArray\(references\) \? references : \[\]/);
  assert.match(server, /references: refLineage/);
  assert.match(server, /references: Array\.isArray\(m\.references\) \? m\.references : \[\]/);
});

test("generation-log retry restores prompt metadata and attached images", async () => {
  const store = await readFile("ui/src/store/useAppStore.ts", "utf8");
  assert.match(store, /loadRetryReferences\(item\.references\)/);
  assert.match(store, /originalPrompt: item\.originalPrompt \?\? null/);
  assert.match(store, /overrideReferences: retryReferences\.base64/);
  assert.match(store, /overrideReferenceMeta: retryReferences\.hints/);
  assert.doesNotMatch(store, /참조 이미지는 재시도에 포함되지 않습니다/);
});
