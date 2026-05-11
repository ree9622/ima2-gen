import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("DELETE /api/inflight aborts the active generation controller", () => {
  const server = readFileSync("server.js", "utf8");

  assert.match(server, /activeGenerationControllers\s*=\s*new Map/);
  assert.match(server, /function registerActiveGeneration/);
  assert.match(server, /function abortActiveGeneration/);
  assert.match(server, /abortActiveGeneration\(req\.params\.requestId\)/);
  assert.match(server, /abortSignal:\s*generationAbort\.signal/);
});

test("generation, edit, node, and LLM rewrite calls pass cancel signals into runResponses", () => {
  const server = readFileSync("server.js", "utf8");
  const rewrite = readFileSync("lib/llmRewrite.js", "utf8");
  const stream = readFileSync("lib/oauthStream.js", "utf8");

  assert.match(server, /generateViaOAuth\(.*options = \{\}/);
  assert.match(server, /signal:\s*abortSignal/);
  assert.match(server, /editViaOAuth\(.*options = \{\}/);
  assert.match(server, /signal:\s*ctx\.abortSignal/);
  assert.match(server, /rewritePromptForSafety\(\{[\s\S]*signal:\s*ctx\.abortSignal/);

  assert.match(rewrite, /signal = null/);
  assert.match(rewrite, /runResponses\(\{ url: oauthUrl, body, signal \}\)/);

  assert.match(stream, /export async function runResponses\(\{ url, body, onPhase, onPartialImage, signal \}\)/);
  assert.match(stream, /_acquireOauthSlot\(signal\)/);
});
