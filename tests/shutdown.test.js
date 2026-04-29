// Unit tests for the async-aware onShutdown helper.
// We exercise the helper by emitting SIGTERM at the process level inside
// a child Node subprocess (so the parent Node test runner doesn't itself
// terminate). The child writes a tiny report to stdout that we parse.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const platformPath = join(__dirname, "..", "bin", "lib", "platform.js");

function runOnShutdownChild(handlerSource, signalDelayMs = 50, timeoutMs = 5000) {
  // Build a tiny program that:
  //   1. imports onShutdown
  //   2. registers an async handler whose body is `handlerSource`
  //   3. self-signals after `signalDelayMs` ms
  //   4. process.exit happens inside onShutdown — we capture stdout via the
  //      child's piped output
  const code = `
import { onShutdown } from ${JSON.stringify(platformPath)};

const start = Date.now();
onShutdown(async (sig) => {
  console.log("HANDLER_BEGIN " + sig + " " + (Date.now() - start));
  ${handlerSource}
  console.log("HANDLER_END " + (Date.now() - start));
});

setTimeout(() => {
  console.log("SIGNAL " + (Date.now() - start));
  process.kill(process.pid, "SIGTERM");
}, ${signalDelayMs});

// Keep the event loop alive past the signal delay.
setTimeout(() => {
  console.log("TIMEOUT_REACHED");
  process.exit(2);
}, ${timeoutMs});
`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf-8", timeout: timeoutMs + 1000 },
  );
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
    signal: result.signal,
  };
}

describe("onShutdown (async-aware)", () => {
  it("awaits async handler before process.exit", () => {
    // Handler sleeps 200ms before completing. If onShutdown didn't await,
    // HANDLER_END would never appear (process.exit fires first).
    const r = runOnShutdownChild(
      `await new Promise((res) => setTimeout(res, 200));`,
      50,
      3000,
    );
    assert.equal(r.status, 0, `expected exit 0, got ${r.status} stderr=${r.stderr}`);
    assert.match(r.stdout, /HANDLER_BEGIN SIGTERM/);
    assert.match(r.stdout, /HANDLER_END/);
    // HANDLER_END timestamp must be ~200ms+ past the signal — proves we waited.
    const m = r.stdout.match(/HANDLER_END (\d+)/);
    const sigM = r.stdout.match(/SIGNAL (\d+)/);
    assert.ok(m && sigM, "missing timing markers in:\n" + r.stdout);
    const elapsed = Number(m[1]) - Number(sigM[1]);
    assert.ok(
      elapsed >= 180,
      `handler should have run ~200ms but only ${elapsed}ms elapsed`,
    );
  });

  it("calls process.exit(0) after the handler completes (no force-kill)", () => {
    const r = runOnShutdownChild(
      `await new Promise((res) => setTimeout(res, 80));`,
      50,
      3000,
    );
    assert.equal(r.status, 0);
    // Should NOT see TIMEOUT_REACHED because exit fires before the long timeout.
    assert.doesNotMatch(r.stdout, /TIMEOUT_REACHED/);
  });

  it("a synchronous handler still works (back-compat)", () => {
    const r = runOnShutdownChild(`/* sync, no await */`, 50, 3000);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /HANDLER_BEGIN SIGTERM/);
    assert.match(r.stdout, /HANDLER_END/);
  });

  it("a second SIGTERM during drain force-exits with code 1", () => {
    // Handler waits 1500ms but we send a second signal at 200ms after the
    // first. Re-entrant path should bail with exit(1).
    const code = `
import { onShutdown } from ${JSON.stringify(platformPath)};
const start = Date.now();
onShutdown(async () => {
  console.log("HANDLER_BEGIN " + (Date.now() - start));
  await new Promise((res) => setTimeout(res, 1500));
  console.log("HANDLER_END_SHOULD_NOT_APPEAR");
});
setTimeout(() => process.kill(process.pid, "SIGTERM"), 50);
setTimeout(() => process.kill(process.pid, "SIGTERM"), 250);
setTimeout(() => process.exit(2), 3000);
`;
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      { encoding: "utf-8", timeout: 4000 },
    );
    assert.equal(r.status, 1, `expected forced exit 1, got ${r.status}`);
    assert.match(r.stdout, /HANDLER_BEGIN/);
    assert.doesNotMatch(r.stdout, /HANDLER_END_SHOULD_NOT_APPEAR/);
  });

  it("an async handler that throws still exits cleanly with 0", () => {
    const r = runOnShutdownChild(
      `throw new Error("boom");`,
      50,
      3000,
    );
    assert.equal(r.status, 0, `expected clean exit even when handler throws, got ${r.status}`);
    assert.match(r.stderr, /handler threw on SIGTERM.*boom/);
  });
});
