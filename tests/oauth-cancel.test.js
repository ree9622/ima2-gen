import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runResponses } from "../lib/oauthStream.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("runResponses aborts promptly when the caller cancels", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: {\"type\":\"response.created\"}\n\n");
  });
  const port = await listen(server);

  const ac = new AbortController();
  const cancelReason = new Error("generation canceled by test");
  cancelReason.code = "GENERATION_CANCELED";
  cancelReason.status = 499;

  const pending = runResponses({
    url: `http://127.0.0.1:${port}`,
    body: { stream: true },
    signal: ac.signal,
  }).then(
    () => ({ type: "resolved" }),
    (error) => ({ type: "rejected", error }),
  );

  setTimeout(() => ac.abort(cancelReason), 40);
  const outcome = await Promise.race([
    pending,
    delay(500).then(() => ({ type: "timeout" })),
  ]);

  if (outcome.type === "timeout") {
    server.closeAllConnections?.();
    server.close();
    await pending;
  } else {
    server.closeAllConnections?.();
    server.close();
  }

  assert.equal(outcome.type, "rejected");
  assert.equal(outcome.error.code, "GENERATION_CANCELED");
  assert.equal(outcome.error.status, 499);
});
