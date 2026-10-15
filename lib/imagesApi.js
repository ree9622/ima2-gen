// Images API client for the openai-oauth proxy (/v1/images/generations and
// /v1/images/edits). Default image route since 2026-10-15 — see lib/models.js
// for why the Responses + image_generation tool route stopped working.
//
// Proxy contract (openai-oauth 2.0.0, @openai-oauth/core/dist/images.js):
//   generations: JSON, forwards only model/prompt/background/n/quality/size
//   edits:       multipart/form-data, 1-5 `image` / `image[]` files, ≤50 MB each
//   rejected (400): moderation, output_format, output_compression,
//                   partial_images, input_fidelity, stream, mask
//   response:    { data:[{ b64_json, generation_id }], size, quality,
//                  background, output_format:"png", usage }
// The backend always returns PNG, so jpeg/webp requests are transcoded here
// to keep the "file extension == bytes" contract callers rely on.

import sharp from "sharp";
import { acquireOauthSlot, normalizeAbortReason } from "./oauthStream.js";
import { detectImageMimeFromB64 } from "./refs.js";

export const IMAGES_API_MAX_REFS = 5;
const HARD_TIMEOUT_MS = 10 * 60 * 1000;
// gpt-image-2 prompt limit is 32k chars; keep headroom.
const PROMPT_MAX_CHARS = 30000;

const QUALITY_VALUES = new Set(["low", "medium", "high", "auto"]);
const BACKGROUND_VALUES = new Set(["transparent", "opaque", "auto"]);
const SIZE_RE = /^(\d{2,5})x(\d{2,5})$/i;

// Lines that only make sense for a chat model driving a tool (output-channel
// contract, "the tool sees only…", web search) are noise — or worse, literal
// text — for an image model reading the prompt directly.
const TOOL_ONLY_LINE_RE = /image_generation|\bthe tool\b|\bweb search\b|prose reply|output contract|Never answer with an explanation|Describing a version you would be willing to draw/i;

export function stripToolOnlyGuidance(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  return text
    .split("\n")
    .filter((line) => !TOOL_ONLY_LINE_RE.test(line))
    .join("\n")
    .trim();
}

/**
 * Compose the single prompt string the Images API sees. The user's text (with
 * orientation directive / ref boost already applied by the caller) goes first
 * and is never truncated; the always-on wrapper and the toggleable system
 * prompt follow as guidance with tool-specific lines removed.
 */
export function composeImagesPrompt({ userPrompt, wrapper = "", systemPrompt = "" }) {
  const guidance = [stripToolOnlyGuidance(systemPrompt), stripToolOnlyGuidance(wrapper)]
    .filter(Boolean)
    .join("\n");
  const base = String(userPrompt || "");
  if (!guidance) return base.slice(0, PROMPT_MAX_CHARS);
  const header = "\n\nRendering guidance (follow it; never draw this guidance as visible text):\n";
  const room = PROMPT_MAX_CHARS - base.length - header.length;
  if (room <= 200) return base.slice(0, PROMPT_MAX_CHARS);
  return `${base}${header}${guidance.slice(0, room)}`;
}

export function normalizeImagesParams({ quality, size, background }) {
  const q = typeof quality === "string" ? quality.trim().toLowerCase() : "";
  const b = typeof background === "string" ? background.trim().toLowerCase() : "";
  const s = typeof size === "string" ? size.trim().toLowerCase() : "";
  return {
    quality: QUALITY_VALUES.has(q) ? q : undefined,
    background: BACKGROUND_VALUES.has(b) ? b : undefined,
    // The backend ignores size (the prompt's orientation sentence decides the
    // canvas) but accepts WxH / auto. Anything else is dropped rather than
    // risking a 400.
    size: s === "auto" || SIZE_RE.test(s) ? s : undefined,
  };
}

function extForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

async function transcode(b64, outputFormat, compression) {
  if (outputFormat !== "jpeg" && outputFormat !== "webp") return b64;
  const quality = Math.max(1, Math.min(100, Number(compression) || 100));
  const pipeline = sharp(Buffer.from(b64, "base64"), { failOn: "none" });
  const out = outputFormat === "jpeg"
    ? await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer()
    : await pipeline.webp({ quality }).toBuffer();
  return out.toString("base64");
}

