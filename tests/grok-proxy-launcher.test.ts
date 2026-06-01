import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isGrokProxyAuthRequiredMessage,
  normalizeGrokProxyMessage,
  startGrokProxy,
} from "../lib/grokProxyLauncher.ts";

test("Grok proxy auth errors are recognized as non-restartable setup state", () => {
  assert.equal(
    isGrokProxyAuthRequiredMessage("[grok] Not logged in. Run `progrok login` first."),
    true,
  );
  assert.equal(
    isGrokProxyAuthRequiredMessage("[grok] Not logged in. Run `ima2 grok login` first."),
    true,
  );
  assert.equal(
    isGrokProxyAuthRequiredMessage("[grok] upstream connection reset"),
    false,
  );
});

test("Grok proxy auth guidance points users at ima2, not progrok", () => {
  assert.equal(
    normalizeGrokProxyMessage("Not logged in. Run `progrok login` first."),
    "Not logged in. Run `ima2 grok login` first.",
  );
  assert.equal(
    normalizeGrokProxyMessage("Run progrok login first."),
    "Run `ima2 grok login` first.",
  );
});

test("Grok proxy auth failure exits without restart loop", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ima2-grok-proxy-test-"));
  const fakeProgrok = join(tempDir, "progrok");
  await writeFile(
    fakeProgrok,
    "#!/bin/sh\nprintf 'Not logged in. Run `progrok login` first.\\n' >&2\nexit 1\n",
  );
  await chmod(fakeProgrok, 0o755);

  let exitCount = 0;
  const handle = await startGrokProxy({
    port: 0,
    progrokBinPath: fakeProgrok,
    restartDelayMs: 20,
    onExit: () => {
      exitCount += 1;
    },
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(exitCount, 1);
    assert.equal(handle.child, null);
  } finally {
    handle.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});
