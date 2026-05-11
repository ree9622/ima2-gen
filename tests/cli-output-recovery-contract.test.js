import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recoverGeneratedImages } from "../bin/lib/client.js";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test("recovers generated image data by requestId from generation log", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const { server, base } = await listen((req, res) => {
    if (req.url.startsWith("/api/generation-log")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        items: [{
          status: "success",
          requestId: "cli_test_1",
          filename: "done.png",
          url: "/generated/done.png",
          createdAt: 2,
        }],
      }));
      return;
    }
    if (req.url === "/generated/done.png") {
      res.setHeader("content-type", "image/png");
      res.end(png);
      return;
    }
    res.statusCode = 404;
    res.end("missing");
  });

  try {
    const recovered = await recoverGeneratedImages(base, "cli_test_1", { timeoutMs: 1000, pollMs: 5 });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.requestId, "cli_test_1");
    assert.equal(recovered.images.length, 1);
    assert.equal(recovered.images[0].filename, "done.png");
    assert.equal(recovered.images[0].image, `data:image/png;base64,${png.toString("base64")}`);
  } finally {
    server.close();
  }
});

test("generate and edit commands attempt recovery after request timeout", () => {
  const gen = readFileSync("bin/commands/gen.js", "utf8");
  const edit = readFileSync("bin/commands/edit.js", "utf8");

  assert.match(gen, /recoverGeneratedImages/);
  assert.match(gen, /const requestId = newRequestId\(\)/);
  assert.match(gen, /isTimeoutError\(e\)/);
  assert.match(edit, /recoverGeneratedImages/);
  assert.match(edit, /const requestId = newRequestId\(\)/);
  assert.match(edit, /isTimeoutError\(e\)/);
});