/**
 * Call the proxy's Images API once. Generation when `references` is empty,
 * edit (references as input images) otherwise.
 *
 * Resolves { b64, usage, codexAccount, generationId, effectiveImage, endpoint }.
 * b64 is null when the upstream answered 200 without image data (the caller
 * turns that into UPSTREAM_EMPTY like the Responses route did). Non-2xx
 * responses throw an Error carrying .status (and .usage when present) — the
 * same shape runResponses throws, so runPromptAttempts' classification
 * (usage limit / rate limit / safety_violations / auth / network) is unchanged.
 */
export async function runImagesApi({
  url,
  model,
  prompt,
  quality,
  size,
  background,
  references = [],
  outputFormat = "png",
  compression = 100,
  signal,
  onPhase,
  fetchImpl = fetch,
}) {
  if (!Array.isArray(references)) references = [];
  if (references.length > IMAGES_API_MAX_REFS) {
    const e = new Error(`references may not exceed ${IMAGES_API_MAX_REFS} items`);
    e.code = "REF_TOO_MANY";
    e.status = 400;
    throw e;
  }
  const params = normalizeImagesParams({ quality, size, background });
  await acquireOauthSlot(signal);

  const ac = new AbortController();
  let externalAbort = null;
  if (signal) {
    externalAbort = () => ac.abort(normalizeAbortReason(signal));
    if (signal.aborted) externalAbort();
    else signal.addEventListener("abort", externalAbort, { once: true });
  }
  const hardTimer = setTimeout(() => {
    ac.abort(new Error(`images API hard timeout after ${HARD_TIMEOUT_MS}ms`));
  }, HARD_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(hardTimer);
    if (signal && externalAbort) signal.removeEventListener("abort", externalAbort);
  };

  const isEdit = references.length > 0;
  const endpoint = isEdit ? "/v1/images/edits" : "/v1/images/generations";
  let init;
  if (isEdit) {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", prompt);
    fd.append("n", "1");
    if (params.quality) fd.append("quality", params.quality);
    if (params.size) fd.append("size", params.size);
    if (params.background) fd.append("background", params.background);
    references.forEach((b64, i) => {
      const mime = detectImageMimeFromB64(b64) || "image/png";
      fd.append(
        "image[]",
        new Blob([Buffer.from(b64, "base64")], { type: mime }),
        `reference-${i + 1}.${extForMime(mime)}`,
      );
    });
    init = { method: "POST", body: fd };
  } else {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model, prompt, n: 1, ...params }),
    };
  }

  let res;
  let text;
  try {
    onPhase?.("streaming");
    res = await fetchImpl(`${url}${endpoint}`, { ...init, signal: ac.signal });
    text = await res.text();
  } catch (err) {
    cleanup();
    if (ac.signal.aborted && ac.signal.reason instanceof Error) throw ac.signal.reason;
    throw err;
  }
  cleanup();

  let json = null;
  try { json = JSON.parse(text); } catch {}
  const codexAccount = res.headers?.get?.("x-codex-account") || null;
  if (!res.ok) {
    const msg = json?.error?.message;
    const err = new Error(msg || `OAuth proxy returned ${res.status}: ${String(text).slice(0, 200)}`);
    err.status = res.status;
    if (json?.error?.code) err.upstreamCode = json.error.code;
    if (json?.usage) err.usage = json.usage;
    throw err;
  }
  if (!json || typeof json !== "object") {
    const err = new Error(`Images API returned non-JSON body: ${String(text).slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  onPhase?.("decoding");
  const item = Array.isArray(json.data) ? json.data[0] : null;
  const rawB64 = typeof item?.b64_json === "string" && item.b64_json.length > 0 ? item.b64_json : null;
  const b64 = rawB64 ? await transcode(rawB64, outputFormat, compression) : null;
  return {
    b64,
    usage: json.usage || null,
    codexAccount,
    generationId: item?.generation_id || null,
    revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
    endpoint,
    effectiveImage: {
      model,
      quality: json.quality ?? null,
      size: json.size ?? null,
      background: json.background ?? null,
      outputFormat: rawB64 && (outputFormat === "jpeg" || outputFormat === "webp")
        ? outputFormat
        : (json.output_format ?? null),
      ...(rawB64 && (outputFormat === "jpeg" || outputFormat === "webp")
        ? { upstreamFormat: json.output_format ?? "png", transcoded: true }
        : {}),
    },
  };
}
