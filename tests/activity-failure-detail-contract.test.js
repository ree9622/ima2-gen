import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server resolves a failure record by client request id", async () => {
  const server = await readFile("server.js", "utf8");
  assert.match(server, /function mapFailedLogItem\(m\)/);
  assert.match(
    server,
    /app\.get\("\/api\/generation-log\/failed\/by-request\/:requestId"/,
  );
  // Owner scoping must survive the lookup — the list route already filters.
  assert.match(server, /m\.requestId === requestId && canAccess\(m, req\.authUser\)/);
});

test("activity retry restores the attached images from the server record", async () => {
  const store = await readFile("ui/src/store/useAppStore.ts", "utf8");
  const retryActivity = store.slice(store.indexOf("  retryActivity: async (id) => {"));
  assert.match(retryActivity, /getFailedLogByRequestId\(id\)/);
  assert.match(retryActivity, /await get\(\)\.retryFromLog\(record\)/);
  const api = await readFile("ui/src/lib/api.ts", "utf8");
  assert.match(api, /export async function getFailedLogByRequestId/);
  assert.match(api, /\/api\/generation-log\/failed\/by-request\//);
});

test("failed activity rows open a detail popup", async () => {
  const list = await readFile("ui/src/components/InFlightList.tsx", "utf8");
  assert.match(list, /openActivityDetail\(f\.id\)/);
  const store = await readFile("ui/src/store/useAppStore.ts", "utf8");
  assert.match(store, /activityDetailId: string \| null/);
  assert.match(store, /openActivityDetail: \(id\) => set\(\{ activityDetailId: id \}\)/);
});

test("failure popup shows the reason, prompt and clickable attachments", async () => {
  const modal = await readFile("ui/src/components/ActivityDetailModal.tsx", "utf8");
  assert.match(modal, /실패 사유/);
  assert.match(modal, /프롬프트/);
  assert.match(modal, /첨부 이미지/);
  // Thumbnails open the original in a new tab.
  assert.match(modal, /href=\{ref\.sourceUrl\}/);
  assert.match(modal, /target="_blank"/);
  assert.match(modal, /rel="noreferrer"/);
  // Per-attempt errors + developer prompt reuse the shared runtime block.
  assert.match(modal, /PromptRuntimeBlock/);
});

test("prompt runtime block is shared, not duplicated", async () => {
  const shared = await readFile("ui/src/components/PromptRuntimeBlock.tsx", "utf8");
  assert.match(shared, /export function PromptRuntimeBlock/);
  const log = await readFile("ui/src/components/GenerationLogModal.tsx", "utf8");
  assert.match(log, /import \{[^}]*\bPromptRuntimeBlock\b[^}]*\} from "\.\/PromptRuntimeBlock"/);
  assert.doesNotMatch(log, /function PromptRuntimeBlock\(/);
});
