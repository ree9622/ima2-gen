import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGrokLoginArgs } from "../bin/commands/grok.ts";

test("ima2 grok login defaults to manual-paste", () => {
  assert.deepEqual(normalizeGrokLoginArgs(["login"]), ["login", "--manual-paste"]);
});

test("ima2 grok login keeps manual-paste explicit and does not duplicate it", () => {
  assert.deepEqual(
    normalizeGrokLoginArgs(["login", "--manual-paste"]),
    ["login", "--manual-paste"],
  );
});

test("ima2 grok login normalizes alternate login flows back to manual-paste", () => {
  assert.deepEqual(
    normalizeGrokLoginArgs(["login", "--device-code"]),
    ["login", "--manual-paste"],
  );
  assert.deepEqual(
    normalizeGrokLoginArgs(["login", "--browser"]),
    ["login", "--manual-paste"],
  );
});

test("ima2 grok non-login commands are not rewritten", () => {
  assert.deepEqual(normalizeGrokLoginArgs(["status"]), ["status"]);
  assert.deepEqual(normalizeGrokLoginArgs(["proxy", "--port", "18645"]), ["proxy", "--port", "18645"]);
});
