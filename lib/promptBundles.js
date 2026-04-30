// Saved prompt bundles — text-only counterpart to lib/refBundles (which lives
// inline in server.js). The data is small (text + tags), so we store the
// entire collection as one JSON file under IMA2_CONFIG_DIR. RefBundles uses
// the same directory; co-locating keeps user-data discoverability simple.
//
// File shape: { bundles: [{ id, name, prompt, tags, owner, createdAt, updatedAt }] }
// Atomic write via tmp + rename to survive a crash mid-save.

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const DEFAULT_DIR = process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");
const FILE_NAME = "promptBundles.json";
const LEGACY_OWNER = "_legacy";

// Limits chosen to keep the JSON file small and the UI predictable. The
// classifier-side prompt limits are far higher; these are UX-side guards.
export const NAME_MAX = 60;
export const PROMPT_MAX = 8000;
export const TAG_MAX_LEN = 20;
export const TAG_MAX_COUNT = 5;

function bundlesPath(dir = DEFAULT_DIR) {
  return join(dir, FILE_NAME);
}

export async function loadBundles({ dir = DEFAULT_DIR } = {}) {
  try {
    const raw = await readFile(bundlesPath(dir), "utf-8");
    const j = JSON.parse(raw);
    return Array.isArray(j?.bundles) ? j.bundles : [];
  } catch {
    return [];
  }
}

export async function saveBundles(bundles, { dir = DEFAULT_DIR } = {}) {
  await mkdir(dir, { recursive: true });
  const tmp = bundlesPath(dir) + ".tmp";
  await writeFile(tmp, JSON.stringify({ bundles }, null, 2));
  await rename(tmp, bundlesPath(dir));
}

export function bundleVisibleTo(bundle, authUser) {
  if (!authUser) return true;
  return (bundle.owner || LEGACY_OWNER) === authUser;
}

// Sanitize a tags input. Returns a clean array (possibly empty). Drops empty
// entries, trims whitespace, dedupes (case-insensitive), and clamps length.
export function normalizeTags(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().slice(0, TAG_MAX_LEN);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= TAG_MAX_COUNT) break;
  }
  return out;
}

// Build a new bundle record from a payload. Throws ValidationError-shaped
// errors with a `code` so the route handler can map them to HTTP statuses.
class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function makeBundle({ name, prompt, tags, owner }) {
  const trimmedName = String(name || "").trim().slice(0, NAME_MAX);
  if (!trimmedName) {
    throw new ValidationError("BUNDLE_NAME_REQUIRED", "이름을 입력해 주세요.");
  }
  const trimmedPrompt = String(prompt || "").slice(0, PROMPT_MAX);
  if (!trimmedPrompt.trim()) {
    throw new ValidationError("BUNDLE_PROMPT_REQUIRED", "프롬프트가 비어 있습니다.");
  }
  return {
    id: `p_${Date.now()}_${randomBytes(4).toString("hex")}`,
    name: trimmedName,
    prompt: trimmedPrompt,
    tags: normalizeTags(tags),
    owner: owner || LEGACY_OWNER,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Apply a partial update onto an existing bundle in-place. Only known keys
// are honored. Returns the (mutated) target.
export function applyPatch(target, patch) {
  if (!target || !patch || typeof patch !== "object") return target;
  if (patch.name !== undefined) {
    const name = String(patch.name || "").trim().slice(0, NAME_MAX);
    if (!name) {
      throw new ValidationError("BUNDLE_NAME_REQUIRED", "이름을 입력해 주세요.");
    }
    target.name = name;
  }
  if (patch.prompt !== undefined) {
    const prompt = String(patch.prompt || "").slice(0, PROMPT_MAX);
    if (!prompt.trim()) {
      throw new ValidationError("BUNDLE_PROMPT_REQUIRED", "프롬프트가 비어 있습니다.");
    }
    target.prompt = prompt;
  }
  if (patch.tags !== undefined) {
    target.tags = normalizeTags(patch.tags);
  }
  target.updatedAt = Date.now();
  return target;
}

export { ValidationError, LEGACY_OWNER };
