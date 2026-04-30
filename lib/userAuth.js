// Local user authentication — replaces nginx basic auth with an app-level
// login. Storage: SQLite (lib/db.js, tables `users` + `user_sessions`).
//
// Password hashing: scrypt (Node built-in, no native bcrypt dependency).
// Session token: 32-byte random hex; the cookie carries only this id and
// the server looks up the row in `user_sessions`.
// TTL: 30 days, rolling — every authenticated request bumps `last_seen_at`,
// and if more than half the TTL has passed we extend `expires_at` so an
// active user stays logged in indefinitely.
//
// We deliberately do NOT issue JWTs here. Server-side sessions can be
// revoked instantly (delete the row) and don't require sharing a signing
// secret across processes.

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.js";

// scrypt parameters — N=16384 is the OWASP-recommended minimum for
// password storage on a modern server. Tuning higher (32768/65536) is fine
// but each login costs roughly 2× CPU; 16384 lands at ~50ms which is the
// sweet spot for a self-hosted single-tenant tool.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

const SESSION_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

// Username/password validation. Tight enough to keep CLI shell-quoting sane
// and to push back on weak passwords; loose enough not to be annoying.
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;
export const PASSWORD_MIN_LEN = 8;

export class AuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ── Password hashing ────────────────────────────────────────────────────

export function hashPassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LEN) {
    throw new AuthError(
      "PASSWORD_TOO_SHORT",
      `비밀번호는 최소 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.`,
    );
  }
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  // Format: scrypt$N$r$p$saltHex$keyHex — self-describing so we can change
  // params later and tell old hashes apart.
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (salt.length === 0 || expected.length !== SCRYPT_KEYLEN) return false;
  let got;
  try {
    got = scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return timingSafeEqual(expected, got);
}

// ── User CRUD ───────────────────────────────────────────────────────────

export function createUser(username, password) {
  if (!USERNAME_RE.test(username)) {
    throw new AuthError(
      "USERNAME_INVALID",
      "사용자명은 영문/숫자/._- 조합 2~32자만 허용됩니다.",
    );
  }
  const db = getDb();
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) {
    throw new AuthError("USERNAME_EXISTS", `사용자 "${username}" 이 이미 존재합니다.`, 409);
  }
  const hash = hashPassword(password);
  const now = Date.now();
  const r = db
    .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, hash, now);
  return { id: r.lastInsertRowid, username, createdAt: now };
}

export function listUsers() {
  return getDb()
    .prepare("SELECT id, username, created_at, last_login_at FROM users ORDER BY username")
    .all()
    .map((u) => ({
      id: u.id,
      username: u.username,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
    }));
}

export function findUserByUsername(username) {
  const row = getDb().prepare("SELECT * FROM users WHERE username = ?").get(username);
  return row || null;
}

export function deleteUser(username) {
  const r = getDb().prepare("DELETE FROM users WHERE username = ?").run(username);
  return r.changes > 0;
}

export function setUserPassword(username, newPassword) {
  const u = findUserByUsername(username);
  if (!u) throw new AuthError("USER_NOT_FOUND", `사용자 "${username}" 없음`, 404);
  const hash = hashPassword(newPassword);
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, u.id);
  // Existing sessions stay valid by design — change-password does NOT log
  // the user out of other devices. If we ever want that, delete from
  // user_sessions WHERE user_id = ?.
}

// ── Sessions ────────────────────────────────────────────────────────────

function newSessionId() {
  return randomBytes(SESSION_BYTES).toString("hex");
}

export function login(username, password) {
  const u = findUserByUsername(username);
  // Always run scrypt even on user-not-found to keep timing roughly equal.
  // The dummy hash uses the same parameters but a fixed salt so it always
  // returns the same cost; the actual return value is discarded.
  if (!u) {
    verifyPassword(password, "scrypt$16384$8$1$00$00");
    throw new AuthError("INVALID_CREDENTIALS", "사용자명 또는 비밀번호가 올바르지 않습니다.", 401);
  }
  if (!verifyPassword(password, u.password_hash)) {
    throw new AuthError("INVALID_CREDENTIALS", "사용자명 또는 비밀번호가 올바르지 않습니다.", 401);
  }
  const now = Date.now();
  const id = newSessionId();
  const expiresAt = now + SESSION_TTL_MS;
  getDb()
    .prepare(
      "INSERT INTO user_sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, u.id, now, expiresAt, now);
  getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, u.id);
  return {
    sessionId: id,
    expiresAt,
    user: { id: u.id, username: u.username },
  };
}

// Look up a session id and return { user, sessionId, expiresAt } if valid.
// Side effect: bumps last_seen_at on every hit, and rolls expires_at
// forward if more than half the TTL has elapsed (rolling 30-day session).
export function resolveSession(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.user_id, s.expires_at, s.created_at,
              u.username
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) {
    // Expired — drop it so the table doesn't accumulate dead rows.
    db.prepare("DELETE FROM user_sessions WHERE id = ?").run(sessionId);
    return null;
  }
  let expiresAt = row.expires_at;
  if (now - (row.expires_at - SESSION_TTL_MS) > SESSION_REFRESH_THRESHOLD_MS) {
    expiresAt = now + SESSION_TTL_MS;
    db.prepare("UPDATE user_sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?")
      .run(expiresAt, now, sessionId);
  } else {
    db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?").run(now, sessionId);
  }
  return {
    sessionId,
    expiresAt,
    user: { id: row.user_id, username: row.username },
  };
}

export function logout(sessionId) {
  if (!sessionId) return false;
  const r = getDb().prepare("DELETE FROM user_sessions WHERE id = ?").run(sessionId);
  return r.changes > 0;
}

export function purgeExpiredSessions(now = Date.now()) {
  const r = getDb().prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(now);
  return r.changes;
}

export const SESSION_COOKIE_NAME = "ima2_session";
export { SESSION_TTL_MS };
