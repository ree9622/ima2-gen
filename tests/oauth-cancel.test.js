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

test("runResponses honors stream:true when a proxy forwards a JSON content type", async () => {
  const image = Buffer.from("image-bytes").toString("base64");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      `event: response.output_item.done\n` +
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        item: { type: "image_generation_call", result: image },
      })}\n\n` +
      `event: response.completed\n` +
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { usage: { total_tokens: 12 } },
      })}\n\n`,
    );
  });
  const port = await listen(server);

  try {
    const result = await runResponses({
      url: `http://127.0.0.1:${port}`,
      body: { stream: true },
    });
    assert.equal(result.b64, image);
    assert.equal(result.eventCount, 2);
    assert.equal(result.usage.total_tokens, 12);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
