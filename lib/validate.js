// Shared input validation for /api/generate, /api/edit, /api/node/generate.
// All functions return either { ok: true, value } or { ok: false, code, message }.

const QUALITY = new Set(["low", "medium", "high", "auto"]);
const FORMAT = new Set(["png", "jpeg", "webp"]);
const MODERATION = new Set(["auto", "low"]);

export const PROMPT_MAX = 4000;
export const MIN_SIDE = 1024;
export const MAX_SIDE = 3824;
export const MIN_PIXELS = 655_360;
export const MAX_PIXELS = 8_294_400;
export const MAX_RATIO = 3;

function fail(code, message) {
  return { ok: false, code, message };
}

export function validatePrompt(v) {
  if (typeof v !== "string") return fail("INVALID_PROMPT", "Prompt is required");
  const t = v.trim();
  if (!t) return fail("INVALID_PROMPT", "Prompt must not be empty");
  if (t.length > PROMPT_MAX)
    return fail(
      "PROMPT_TOO_LONG",
      `Prompt must be ≤ ${PROMPT_MAX} characters (got ${t.length})`,
    );
  return { ok: true, value: t };
}

export function validateQuality(v) {
  if (!QUALITY.has(v))
    return fail(
      "INVALID_QUALITY",
      `quality must be one of ${Array.from(QUALITY).join(", ")}`,
    );
  return { ok: true, value: v };
}

export function validateFormat(v) {
  if (!FORMAT.has(v))
    return fail(
      "INVALID_FORMAT",
      `format must be one of ${Array.from(FORMAT).join(", ")}`,
    );
  return { ok: true, value: v };
}

export function validateModeration(v) {
  if (!MODERATION.has(v))
    return fail(
      "INVALID_MODERATION",
      `moderation must be one of ${Array.from(MODERATION).join(", ")}`,
    );
  return { ok: true, value: v };
}

export function validateCount(v, { max = 8 } = {}) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1 || n > max)
    return fail("INVALID_COUNT", `n must be an integer in [1, ${max}]`);
  return { ok: true, value: n };
}

export function validateSize(v) {
  if (v === "auto") return { ok: true, value: "auto" };
  if (typeof v !== "string") return fail("INVALID_SIZE", "size must be a string");
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (!m) return fail("INVALID_SIZE", 'size must be "WxH" or "auto"');
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w % 16 !== 0 || h % 16 !== 0)
    return fail("INVALID_SIZE", "size: both sides must be multiples of 16");
  const maxSide = Math.max(w, h);
  const minSide = Math.min(w, h);
  if (maxSide > MAX_SIDE)
    return fail(
      "INVALID_SIZE",
      `size: longest side must be ≤ ${MAX_SIDE} (got ${maxSide})`,
    );
  if (minSide < MIN_SIDE)
    return fail(
      "INVALID_SIZE",
      `size: shortest side must be ≥ ${MIN_SIDE} (got ${minSide})`,
    );
  const ratio = maxSide / minSide;
  if (ratio > MAX_RATIO)
    return fail(
      "INVALID_SIZE",
      `size: aspect ratio must be ≤ ${MAX_RATIO}:1 (got ${ratio.toFixed(2)})`,
    );
  const pixels = w * h;
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS)
    return fail(
      "INVALID_SIZE",
      `size: total pixels ${pixels} ∉ [${MIN_PIXELS}, ${MAX_PIXELS}]`,
    );
  return { ok: true, value: `${w}x${h}` };
}
