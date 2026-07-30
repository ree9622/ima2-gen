import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("empty upstream responses carry their diagnostics onto the error", async () => {
  const server = await readFile("server.js", "utf8");
  assert.match(server, /function attachStreamDiagnostics\(err, \.\.\.results\)/);
  // Both empty paths — reference mode and the post-retry fallback — must attach.
  const refMode = server.slice(server.indexOf("stream EMPTY in ref-mode"));
  assert.match(refMode.slice(0, 1200), /attachStreamDiagnostics\(e, stream\)/);
  assert.match(server, /attachStreamDiagnostics\(e, stream, retry\)/);
  // The model's prose answer is the usual clue for a ref-mode empty.
  assert.match(server, /err\.outputText = r\.text\.trim\(\)/);
});

test("attempt logs persist the failure evidence", async () => {
  const server = await readFile("server.js", "utf8");
  // 4 failure-side attempt-log entries: generate + edit, thrown + empty.
  const occurrences = server.match(/outputText: /g) ?? [];
  assert.ok(
    occurrences.length >= 4,
    `expected outputText on every failure attempt log, saw ${occurrences.length}`,
  );
  const types = await readFile("ui/src/types.ts", "utf8");
  const attemptLog = types.slice(
    types.indexOf("export type AttemptLog"),
    types.indexOf("export type GenerationLogItem"),
  );
  for (const field of [
    "refusalText",
    "outputText",
    "reasoningSummary",
    "violationCategories",
    "eventTypeCounts",
  ]) {
    assert.match(attemptLog, new RegExp(`${field}\\?:`), `AttemptLog missing ${field}`);
  }
});

test("failure popup and generation log both render the evidence", async () => {
  const shared = await readFile("ui/src/components/PromptRuntimeBlock.tsx", "utf8");
  assert.match(shared, /export function AttemptDiagnostics/);
  assert.match(shared, /모델 거절 문구/);
  assert.match(shared, /이미지 대신 돌아온 답변/);
  assert.match(shared, /스트림 이벤트/);

  const detail = await readFile("ui/src/components/ActivityDetailModal.tsx", "utf8");
  assert.match(detail, /AttemptDiagnostics/);
  // Surfaced next to the failure reason, not only inside the attempt list.
  assert.match(detail, /diagAttempt \? <AttemptDiagnostics attempt=\{diagAttempt\}/);

  const log = await readFile("ui/src/components/GenerationLogModal.tsx", "utf8");
  assert.match(log, /<AttemptDiagnostics attempt=\{a\} \/>/);
});
