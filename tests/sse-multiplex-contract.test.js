import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("node UI subscribes before submitting an async generation job", () => {
  const api = readFileSync("ui/src/lib/api.ts", "utf8");
  const subscribeAt = api.indexOf("subscribeToJob(requestId");
  const fetchAt = api.indexOf('fetch("/api/node/generate"', subscribeAt);

  assert.ok(subscribeAt > 0, "job subscription must exist");
  assert.ok(fetchAt > subscribeAt, "subscription must be installed before POST");
  assert.match(api, /async:\s*true/);
  assert.match(api, /getNodeResult\(requestId\)/);
});

test("server exposes owner-scoped replay and async node dual delivery", () => {
  const server = readFileSync("server.js", "utf8");
  const bus = readFileSync("lib/eventBus.js", "utf8");

  assert.match(server, /app\.get\("\/api\/events"/);
  assert.match(server, /event\.owner !== owner/);
  assert.match(server, /body\.async === true/);
  assert.match(server, /res\.status\(202\)\.json/);
  assert.match(server, /emitNodeEvent\("done", payload\)/);
  assert.match(bus, /delete next\.image/);
  assert.match(bus, /event\.owner === owner/);
});
