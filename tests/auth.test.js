// Auth tests run against a single temp SQLite file; each `it` cleans the
// users table first so they don't leak state. We set IMA2_DB_PATH BEFORE
// importing the modules so getDb() resolves to our test DB.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.IMA2_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ima2-auth-")),
  "sessions.db",
);

const { getDb, closeDb } = await import("../lib/db.js");
const userAuth = await import("../lib/userAuth.js");
const {
  hashPassword,
  verifyPassword,
  createUser,
  listUsers,
  deleteUser,
  setUserPassword,
  login,
  resolveSession,
  logout,
  purgeExpiredSessions,
} = userAuth;

beforeEach(() => {
  // Wipe both tables — sessions has FK onto users with ON DELETE CASCADE
  // so deleting users would clear sessions too, but explicit is clearer.
  const db = getDb();
  db.exec("DELETE FROM user_sessions");
  db.exec("DELETE FROM users");
});

describe("hashPassword / verifyPassword", () => {
  it("rejects passwords below the minimum length", () => {
    assert.throws(
      () => hashPassword("short"),
      (e) => e.code === "PASSWORD_TOO_SHORT",
    );
  });

  it("round-trips a valid password", () => {
    const stored = hashPassword("correct horse");
    assert.equal(verifyPassword("correct horse", stored), true);
    assert.equal(verifyPassword("CORRECT HORSE", stored), false);
    assert.equal(verifyPassword("", stored), false);
  });

  it("produces a different hash each time (salted)", () => {
    const a = hashPassword("same password");
    const b = hashPassword("same password");
    assert.notEqual(a, b);
    assert.equal(verifyPassword("same password", a), true);
    assert.equal(verifyPassword("same password", b), true);
  });

  it("returns false for malformed stored hashes", () => {
    assert.equal(verifyPassword("any", ""), false);
    assert.equal(verifyPassword("any", "not-a-hash"), false);
    assert.equal(verifyPassword("any", "scrypt$bad$format"), false);
    assert.equal(verifyPassword("any", "scrypt$1$1$1$00$00"), false);
  });
});

describe("user CRUD", () => {
  it("creates and lists users", () => {
    createUser("alice", "longpassword");
    createUser("bob", "anotherpassword");
    const all = listUsers();
    assert.deepEqual(
      all.map((u) => u.username),
      ["alice", "bob"],
    );
  });

  it("rejects invalid usernames", () => {
    assert.throws(
      () => createUser("a", "longpassword"),
      (e) => e.code === "USERNAME_INVALID",
    );
    assert.throws(
      () => createUser("has space", "longpassword"),
      (e) => e.code === "USERNAME_INVALID",
    );
    assert.throws(
      () => createUser("한글이름", "longpassword"),
      (e) => e.code === "USERNAME_INVALID",
    );
  });

  it("rejects duplicate usernames (case-sensitive)", () => {
    createUser("alice", "longpassword");
    assert.throws(
      () => createUser("alice", "longpassword"),
      (e) => e.code === "USERNAME_EXISTS",
    );
  });

  it("removes a user", () => {
    createUser("alice", "longpassword");
    assert.equal(deleteUser("alice"), true);
    assert.equal(deleteUser("alice"), false);
    assert.deepEqual(listUsers(), []);
  });

  it("changes a password without invalidating other devices", () => {
    createUser("alice", "longpassword");
    const ses1 = login("alice", "longpassword");
    setUserPassword("alice", "newlongpassword");
    assert.throws(
      () => login("alice", "longpassword"),
      (e) => e.code === "INVALID_CREDENTIALS",
    );
    const ses2 = login("alice", "newlongpassword");
    assert.ok(ses2.sessionId);
    const resolved = resolveSession(ses1.sessionId);
    assert.ok(resolved);
    assert.equal(resolved.user.username, "alice");
  });
});

describe("login / resolveSession / logout", () => {
  beforeEach(() => {
    createUser("alice", "longpassword");
  });

  it("logs in with valid credentials and issues a session", () => {
    const r = login("alice", "longpassword");
    assert.ok(r.sessionId);
    assert.equal(r.user.username, "alice");
    assert.ok(r.expiresAt > Date.now());
  });

  it("rejects wrong password", () => {
    assert.throws(
      () => login("alice", "wrong"),
      (e) => e.code === "INVALID_CREDENTIALS" && e.status === 401,
    );
  });

  it("rejects unknown user with same INVALID_CREDENTIALS code (no enumeration)", () => {
    assert.throws(
      () => login("ghost", "longpassword"),
      (e) => e.code === "INVALID_CREDENTIALS" && e.status === 401,
    );
  });

  it("resolves a valid session", () => {
    const r = login("alice", "longpassword");
    const s = resolveSession(r.sessionId);
    assert.ok(s);
    assert.equal(s.user.username, "alice");
  });

  it("returns null for invalid / unknown session ids", () => {
    assert.equal(resolveSession(""), null);
    assert.equal(resolveSession(null), null);
    assert.equal(resolveSession("0".repeat(64)), null);
  });

  it("logout removes the session row", () => {
    const r = login("alice", "longpassword");
    assert.equal(logout(r.sessionId), true);
    assert.equal(resolveSession(r.sessionId), null);
    assert.equal(logout(r.sessionId), false);
  });

  it("purgeExpiredSessions drops only expired rows", () => {
    const r = login("alice", "longpassword");
    getDb()
      .prepare("UPDATE user_sessions SET expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, r.sessionId);
    const dropped = purgeExpiredSessions();
    assert.equal(dropped, 1);
    assert.equal(resolveSession(r.sessionId), null);
  });
});

// Best-effort cleanup of the SQLite handle so node:test exits cleanly.
process.on("exit", () => {
  try { closeDb(); } catch {}
});
