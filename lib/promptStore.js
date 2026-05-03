// Prompt library CRUD + search (Phase 6.3, 참조: upstream 0bb06fc — 우리 식
// 단순 단일 테이블 + LIKE 검색). better-sqlite3 동기 호출이라 Promise 없음.

import { randomBytes } from "crypto";
import { getDb } from "./db.js";

const MAX_BODY = 5000;
const MAX_TITLE = 100;
const MAX_QUERY = 100;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const PROMPT_ERRORS = Object.freeze({
  BODY_REQUIRED: "PROMPT_BODY_REQUIRED",
  BODY_TOO_LONG: "PROMPT_BODY_TOO_LONG",
  TITLE_TOO_LONG: "PROMPT_TITLE_TOO_LONG",
  NOT_FOUND: "PROMPT_NOT_FOUND",
  FORBIDDEN: "PROMPT_FORBIDDEN",
});

function newId() {
  return "p_" + randomBytes(5).toString("hex");
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || "",
    body: row.body,
    pinned: row.pinned === 1,
    useCount: row.use_count || 0,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    owner: row.owner || null,
  };
}

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => "\\" + c);
}

// list({ owner, q, limit, offset }) — pinned 우선, lastUsedAt DESC, createdAt DESC.
export function listPrompts({ owner = null, q = "", limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  const cappedLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const cappedOffset = Math.max(0, Number(offset) || 0);
  const trimmed = String(q || "").trim().slice(0, MAX_QUERY);
  const db = getDb();

  const params = {};
  let where = "1=1";
  if (owner) {
    where += " AND owner = @owner";
    params.owner = owner;
  }
  if (trimmed) {
    where += " AND (LOWER(title) LIKE @pattern ESCAPE '\\' OR LOWER(body) LIKE @pattern ESCAPE '\\')";
    params.pattern = "%" + escapeLike(trimmed.toLowerCase()) + "%";
  }
  const sql = `
    SELECT id, title, body, pinned, use_count, last_used_at, created_at, updated_at, owner
    FROM prompts
    WHERE ${where}
    ORDER BY pinned DESC, COALESCE(last_used_at, 0) DESC, created_at DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = cappedLimit;
  params.offset = cappedOffset;
  return db.prepare(sql).all(params).map(rowToItem);
}

export function getPrompt(id, { owner = null } = {}) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM prompts WHERE id = ?").get(id);
  if (!row) return { error: PROMPT_ERRORS.NOT_FOUND };
  if (owner && row.owner && row.owner !== owner) return { error: PROMPT_ERRORS.FORBIDDEN };
  return { item: rowToItem(row) };
}

export function createPrompt({ title = "", body, owner = null }) {
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (!trimmedBody) return { error: PROMPT_ERRORS.BODY_REQUIRED };
  if (trimmedBody.length > MAX_BODY) return { error: PROMPT_ERRORS.BODY_TOO_LONG };
  const trimmedTitle = String(title || "").trim();
  if (trimmedTitle.length > MAX_TITLE) return { error: PROMPT_ERRORS.TITLE_TOO_LONG };

  const id = newId();
  const now = Date.now();
  const db = getDb();
  db.prepare(`
    INSERT INTO prompts (id, title, body, pinned, use_count, last_used_at, created_at, updated_at, owner)
    VALUES (@id, @title, @body, 0, 0, NULL, @now, @now, @owner)
  `).run({ id, title: trimmedTitle, body: trimmedBody, now, owner });
  return { item: rowToItem(db.prepare("SELECT * FROM prompts WHERE id = ?").get(id)) };
}

export function updatePrompt(id, patch = {}, { owner = null } = {}) {
  const existing = getPrompt(id, { owner });
  if (existing.error) return existing;

  const fields = [];
  const params = { id, now: Date.now() };
  if (typeof patch.title === "string") {
    if (patch.title.length > MAX_TITLE) return { error: PROMPT_ERRORS.TITLE_TOO_LONG };
    fields.push("title = @title");
    params.title = patch.title.trim();
  }
  if (typeof patch.body === "string") {
    const trimmed = patch.body.trim();
    if (!trimmed) return { error: PROMPT_ERRORS.BODY_REQUIRED };
    if (trimmed.length > MAX_BODY) return { error: PROMPT_ERRORS.BODY_TOO_LONG };
    fields.push("body = @body");
    params.body = trimmed;
  }
  if (typeof patch.pinned === "boolean") {
    fields.push("pinned = @pinned");
    params.pinned = patch.pinned ? 1 : 0;
  }
  if (fields.length === 0) {
    return { item: existing.item };
  }
  fields.push("updated_at = @now");
  const db = getDb();
  db.prepare(`UPDATE prompts SET ${fields.join(", ")} WHERE id = @id`).run(params);
  return { item: rowToItem(db.prepare("SELECT * FROM prompts WHERE id = ?").get(id)) };
}

export function deletePrompt(id, { owner = null } = {}) {
  const existing = getPrompt(id, { owner });
  if (existing.error) return existing;
  getDb().prepare("DELETE FROM prompts WHERE id = ?").run(id);
  return { ok: true };
}

// Bump useCount + lastUsedAt. Called when the user clicks a card to apply.
export function bumpPromptUse(id, { owner = null } = {}) {
  const existing = getPrompt(id, { owner });
  if (existing.error) return existing;
  const now = Date.now();
  getDb().prepare(`
    UPDATE prompts SET use_count = use_count + 1, last_used_at = @now, updated_at = @now WHERE id = @id
  `).run({ id, now });
  return {
    useCount: existing.item.useCount + 1,
    lastUsedAt: now,
  };
}

// Test helper — drops all rows. Production code should never call this.
export function _resetPromptsForTest() {
  getDb().exec("DELETE FROM prompts");
}

export const PROMPT_LIMITS = Object.freeze({
  MAX_BODY,
  MAX_TITLE,
  MAX_QUERY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
});
