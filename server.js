import "./lib/timestampConsole.js";
import "dotenv/config";
import express from "express";
import { writeFile, mkdir, readFile, readdir, stat, rename } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { spawnBin, onShutdown } from "./bin/lib/platform.js";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync as fsReadFileSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { newNodeId, saveNode, loadNodeB64, loadNodeMeta, loadAssetB64, loadAssetSidecar, importExistingFile, writeNodeResult, readNodeResult, pruneNodeResults } from "./lib/nodeStore.js";
import { derivePreviews, variantUrls } from "./lib/imageVariants.js";
import { startJob, finishJob, listJobs, listJobsRaw, setJobPhase, setJobAttempt, getJob, purgeStaleJobs } from "./lib/inflight.js";
import {
  createSession,
  listSessions,
  getSession,
  renameSession,
  deleteSession,
  saveGraph,
  ensureDefaultSession,
} from "./lib/sessionStore.js";
import { trashAsset, restoreAsset, markNodesAssetMissing } from "./lib/assetLifecycle.js";
import { reconcileSessionFromDisk } from "./lib/reconcile.js";
import {
  listPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  bumpPromptUse,
  PROMPT_ERRORS,
} from "./lib/promptStore.js";
import { importFromGitHubUrl, PromptImportError } from "./lib/promptImport.js";
import { setFavoriteFlag } from "./lib/favorite.js";
import { runResponses } from "./lib/oauthStream.js";
import {
  isValidBatchId,
  ensureBatchMeta,
  appendBatchEntry,
  readBatch,
  listBatches,
  summarizeBatch,
  closeBatch,
} from "./lib/batchLog.js";
import { buildEnhancePayload, extractEnhancedText, sanitizeEnhancedText } from "./lib/enhance.js";
import {
  buildAttemptSequence,
  hasCompliantRetry,
  parseSafetyViolation,
} from "./lib/safetyRetry.js";
import { rewritePromptForSafety } from "./lib/llmRewrite.js";
import {
  loadBundles as loadPromptBundles,
  saveBundles as savePromptBundles,
  bundleVisibleTo as promptBundleVisibleTo,
  makeBundle as makePromptBundle,
  applyPatch as applyPromptBundlePatch,
  ValidationError as PromptBundleValidationError,
} from "./lib/promptBundles.js";
import {
  login as authLogin,
  logout as authLogout,
  AuthError,
  purgeExpiredSessions,
} from "./lib/userAuth.js";
import {
  cookieParserMiddleware,
  authMiddleware,
  buildSessionCookie,
  buildClearSessionCookie,
  isAuthEnabled,
} from "./lib/authMiddleware.js";
import {
  OUTFIT_PRESETS,
  OUTFIT_CATEGORIES,
  sampleOutfitPrompts,
  weightsFromStats,
} from "./lib/outfitPresets.js";
import { boostRefPrompt } from "./lib/refPrompt.js";
import { resolveRefLineage } from "./lib/refLineage.js";
import { getStorageStats, pruneStorage } from "./lib/prune.js";
import { withDefaultPrompt } from "./lib/defaultPrompt.js";
import {
  validatePrompt,
  validateQuality,
  validateFormat,
  validateModeration,
  validateCount,
  validateSize,
} from "./lib/validate.js";
import { createRequestLogger } from "./lib/requestLogger.js";
import { detectImageMimeFromB64, validateAndNormalizeRefs } from "./lib/refs.js";
import { writeTextChunks, IMA2_METADATA_VERSION } from "./lib/imageMetadata.js";
import { logEvent, logError } from "./lib/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Load API key from env or ${IMA2_CONFIG_DIR || ~/.ima2}/config.json
// (with legacy fallback to <packageRoot>/.ima2/config.json for existing installs)
let apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  const configDir = process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");
  const candidates = [
    join(configDir, "config.json"),
    join(__dirname, ".ima2", "config.json"),
  ];
  for (const cfgPath of candidates) {
    if (!existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf-8"));
      if (cfg.apiKey) { apiKey = cfg.apiKey; break; }
    } catch {}
  }
}

// OAuth proxy binding. Mutated at runtime if the child proxy falls back to a
// different port (e.g. 10531 busy → 10539). All callsites read the live values
// — do NOT destructure these into locals.
let OAUTH_PORT = parseInt(process.env.OAUTH_PORT || "10531");
const OAUTH_PORT_REQUESTED = OAUTH_PORT;
let OAUTH_URL = `http://127.0.0.1:${OAUTH_PORT}`;
let OAUTH_READY = false;
let OAUTH_LAST_ERROR = null;
const HAS_API_KEY = !!apiKey;

let openai = null;
if (HAS_API_KEY) {
  const OpenAI = (await import("openai")).default;
  openai = new OpenAI({ apiKey });
}

app.use(express.json({ limit: "50mb" }));

// Per-account ACL. Two layers:
//   1) Legacy: nginx Basic Auth forwards username via X-Auth-User. Used
//      while we still run nginx auth in front (npm package single-user
//      mode / pre-self-login deploys).
//   2) Self-hosted login (IMA2_AUTH=enabled): cookieParserMiddleware +
//      authMiddleware below override req.authUser with the session user
//      and gate every protected /api/* path with 401.
// The self-hosted layer wins when both are present (session beats
// X-Auth-User), so the migration is a no-op for already-authenticated
// requests and only adds a 401 for unauthenticated ones once enabled.
const LEGACY_OWNER = process.env.IMA2_LEGACY_OWNER || "ree9622";
app.use((req, _res, next) => {
  const raw = req.get("X-Auth-User") || "";
  req.authUser = raw.trim() || null;
  next();
});
app.use(cookieParserMiddleware);
app.use(authMiddleware);

// Stamp ima2:* tEXt metadata into a generated PNG so the file itself is enough
// to reconstruct prompt/size/quality on re-upload (Phase 6.2). Sidecar JSON
// remains the source of truth for /api/history; this is the portable copy.
// Non-PNG outputs (jpeg/webp) pass through untouched — JPEG EXIF is a separate
// effort. Embed errors are logged and the original buffer is returned, so a
// failed stamp never blocks image save.
function stampImageMetaIfPng(buf, format, fields = {}) {
  if (format !== "png") return buf;
  try {
    const chunks = {
      "ima2:version": IMA2_METADATA_VERSION,
      "ima2:prompt": fields.prompt ?? "",
      "ima2:revisedPrompt": fields.revisedPrompt ?? "",
      "ima2:size": fields.size ?? "",
      "ima2:quality": fields.quality ?? "",
      "ima2:model": fields.model ?? "gpt-image-2",
      "ima2:moderation": fields.moderation ?? "",
      "ima2:createdAt": new Date().toISOString(),
    };
    // forkExtras 네임스페이스 — sexy-tune outfit, batch 추적, originalPrompt 등
    // fork 자체 워크플로 정보를 "휴대 가능한 사본" 형태로 PNG 자체에 박아둔다.
    // upstream e1b72fc 기본 스키마는 그대로 두고 fork.* 키만 부가.
    if (fields.originalPrompt) chunks["ima2:fork.originalPrompt"] = String(fields.originalPrompt);
    if (fields.outfitModule && typeof fields.outfitModule === "object") {
      try { chunks["ima2:fork.outfit"] = JSON.stringify(fields.outfitModule); } catch {}
    }
    if (fields.batchId) {
      chunks["ima2:fork.batchId"] = String(fields.batchId);
      if (fields.batchIndex !== undefined && fields.batchIndex !== null) {
        chunks["ima2:fork.batchIndex"] = String(fields.batchIndex);
      }
    }
    if (fields.referenceCount !== undefined && fields.referenceCount !== null) {
      chunks["ima2:fork.referenceCount"] = String(fields.referenceCount);
    }
    if (fields.maxAttempts !== undefined && fields.maxAttempts !== null) {
      chunks["ima2:fork.maxAttempts"] = String(fields.maxAttempts);
    }
    return writeTextChunks(buf, chunks);
  } catch (err) {
    console.warn("[image-metadata] embed failed:", err?.message || err);
    return buf;
  }
}

function ownerOf(meta) {
  return (meta && typeof meta.owner === "string" && meta.owner) || LEGACY_OWNER;
}
function canAccess(meta, authUser) {
  if (!authUser) return true;
  return ownerOf(meta) === authUser;
}

// Structured /api/* request logging (echoes/issues X-Request-Id, redacts body
// and query). Mounted after the auth-user middleware so authUser is captured.
app.use(createRequestLogger());

// ─────────────────────────────────────────────────────────────────────────
// Graceful shutdown gate (2026-04-29).
//
// During a systemctl restart we want existing in-flight generations to
// finish (each one has been billed against the user's ChatGPT Plus image
// quota; killing them mid-stream loses both the work AND the quota). The
// signal handler at the bottom of this file flips SHUTTING_DOWN=true, then
// polls the inflight registry until it drains (max 10 min) before exiting.
// While the flag is set, NEW generation requests are rejected with 503 +
// Retry-After so the client can re-submit after the restart.
//
// Read-only / status endpoints stay open: /api/inflight, /api/billing,
// /api/history, /api/oauth/status — clients need these to render UI even
// during a drain. Only mutation endpoints that would create new in-flight
// state are gated.
// ─────────────────────────────────────────────────────────────────────────
let SHUTTING_DOWN = false;
const SHUTDOWN_GATED_ROUTES = new Set([
  "POST /api/generate",
  "POST /api/edit",
  "POST /api/node/generate",
  "POST /api/enhance", // optional convenience; same drain rule
]);
app.use((req, res, next) => {
  if (!SHUTTING_DOWN) return next();
  const key = `${req.method} ${req.path}`;
  if (!SHUTDOWN_GATED_ROUTES.has(key)) return next();
  res.set("Retry-After", "30");
  res.status(503).json({
    error: "Server is shutting down for restart. Please retry in ~30 seconds.",
    code: "SHUTTING_DOWN",
  });
});

// UI bundle cache policy: index.html must never be cached (so a redeploy is
// picked up immediately), but the hashed /assets/* files are content-addressed
// and safe to mark immutable for a year.
function setUiStaticHeaders(res, filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("/index.html")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return;
  }
  if (normalized.includes("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}
app.use(express.static(join(__dirname, "ui", "dist"), {
  setHeaders: setUiStaticHeaders,
}));
// If a hashed asset path falls through (old browser tab requesting a bundle
// that no longer exists post-deploy), return 404 instead of letting the SPA
// fallback ship index.html as text/javascript.
app.use("/assets", (_req, res) => {
  res.status(404).type("text/plain").send("Asset not found");
});

// /generated is owner-gated when X-Auth-User is set. Sidecar JSON drives ACL.
const GENERATED_DIR = join(__dirname, "generated");
// dotfiles: "allow" lets serve-static deliver `.refs/<hash>.<ext>` (uploaded
// reference thumbnails saved by resolveRefLineage). Without it the default
// "ignore" returns 404 and the Lightbox lineage panel shows broken thumbs
// for any externally-uploaded reference (2026-04-28 user report).
// Dangerous dot dirs (.trash / .failed) are blocked explicitly below.
const generatedStatic = express.static(GENERATED_DIR, { maxAge: "1y", immutable: true, dotfiles: "allow" });
app.use("/generated", async (req, res, next) => {
  // Sidecar JSON and trash/failed dirs are blocked regardless of auth.
  const decoded = (() => { try { return decodeURIComponent(req.path); } catch { return req.path; } })();
  if (decoded.endsWith(".json") || decoded.includes("/.trash/") || decoded.includes("/.failed/")) {
    return res.status(404).end();
  }
  if (!req.authUser) return generatedStatic(req, res, next);
  // Reference-image archive: hashed blobs stored in /.refs/ are content-
  // addressed thumbnails for lineage display. They have no sidecar and
  // belong to whoever uploaded them, but the hash is non-enumerable, so
  // skipping the owner check is safe and keeps the Lightbox lineage
  // thumbnails visible across sessions.
  if (decoded.startsWith("/.refs/")) {
    return generatedStatic(req, res, next);
  }
  if (decoded.startsWith("/.thumbs/")) {
    // Variant assets are owned by their source — derive sidecar path by
    // stripping the .thumb.webp / .web.webp suffix.
    const m = decoded.match(/^\/\.thumbs\/(.+?)\.(thumb|web)\.webp$/);
    if (!m) return res.status(404).end();
    const sourceRel = m[1];
    const sourceTarget = join(GENERATED_DIR, sourceRel);
    if (sourceTarget !== GENERATED_DIR && !sourceTarget.startsWith(GENERATED_DIR + "/")) {
      return res.status(403).end();
    }
    let variantMeta = null;
    try {
      variantMeta = JSON.parse(await readFile(sourceTarget + ".json", "utf-8"));
    } catch {
      // Legacy items without a sidecar are treated as legacy owner — same
      // behaviour as the main /generated/ branch below.
    }
    if (!canAccess(variantMeta, req.authUser)) return res.status(404).end();
    return generatedStatic(req, res, next);
  }
  // Resolve sidecar path safely under GENERATED_DIR
  const rel = decoded.replace(/^\/+/, "");
  const target = join(GENERATED_DIR, rel);
  if (target !== GENERATED_DIR && !target.startsWith(GENERATED_DIR + "/")) {
    return res.status(403).end();
  }
  let meta = null;
  try {
    meta = JSON.parse(await readFile(target + ".json", "utf-8"));
  } catch {
    // node assets use <nodeId>.<ext>.json — already covered by target+".json".
    // For a few legacy paths sidecar may be missing; treat as legacy owner.
  }
  if (!canAccess(meta, req.authUser)) return res.status(404).end();
  return generatedStatic(req, res, next);
});

// Emits a 400 with both string + {code,message} shapes so old clients that
// read err.error.toString() and new clients that introspect err.error.code
// both see useful data. Accepts the validator shapes
// { code, message } (validate.js) and { code, error } (refs.js).
function send400(res, result) {
  return res
    .status(400)
    .json({ error: { code: result.code, message: result.message ?? result.error } });
}

// -- OAuth proxy: generate via Responses API (stream mode) --
// web_search is included in tools for non-reference flows; the model decides
// per-prompt whether to invoke it. No prompt-side suffix — that pollutes the
// user's prompt and reduces model autonomy.

const GENERATE_DEVELOPER_PROMPT = withDefaultPrompt(
  "Generate the image the user describes. If the input is abstract, vague, or non-visual, interpret it creatively and still produce an image. Avoid technical defects (deformed anatomy, watermark, signature, jpeg artifacts, cropped, duplicate).",
);

const EDIT_DEVELOPER_PROMPT = withDefaultPrompt(
  "Apply the user's edit to the original image. Preserve the person's FACE and IDENTITY exactly — the result must be unambiguously the SAME individual. Preserve the original's style and composition unless the edit specifies otherwise. Vary only what the user explicitly requests. Avoid technical defects (deformed anatomy, watermark, jpeg artifacts).",
);

const REFERENCE_DEVELOPER_PROMPT = withDefaultPrompt(
  "Reference mode. The user has attached one or more reference images of an AI-generated synthetic character (a fictional virtual person, not a real individual).\n" +
  "PRESERVATION HIERARCHY (most important first — never compromise the higher items):\n" +
  "  1. FACE — preserve EXACTLY. Same facial features, same eye shape and spacing, same nose shape, same lip contour, same jawline, same eyebrow shape, same skin tone, same apparent age. The person's face must be instantly recognizable as the SAME individual across every variation. This is the single most important constraint.\n" +
  "  2. IDENTITY — same hair color and base hairstyle, same body proportions, same overall build, same gender presentation. Only change these if the user explicitly says so.\n" +
  "  3. ANYTHING the user does NOT explicitly mention — keep close to the reference (accessories, minor clothing details, mood).\n" +
  "WHAT MAY VARY — and only what the user explicitly asks for: pose, angle, expression, framing, camera distance, outfit, background, location, time of day, lighting.\n" +
  "If the user says 'change the outfit', do change it — do NOT keep the reference outfit. The reference is authoritative for FACE and IDENTITY only; for outfit/pose/background follow the user's request literally.\n" +
  "When multiple reference images are attached, treat them as multi-angle references of the same person; the FIRST image is the primary identity anchor.\n" +
  "Avoid technical defects (deformed anatomy, watermark, signature, jpeg artifacts). Do not perform a web search; the reference image(s) are already the source of truth.",
);

// upstream 2b2b9d4 흡수 (4K 진단): 빈 응답 에러에 진단 사유를 붙여
// failed-sidecar 에 errorCode 외 추가 컨텍스트가 남도록 한다.
//   experimental_4k_empty_response — gpt-image-2 가 4K(>=3840) 사이즈에서
//     빈 응답을 자주 내는 알려진 케이스
//   reference_mime_mismatch_candidate — UI 가 declaredMime 으로 보냈지만
//     실제 매직넘버는 다른 ref 가 있어 모델이 거부한 가능성
function diagnose4kReason(size) {
  if (typeof size !== "string") return null;
  const [w, h] = size.split("x").map((p) => Number(p));
  if (Number.isFinite(w) && Number.isFinite(h) && Math.max(w, h) >= 3840) {
    return "experimental_4k_empty_response";
  }
  return null;
}

function diagnoseRefMismatch(references) {
  // references[] 는 b64 문자열 배열. detectImageMimeFromB64 결과가
  // null/undefined 인 경우 ref MIME 인식 실패로 간주.
  if (!Array.isArray(references) || references.length === 0) return null;
  for (const b64 of references) {
    const detected = detectImageMimeFromB64(b64);
    if (!detected) return "reference_mime_mismatch_candidate";
  }
  return null;
}

async function generateViaOAuth(prompt, quality, size, moderation = "auto", references = [], requestId = null, options = {}) {
  const hasRefs = references.length > 0;
  const tag = requestId ? `[oauth][${requestId}]` : `[oauth]`;
  const { partialImages, onPartialImage } = options;
  console.log(
    `${tag} call: quality=${quality} size=${size} moderation=${moderation} ` +
    `refs=${references.length} promptLen=${prompt.length}` +
    (partialImages ? ` partial=${partialImages}` : ""),
  );

  // gpt-image-2 (the actual image model dispatched by the Responses API
  // image_generation tool) processes every input image at high fidelity
  // automatically and rejects an explicit `input_fidelity` parameter.
  // See: https://cookbook.openai.com/examples/generate_images_with_high_input_fidelity
  const imageTool = {
    type: "image_generation",
    quality,
    size,
    moderation,
    ...(partialImages ? { partial_images: partialImages } : {}),
  };

  const tools = hasRefs ? [imageTool] : [{ type: "web_search" }, imageTool];

  // user role carries only the user's prompt (plus boostRefPrompt's short
  // face-lock cue when reference mode + a short/variation prompt). All wrapper
  // text lives in REFERENCE_DEVELOPER_PROMPT / GENERATE_DEVELOPER_PROMPT to
  // keep model autonomy on the user's wording itself.
  const textPrompt = hasRefs ? boostRefPrompt(prompt) : prompt;

  const userContent = hasRefs
    ? [
        ...references.map((b64) => ({
          type: "input_image",
          image_url: `data:${detectImageMimeFromB64(b64) || "image/png"};base64,${b64}`,
        })),
        { type: "input_text", text: textPrompt },
      ]
    : textPrompt;

  const onPhase = requestId ? (phase) => setJobPhase(requestId, phase) : undefined;
  const developerPrompt = hasRefs ? REFERENCE_DEVELOPER_PROMPT : GENERATE_DEVELOPER_PROMPT;

  const stream = await runResponses({
    url: OAUTH_URL,
    body: {
      model: "gpt-5.5",
      reasoning: { effort: "medium" },
      input: [
        { role: "developer", content: developerPrompt },
        { role: "user", content: userContent },
      ],
      tools,
      tool_choice: hasRefs ? "required" : "auto",
      stream: true,
    },
    onPhase,
    onPartialImage,
  });

  if (stream.b64) {
    console.log(
      `${tag} stream SUCCESS: b64Len=${stream.b64.length} events=${stream.eventCount} ` +
      `webSearchCalls=${stream.webSearchCalls ?? 0}`,
    );
    return { b64: stream.b64, usage: stream.usage, webSearchCalls: stream.webSearchCalls, codexAccount: stream.codexAccount };
  }

  // Ref-mode already uses minimal tools + tool_choice:required; a fallback
  // retry would only strip the reference image, which defeats the purpose.
  // Fail loudly so the caller knows the reference call itself fell through.
  if (hasRefs) {
    const reason = diagnoseRefMismatch(references) || diagnose4kReason(size);
    console.warn(
      `${tag} stream EMPTY in ref-mode: events=${stream.eventCount} — throwing` +
      (reason ? ` (diagnostic=${reason})` : ""),
    );
    const e = new Error(
      `No image data received from OAuth proxy in reference mode (parsed ${stream.eventCount} events)`,
    );
    e.code = "UPSTREAM_EMPTY";
    if (reason) e.diagnosticReason = reason;
    e.refsCount = references.length;
    throw e;
  }

  // Stream ended without an image; proxy sometimes splits the response.
  // Retry once with stream:false + no web_search to isolate whether the
  // image was generated at all.
  console.log(
    `${tag} stream EMPTY: events=${stream.eventCount} — retrying non-stream without web_search`,
  );
  const retry = await runResponses({
    url: OAUTH_URL,
    body: {
      model: "gpt-5.5",
      reasoning: { effort: "medium" },
      input: [
        { role: "developer", content: GENERATE_DEVELOPER_PROMPT },
        { role: "user", content: prompt },
      ],
      tools: [{ type: "image_generation", quality, size, moderation }],
      stream: false,
    },
  });
  if (retry.b64) {
    console.log(
      `${tag} non-stream retry SUCCESS: b64Len=${retry.b64.length}`,
    );
    return { b64: retry.b64, usage: retry.usage, webSearchCalls: stream.webSearchCalls, codexAccount: retry.codexAccount || stream.codexAccount };
  }

  const finalReason = diagnose4kReason(size);
  console.warn(
    `${tag} non-stream retry EMPTY: events=${stream.eventCount} — throwing` +
    (finalReason ? ` (diagnostic=${finalReason})` : ""),
  );
  const e = new Error(
    `No image data received from OAuth proxy (parsed ${stream.eventCount} events)`,
  );
  e.code = "UPSTREAM_EMPTY";
  if (finalReason) e.diagnosticReason = finalReason;
  throw e;
}

// Errors we should NOT keep retrying: rate-limit / usage-cap responses from
// upstream OpenAI come back with the body "The usage limit has been reached"
// (or 429 / "too many requests" / "quota"). Retrying just burns more budget
// and adds latency. Detect by message OR explicit code so future code paths
// can set `err.code = "USAGE_LIMIT"` directly.
const USAGE_LIMIT_RE = /usage limit|quota|too many requests|rate.?limit/i;
function isUsageLimitError(e) {
  if (!e) return false;
  if (e.code === "USAGE_LIMIT" || e.status === 429) return true;
  const msg = e.message || "";
  return USAGE_LIMIT_RE.test(msg);
}

// OAuth token revoked / expired upstream → openai-oauth proxy returns the
// raw upstream message ("Your authentication token has been invalidated.
// Please try signing in again." / "Encountered invalidated oauth token for
// user, failing request"). Re-firing the same prompt with safety variants
// or LLM-rewrite tier cannot fix this — only the user re-running `codex
// login` (or equivalent re-auth) can. Detect early and bail after ONE
// attempt to avoid the 5-attempt × 31-prompt = 155-call thrash that a
// 31-prompt batch produced on 2026-04-30 (see generated/.failed/*.json
// timestamps 1777537586–590).
const AUTH_ERROR_RE =
  /authentication token has been invalidated|invalidated oauth token|please try signing in again|sign in again/i;
function isAuthError(e) {
  if (!e) return false;
  if (e.code === "AUTH_INVALIDATED" || e.status === 401) return true;
  return AUTH_ERROR_RE.test(e.message || "");
}

// Local OAuth proxy crashed / restarting → fetch to 127.0.0.1:10531 fails
// in <5ms with `TypeError: fetch failed` whose `cause.code` is one of
// ECONNREFUSED / ECONNRESET / EAI_AGAIN. The proxy auto-restarts every 5s
// (ima2-gen.service supervisor), so the right move is wait + retry the
// SAME variant — NOT advance the safety variant, NOT count it against the
// safety retry budget. We cap consecutive network errors at 2 so a fully
// dead proxy fails fast instead of stalling 7 attempts × 5s = 35s of
// useless "fetch failed" log spam.
const NETWORK_ERROR_CAUSE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
]);
function isNetworkError(e) {
  if (!e) return false;
  if (e.code && NETWORK_ERROR_CAUSE_CODES.has(e.code)) return true;
  const cause = e.cause;
  if (cause?.code && NETWORK_ERROR_CAUSE_CODES.has(cause.code)) return true;
  // undici throws bare `TypeError: fetch failed` with the underlying socket
  // error in `.cause`. The message alone is enough to match because we only
  // call fetch against the local OAuth proxy in the retry loop.
  const msg = e?.message || "";
  return /^fetch failed$/i.test(msg);
}
const NETWORK_RETRY_DELAY_MS = 5000;
const NETWORK_RETRY_MAX_CONSECUTIVE = 2;

async function runPromptAttempts(prompt, invoke, label, maxAttempts = 2, onAttempt = null, ctx = {}) {
  const attempts = buildAttemptSequence(prompt, maxAttempts, { hasRefs: ctx.hasRefs === true });
  const log = [];
  let lastErr;
  // Tracks back-to-back network failures so the loop bails fast when the
  // OAuth proxy is fully dead (vs. just briefly restarting).
  let consecutiveNetErrors = 0;

  const tag = ctx.requestId ? `[${label}][${ctx.requestId}]` : `[${label}]`;
  console.log(
    `${tag} start: maxAttempts=${maxAttempts} plannedVariants=${attempts.length} ` +
    `hasCompliantVariant=${attempts.some((p) => p !== prompt)} ` +
    `promptLen=${prompt.length}`,
  );

  for (let i = 0; i < attempts.length; i++) {
    const attemptPrompt = attempts[i];
    const isCompliantRetry = attemptPrompt !== prompt;
    const startedAt = Date.now();
    console.log(
      `${tag} attempt ${i + 1}/${attempts.length} begin: ` +
      `compliantVariant=${isCompliantRetry} promptLen=${attemptPrompt.length}`,
    );
    if (typeof onAttempt === "function") {
      try { onAttempt(i + 1, attempts.length); } catch {}
    }
    try {
      const r = await invoke(attemptPrompt);
      const durationMs = Date.now() - startedAt;
      if (r.b64) {
        log.push({
          attempt: i + 1,
          promptUsed: attemptPrompt,
          compliantVariant: isCompliantRetry,
          ok: true,
          errorMessage: null,
          errorCode: null,
          durationMs,
          startedAt,
          reasoningSummary: r.reasoningSummary || null,
          refusalText: r.refusalText || null,
          eventTypeCounts: r.eventTypeCounts || null,
          usage: r.usage || null,
        });
        console.log(
          `${tag} attempt ${i + 1}/${attempts.length} SUCCESS in ${durationMs}ms ` +
          `b64Len=${r.b64.length}`,
        );
        return {
          ...r,
          promptUsed: attemptPrompt,
          promptRewrittenForSafety: isCompliantRetry,
          attempts: log,
        };
      }
      // upstream 45b7892: refusalText/reasoningSummary 없으면 실제 moderation 아님 →
      // EMPTY_RESPONSE 로 분기해서 사용자에게 "빈 응답" 메시지 안내. refusalText 있을
      // 때만 SAFETY_REFUSAL 유지.
      const isActualSafety = Boolean(r?.refusalText) || Boolean(r?.reasoningSummary);
      lastErr = new Error(isActualSafety ? "Empty response (safety refusal)" : "Empty response (no image data)");
      lastErr.code = isActualSafety ? "SAFETY_REFUSAL" : "EMPTY_RESPONSE";
      log.push({
        attempt: i + 1,
        promptUsed: attemptPrompt,
        compliantVariant: isCompliantRetry,
        ok: false,
        errorMessage: lastErr.message,
        errorCode: lastErr.code,
        durationMs,
        startedAt,
        reasoningSummary: r?.reasoningSummary || null,
        refusalText: r?.refusalText || null,
        eventTypeCounts: r?.eventTypeCounts || null,
        usage: r?.usage || null,
      });
      if (r?.reasoningSummary || r?.refusalText) {
        console.warn(
          `${tag} attempt ${i + 1} reasoning/refusal capture: ` +
          `reasoningLen=${r.reasoningSummary?.length || 0} refusalLen=${r.refusalText?.length || 0}`,
        );
      }
      console.warn(
        `${tag} attempt ${i + 1}/${attempts.length} EMPTY (safety refusal) after ${durationMs}ms`,
      );
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      lastErr = e;
      // Adaptive routing (단계 3): parse safety_violations=[xxx] from the
      // upstream error and stash on the attempt log + decide loop control.
      const violation = parseSafetyViolation(e);
      const networkErr = isNetworkError(e);
      const authErr = isAuthError(e);
      log.push({
        attempt: i + 1,
        promptUsed: attemptPrompt,
        compliantVariant: isCompliantRetry,
        ok: false,
        errorMessage: e?.message || String(e),
        errorCode: e?.code || e?.cause?.code || null,
        durationMs,
        startedAt,
        violationCategories: violation ? Array.from(violation.categories) : null,
        networkError: networkErr || null,
        authError: authErr || null,
        // Partial usage / event histogram captured by oauthStream before
        // the error surfaced. Important for token-spend audits — a "failed"
        // attempt can still bill reasoning + image_generation tool tokens.
        usage: e?.usage || null,
        eventTypeCounts: e?.eventTypeCounts || null,
        reasoningSummary: e?.reasoningSummary || null,
        refusalText: e?.refusalText || null,
      });
      console.warn(
        `${tag} attempt ${i + 1}/${attempts.length} THREW after ${durationMs}ms: ` +
        `code=${e?.code || e?.cause?.code || "?"} msg=${(e?.message || String(e)).slice(0, 200)}` +
        (violation ? ` violation=[${Array.from(violation.categories).join(",")}]` : "") +
        (networkErr ? ` [NETWORK]` : "") +
        (authErr ? ` [AUTH]` : ""),
      );
      // Auth-invalidated path: upstream OAuth token was revoked. No prompt
      // rewrite or wrapper can fix this — only re-auth (codex login). Bail
      // after the FIRST attempt to avoid burning the rest of the safety
      // retry budget × every prompt in the batch (2026-04-30 incident:
      // 31 prompts × 5 attempts = 155 wasted calls before any feedback).
      if (authErr) {
        const stop = new Error(
          e?.message || "OAuth token invalidated — re-authentication required",
        );
        stop.code = "AUTH_INVALIDATED";
        stop.status = 401;
        stop.cause = e;
        stop.attempts = log;
        console.warn(
          `${tag} non-retryable AUTH — aborting after ${i + 1}/${attempts.length} ` +
            `(re-auth required, no point cycling variants)`,
        );
        throw stop;
      }
      // Network failure path: OAuth proxy on 127.0.0.1:10531 is down or
      // restarting. Sleep to let the supervisor's 5s auto-restart finish,
      // then retry the SAME variant (don't burn safety retries on a
      // transport-level fault). After 2 consecutive network errors give
      // up — the proxy is fully dead, no point in cycling more.
      if (networkErr) {
        consecutiveNetErrors += 1;
        if (consecutiveNetErrors >= NETWORK_RETRY_MAX_CONSECUTIVE) {
          const stop = new Error(
            `OAuth proxy unreachable after ${consecutiveNetErrors} attempts: ${e?.message || String(e)}`,
          );
          stop.code = "PROXY_UNREACHABLE";
          stop.status = 503;
          stop.cause = e;
          stop.attempts = log;
          console.warn(
            `${tag} non-retryable NETWORK — aborting after ${i + 1}/${attempts.length} ` +
              `(${consecutiveNetErrors} consecutive fetch failures)`,
          );
          throw stop;
        }
        console.warn(
          `${tag} network error (${consecutiveNetErrors}/${NETWORK_RETRY_MAX_CONSECUTIVE}) — ` +
            `sleeping ${NETWORK_RETRY_DELAY_MS}ms then retrying SAME variant`,
        );
        await new Promise((r) => setTimeout(r, NETWORK_RETRY_DELAY_MS));
        i -= 1; // re-attempt the same variant (decremented before for-loop ++)
        continue;
      }
      // Reset network counter on non-network errors so an old proxy hiccup
      // doesn't leak into a later cycle's bail-out budget.
      consecutiveNetErrors = 0;
      // Non-retryable: usage limit / quota / 429. Stop the loop and throw
      // a typed error so the route handler can forward it to the client.
      if (isUsageLimitError(e)) {
        const stop = new Error(e?.message || "OpenAI usage limit reached");
        stop.code = "USAGE_LIMIT";
        stop.status = 429;
        stop.cause = e;
        stop.attempts = log;
        console.warn(
          `${tag} non-retryable USAGE_LIMIT — aborting after ${i + 1}/${attempts.length}`,
        );
        throw stop;
      }
      // Adaptive bail-out: minors / sexual_minors are unrecoverable. No
      // wrapper or context can rescue these — bail immediately.
      if (violation?.unrecoverable) {
        const stop = new Error(
          `Safety system rejected with unrecoverable category: ` +
            `${Array.from(violation.categories).join(", ")}`,
        );
        stop.code = "SAFETY_UNRECOVERABLE";
        stop.status = 422;
        stop.cause = e;
        stop.attempts = log;
        stop.violationCategories = Array.from(violation.categories);
        console.warn(
          `${tag} non-retryable SAFETY [${Array.from(violation.categories).join(",")}] ` +
            `— aborting after ${i + 1}/${attempts.length}`,
        );
        throw stop;
      }
    }

    if (i < attempts.length - 1) {
      const mode = isCompliantRetry ? "compliant retry failed" : "retrying";
      // Adaptive routing log (단계 3): when the rejection is skin-related,
      // call out that the next attempt is guaranteed-different (the cycle
      // has 7 unique variants for strong-trigger prompts). When the
      // rejection is non-skin (transient / unrelated), call out that we're
      // re-trying without a new wrapper.
      const violation = parseSafetyViolation(lastErr);
      const route = violation?.skinRelated
        ? "skin-related → next variant"
        : violation
          ? `non-skin [${Array.from(violation.categories).join(",")}] → cycling`
          : "transient → cycling";
      console.log(`${tag} ${mode} (${i + 1}/${attempts.length}) [${route}] after: ${lastErr?.message?.slice(0, 160)}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // 단계 4 (2026-04-29) — LLM rewrite tier (last resort).
  // All static variants failed. Ask GPT-5.5 (via the same OAuth proxy) to
  // rewrite the original prompt around the rejection signals (categories
  // + reasoningSummary + refusalText captured from the last attempt) and
  // try one more time. We only invoke this when the failure pattern looks
  // like a skin-related safety refusal, since rewriting a non-safety
  // failure (transient 5xx, network reset) wastes tokens.
  // ───────────────────────────────────────────────────────────────────────
  const lastViolation = parseSafetyViolation(lastErr);
  const lastLog = log[log.length - 1] || {};
  const llmRewriteEnabled = process.env.IMA2_DISABLE_LLM_REWRITE !== "1" &&
    ctx.disableLLMRewrite !== true;
  const looksSafetyRelated =
    lastErr?.code === "SAFETY_REFUSAL" ||
    !!lastViolation ||
    (lastLog && lastLog.refusalText) ||
    (lastErr?.message && /safety system|content policy|safety_violations/i.test(lastErr.message));
  if (llmRewriteEnabled && looksSafetyRelated && !lastViolation?.unrecoverable && OAUTH_URL) {
    console.log(
      `${tag} LLM-rewrite tier engaging — categories=[${lastViolation ? Array.from(lastViolation.categories).join(",") : "unknown"}]`,
    );
    let rewritten = null;
    try {
      rewritten = await rewritePromptForSafety({
        prompt,
        oauthUrl: OAUTH_URL,
        categories: lastViolation ? Array.from(lastViolation.categories) : ["sexual"],
        refusalText: lastLog.refusalText || null,
        reasoningSummary: lastLog.reasoningSummary || null,
        tag,
      });
    } catch (e) {
      console.warn(`${tag} LLM-rewrite call threw: ${e?.message?.slice(0, 200)}`);
    }
    if (rewritten) {
      const i = attempts.length;
      const startedAt = Date.now();
      console.log(
        `${tag} attempt ${i + 1}/${attempts.length + 1} (LLM-REWRITE) begin: ` +
        `promptLen=${rewritten.length}`,
      );
      if (typeof onAttempt === "function") {
        try { onAttempt(i + 1, attempts.length + 1); } catch {}
      }
      try {
        const r = await invoke(rewritten);
        const durationMs = Date.now() - startedAt;
        if (r.b64) {
          log.push({
            attempt: i + 1,
            promptUsed: rewritten,
            compliantVariant: true,
            llmRewrite: true,
            ok: true,
            errorMessage: null,
            errorCode: null,
            durationMs,
            startedAt,
            reasoningSummary: r.reasoningSummary || null,
            refusalText: r.refusalText || null,
            eventTypeCounts: r.eventTypeCounts || null,
            usage: r.usage || null,
          });
          console.log(
            `${tag} attempt ${i + 1}/${attempts.length + 1} (LLM-REWRITE) SUCCESS in ${durationMs}ms ` +
            `b64Len=${r.b64.length}`,
          );
          return {
            ...r,
            promptUsed: rewritten,
            promptRewrittenForSafety: true,
            llmRewriteUsed: true,
            attempts: log,
          };
        }
        // upstream 45b7892: LLM rewrite 후에도 빈 응답 — 단 r.refusalText/reasoningSummary
        // 가 있으면 실제 moderation, 없으면 단순 빈 응답.
        const isActualSafetyRewrite = Boolean(r?.refusalText) || Boolean(r?.reasoningSummary);
        lastErr = new Error(isActualSafetyRewrite ? "Empty response (safety refusal after LLM rewrite)" : "Empty response after LLM rewrite (no image data)");
        lastErr.code = isActualSafetyRewrite ? "SAFETY_REFUSAL" : "EMPTY_RESPONSE";
        log.push({
          attempt: i + 1,
          promptUsed: rewritten,
          compliantVariant: true,
          llmRewrite: true,
          ok: false,
          errorMessage: lastErr.message,
          errorCode: lastErr.code,
          durationMs,
          startedAt,
          reasoningSummary: r?.reasoningSummary || null,
          refusalText: r?.refusalText || null,
          eventTypeCounts: r?.eventTypeCounts || null,
          usage: r?.usage || null,
        });
        console.warn(
          `${tag} attempt ${i + 1}/${attempts.length + 1} (LLM-REWRITE) EMPTY (safety refusal) after ${durationMs}ms`,
        );
      } catch (e) {
        const durationMs = Date.now() - startedAt;
        lastErr = e;
        const violation = parseSafetyViolation(e);
        log.push({
          attempt: i + 1,
          promptUsed: rewritten,
          compliantVariant: true,
          llmRewrite: true,
          ok: false,
          errorMessage: e?.message || String(e),
          errorCode: e?.code || null,
          durationMs,
          startedAt,
          violationCategories: violation ? Array.from(violation.categories) : null,
          usage: e?.usage || null,
          eventTypeCounts: e?.eventTypeCounts || null,
          reasoningSummary: e?.reasoningSummary || null,
          refusalText: e?.refusalText || null,
        });
        console.warn(
          `${tag} attempt ${i + 1}/${attempts.length + 1} (LLM-REWRITE) THREW after ${durationMs}ms: ` +
          `${(e?.message || String(e)).slice(0, 200)}`,
        );
      }
    } else {
      console.log(`${tag} LLM-rewrite returned null — surfacing original failure`);
    }
  }

  console.error(
    `${tag} ALL ${attempts.length} ATTEMPTS FAILED: lastCode=${lastErr?.code || "?"} ` +
    `lastMsg=${(lastErr?.message || String(lastErr || "")).slice(0, 200)}`,
  );

  // upstream 45b7892: SAFETY_REFUSAL/EMPTY_RESPONSE/UPSTREAM_EMPTY 별로 메시지/status 분기.
  let finalCode;
  let finalMsg;
  if (lastErr?.code === "SAFETY_REFUSAL") {
    finalCode = "SAFETY_REFUSAL";
    finalMsg = "Content generation refused after retries";
  } else if (lastErr?.code === "EMPTY_RESPONSE" || lastErr?.code === "UPSTREAM_EMPTY") {
    finalCode = "EMPTY_RESPONSE";
    finalMsg = "이미지 응답이 비어 있습니다. 사이즈/품질 조합을 바꾸거나 잠시 후 다시 시도해 주세요.";
  } else {
    finalCode = lastErr?.code || "ALL_ATTEMPTS_FAILED";
    finalMsg = lastErr?.message || "Content generation failed after retries";
  }
  const err = new Error(finalMsg);
  err.code = finalCode;
  err.status = (finalCode === "SAFETY_REFUSAL" || finalCode === "EMPTY_RESPONSE") ? 422 : 502;
  if (lastErr?.diagnosticReason) err.diagnosticReason = lastErr.diagnosticReason;
  err.cause = lastErr;
  err.attempts = log;
  throw err;
}

// Sum numeric usage fields across all attempts in a runPromptAttempts log.
// Used to surface "this generation actually billed N reasoning + M output
// tokens despite ending in failure" in the failure sidecar — without it,
// only the final successful attempt's usage was tracked, which made
// retry-thrash incidents (e.g. 5 attempts × 31 prompts on AUTH_INVALIDATED)
// invisible in the per-image accounting.
function sumAttemptsUsage(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const total = {};
  let any = false;
  for (const a of attempts) {
    const u = a?.usage;
    if (!u || typeof u !== "object") continue;
    for (const [k, v] of Object.entries(u)) {
      if (typeof v === "number") {
        total[k] = (total[k] || 0) + v;
        any = true;
      }
    }
  }
  return any ? total : null;
}

function clampMaxAttempts(v, fallback = 2) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (n > 10) return 10;
  return n;
}

// Persist a failed generation attempt for the log UI + retry button.
// Refs are NOT saved (see retry flow): refs live in the browser and are
// re-attached when the user invokes retry from a history item that had them.
async function writeFailureSidecar({ endpoint, prompt, originalPrompt = null, quality, size, format, moderation, attempts, error, sessionId = null, parentNodeId = null, clientNodeId = null, referenceCount = 0, owner = null, requestId = null, outfitModule = null, batchId = null, batchIndex = null }) {
  try {
    const dir = join(__dirname, "generated", ".failed");
    await mkdir(dir, { recursive: true });
    const id = `${Date.now()}_${randomBytes(4).toString("hex")}`;
    const record = {
      id,
      status: "failed",
      endpoint,
      prompt,
      ...(originalPrompt ? { originalPrompt } : {}),
      quality,
      size,
      format: format || null,
      moderation: moderation || null,
      provider: "oauth",
      createdAt: Date.now(),
      sessionId,
      parentNodeId,
      clientNodeId,
      referenceCount,
      owner: owner || LEGACY_OWNER,
      requestId,
      attempts: attempts || [],
      attemptsTotalUsage: sumAttemptsUsage(attempts),
      errorCode: error?.code || "UNKNOWN",
      errorMessage: error?.message || String(error || ""),
      ...(error?.diagnosticReason ? { diagnosticReason: error.diagnosticReason } : {}),
      ...(typeof error?.refsCount === "number" ? { refsCount: error.refsCount } : {}),
      ...(outfitModule ? { outfitModule } : {}),
      ...(batchId ? { batchId, batchIndex } : {}),
    };
    await writeFile(join(dir, `${id}.json`), JSON.stringify(record));
    return id;
  } catch (e) {
    console.warn("[failed-sidecar] write failed:", e.message);
    return null;
  }
}

// -- Outfit pool (sexy-tune batch generator) --
//
// GET /api/outfit/categories
//   → { categories: string[], presets: { id, label, category, risk }[] }
//   List metadata only — used by the UI to render category filter chips.
//
// POST /api/outfit/sample
//   body: { count, maxRisk?, categories?, aspectRatio? }
//   → { variants: { id, label, category, risk, prompt }[] }
//   Returns N composed prompts ready to feed straight into /api/generate.
//   Each variant is a different outfit module from the curated pool.
app.get("/api/outfit/categories", (_req, res) => {
  res.json({
    categories: OUTFIT_CATEGORIES,
    presets: OUTFIT_PRESETS.map(({ id, label, category, risk }) => ({
      id,
      label,
      category,
      risk,
    })),
  });
});

// Compute per-module pass-rate stats from sidecar history. Walks both the
// success and failure directories. Cached briefly so a flurry of modal opens
// doesn't re-scan the disk every time.
let __outfitStatsCache = null;
let __outfitStatsCachedAt = 0;
const OUTFIT_STATS_TTL_MS = 30_000;

async function computeOutfitStats() {
  const now = Date.now();
  if (__outfitStatsCache && now - __outfitStatsCachedAt < OUTFIT_STATS_TTL_MS) {
    return __outfitStatsCache;
  }
  /** @type {Record<string, { success: number; fail: number; lastUsed: number; label: string|null; category: string|null; risk: string|null }>} */
  const stats = {};
  const bump = (m, ok, ts) => {
    if (!m?.id) return;
    const e = stats[m.id] || (stats[m.id] = {
      success: 0,
      fail: 0,
      lastUsed: 0,
      label: m.label || null,
      category: m.category || null,
      risk: m.risk || null,
    });
    if (ok) e.success++;
    else e.fail++;
    if (ts > e.lastUsed) e.lastUsed = ts;
    if (!e.label && m.label) e.label = m.label;
    if (!e.category && m.category) e.category = m.category;
    if (!e.risk && m.risk) e.risk = m.risk;
  };

  // Success sidecars (top-level *.json files, excluding the .failed dir)
  const genDir = join(__dirname, "generated");
  const successFiles = await readdir(genDir, { withFileTypes: true }).catch(() => []);
  for (const f of successFiles) {
    if (!f.isFile() || !f.name.endsWith(".json")) continue;
    try {
      const m = JSON.parse(await readFile(join(genDir, f.name), "utf-8"));
      if (m?.outfitModule) bump(m.outfitModule, true, m.createdAt || 0);
    } catch {}
  }

  // Failure sidecars
  const failedDir = join(genDir, ".failed");
  const failedFiles = await readdir(failedDir, { withFileTypes: true }).catch(() => []);
  for (const f of failedFiles) {
    if (!f.isFile() || !f.name.endsWith(".json")) continue;
    try {
      const m = JSON.parse(await readFile(join(failedDir, f.name), "utf-8"));
      if (m?.outfitModule) bump(m.outfitModule, false, m.createdAt || 0);
    } catch {}
  }

  __outfitStatsCache = stats;
  __outfitStatsCachedAt = now;
  return stats;
}

// GET /api/outfit/stats → { stats: { [moduleId]: { success, fail, passRate, lastUsed, label, category, risk } } }
app.get("/api/outfit/stats", async (_req, res) => {
  try {
    const raw = await computeOutfitStats();
    const out = {};
    for (const [id, s] of Object.entries(raw)) {
      const total = s.success + s.fail;
      out[id] = {
        ...s,
        total,
        passRate: total > 0 ? s.success / total : null,
      };
    }
    res.json({ stats: out, presetCount: OUTFIT_PRESETS.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/outfit/sample", express.json({ limit: "256kb" }), async (req, res) => {
  const body = req.body || {};
  const countRaw = Number(body.count);
  const count = Math.max(
    1,
    Math.min(8, Number.isFinite(countRaw) ? Math.floor(countRaw) : 4),
  );
  const maxRisk = ["low", "medium", "high"].includes(body.maxRisk)
    ? body.maxRisk
    : "medium";
  const categories = Array.isArray(body.categories) && body.categories.length > 0
    ? body.categories.filter((c) => typeof c === "string")
    : undefined;
  const excludeIds = Array.isArray(body.excludeIds)
    ? body.excludeIds.filter((s) => typeof s === "string")
    : undefined;
  const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio : "1:1";
  const cameraTone = body.cameraTone === "iphone" ? "iphone" : "canon";
  const includeMirror = body.includeMirror === true;
  const includeFlirty = body.includeFlirty !== false; // default true
  const useWeights = body.useWeights !== false; // default true
  const framingMode = body.framingMode === "full-body" || body.framingMode === "half-body"
    ? body.framingMode
    : "mixed";
  // 2026-04-30 — aestheticMode toggle decouples sexy-tune from the
  // amateur-snapshot default. amateur (legacy) | editorial | glamour | off.
  // Off = no aesthetic prescription block (maximum model autonomy).
  const aestheticMode = ["amateur", "editorial", "glamour", "off"].includes(body.aestheticMode)
    ? body.aestheticMode
    : "amateur";
  // 2026-04-30 — risk:high modules auto-enable includeChestLine via
  // composeOutfitPrompt. The body can still force it off explicitly with
  // includeChestLine:false; otherwise undefined → auto.
  const includeChestLine = typeof body.includeChestLine === "boolean"
    ? body.includeChestLine
    : undefined;
  // 2026-04-29 — random vs series mode. The UI sends hasReferences:false
  // when no reference photo is attached, so the prompt drops the
  // [얼굴 — 참조에서…] / [참조와 다른 값 강제] / "참고 이미지 인물의 머리카락"
  // blocks and the model is free to invent a fresh face per shot.
  const hasReferences = body.hasReferences !== false; // default true (legacy)

  let weights;
  if (useWeights) {
    try {
      const stats = await computeOutfitStats();
      weights = weightsFromStats(stats);
    } catch {
      // best-effort; fall back to uniform sampling
    }
  }

  const variants = sampleOutfitPrompts({
    count,
    maxRisk,
    categories,
    excludeIds,
    weights,
    aspectRatio,
    cameraTone,
    includeMirror,
    includeFlirty,
    framingMode,
    hasReferences,
    aestheticMode,
    ...(includeChestLine !== undefined ? { includeChestLine } : {}),
  });
  res.json({ variants, framingMode, hasReferences });
});

// -- Reference bundles --
// Save a named set of reference images so the user can re-attach them later
// without re-uploading. Storage = single JSON file in the config dir; binary
// thumbnails are content-addressed in generated/.refs/<hash>.<ext> (already
// written by resolveRefLineage). Bundles store only { hash, ext, sourceUrl }
// per item, so the file stays small and survives restart.
const BUNDLES_DIR = process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");
const BUNDLES_FILE = join(BUNDLES_DIR, "refBundles.json");

async function loadBundles() {
  try {
    const raw = await readFile(BUNDLES_FILE, "utf-8");
    const j = JSON.parse(raw);
    return Array.isArray(j?.bundles) ? j.bundles : [];
  } catch {
    return [];
  }
}

async function saveBundles(bundles) {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const tmp = BUNDLES_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify({ bundles }, null, 2));
  // Atomic rename so a crash mid-write can't truncate the file.
  await rename(tmp, BUNDLES_FILE);
}

function bundleVisibleTo(bundle, authUser) {
  if (!authUser) return true;
  return (bundle.owner || LEGACY_OWNER) === authUser;
}

// GET /api/ref-bundles → { bundles: [{ id, name, items, createdAt }] }
app.get("/api/ref-bundles", async (req, res) => {
  try {
    const all = await loadBundles();
    const visible = all
      .filter((b) => bundleVisibleTo(b, req.authUser))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ bundles: visible });
  } catch (err) {
    res.status(500).json({ error: { code: "BUNDLE_READ_FAIL", message: err.message } });
  }
});

// POST /api/ref-bundles { name, references: [b64...] } → { bundle }
// Hashes references via resolveRefLineage so blobs land in /generated/.refs/.
app.post("/api/ref-bundles", express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: { code: "BUNDLE_NAME_REQUIRED", message: "이름을 입력해 주세요." } });
    const refs = Array.isArray(req.body?.references) ? req.body.references : [];
    if (refs.length === 0) {
      return res.status(400).json({ error: { code: "BUNDLE_NO_REFS", message: "참조 이미지가 비어 있습니다." } });
    }
    const refCheck = validateAndNormalizeRefs(refs);
    if (refCheck.error) return send400(res, refCheck);
    const lineage = await resolveRefLineage(refCheck.refs, {
      generatedDir: GENERATED_DIR,
      hint: Array.isArray(req.body?.referenceMeta) ? req.body.referenceMeta : [],
    });
    const items = lineage.map((l) => ({
      hash: l.hash,
      sourceUrl: l.sourceUrl,
      kind: l.kind,
      ...(l.filename ? { filename: l.filename } : {}),
    }));
    const bundle = {
      id: `b_${Date.now()}_${randomBytes(4).toString("hex")}`,
      name,
      owner: req.authUser || LEGACY_OWNER,
      items,
      createdAt: Date.now(),
    };
    const all = await loadBundles();
    all.push(bundle);
    await saveBundles(all);
    res.json({ bundle });
  } catch (err) {
    console.error("[ref-bundles] save failed:", err);
    res.status(500).json({ error: { code: "BUNDLE_SAVE_FAIL", message: err.message } });
  }
});

// DELETE /api/ref-bundles/:id → { ok: true }
app.delete("/api/ref-bundles/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const all = await loadBundles();
    const target = all.find((b) => b.id === id);
    if (!target) return res.status(404).json({ error: { code: "BUNDLE_NOT_FOUND", message: "묶음을 찾을 수 없습니다." } });
    if (!bundleVisibleTo(target, req.authUser)) {
      return res.status(403).json({ error: { code: "BUNDLE_FORBIDDEN", message: "권한이 없습니다." } });
    }
    const next = all.filter((b) => b.id !== id);
    await saveBundles(next);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { code: "BUNDLE_DELETE_FAIL", message: err.message } });
  }
});

// PATCH /api/ref-bundles/:id { name } → { bundle }
app.patch("/api/ref-bundles/:id", express.json({ limit: "16kb" }), async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const name = String(req.body?.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: { code: "BUNDLE_NAME_REQUIRED", message: "이름을 입력해 주세요." } });
    const all = await loadBundles();
    const target = all.find((b) => b.id === id);
    if (!target) return res.status(404).json({ error: { code: "BUNDLE_NOT_FOUND", message: "묶음을 찾을 수 없습니다." } });
    if (!bundleVisibleTo(target, req.authUser)) {
      return res.status(403).json({ error: { code: "BUNDLE_FORBIDDEN", message: "권한이 없습니다." } });
    }
    target.name = name;
    await saveBundles(all);
    res.json({ bundle: target });
  } catch (err) {
    res.status(500).json({ error: { code: "BUNDLE_PATCH_FAIL", message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Saved prompt bundles — text-only counterpart to ref bundles. Mirrors the
// CRUD shape above so the UI can use the same modal pattern.
// Storage: lib/promptBundles.js (single JSON in IMA2_CONFIG_DIR).
// ─────────────────────────────────────────────────────────────────────────

// GET /api/prompt-bundles → { bundles: [...] }
app.get("/api/prompt-bundles", async (req, res) => {
  try {
    const all = await loadPromptBundles();
    const visible = all
      .filter((b) => promptBundleVisibleTo(b, req.authUser))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    res.json({ bundles: visible });
  } catch (err) {
    res.status(500).json({ error: { code: "BUNDLE_READ_FAIL", message: err.message } });
  }
});

// POST /api/prompt-bundles { name, prompt, tags? } → { bundle }
app.post("/api/prompt-bundles", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const bundle = makePromptBundle({
      name: req.body?.name,
      prompt: req.body?.prompt,
      tags: req.body?.tags,
      owner: req.authUser,
    });
    const all = await loadPromptBundles();
    all.push(bundle);
    await savePromptBundles(all);
    res.json({ bundle });
  } catch (err) {
    if (err instanceof PromptBundleValidationError) {
      return res.status(400).json({ error: { code: err.code, message: err.message } });
    }
    console.error("[prompt-bundles] save failed:", err);
    res.status(500).json({ error: { code: "BUNDLE_SAVE_FAIL", message: err.message } });
  }
});

// DELETE /api/prompt-bundles/:id → { ok: true }
app.delete("/api/prompt-bundles/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const all = await loadPromptBundles();
    const target = all.find((b) => b.id === id);
    if (!target) return res.status(404).json({ error: { code: "BUNDLE_NOT_FOUND", message: "묶음을 찾을 수 없습니다." } });
    if (!promptBundleVisibleTo(target, req.authUser)) {
      return res.status(403).json({ error: { code: "BUNDLE_FORBIDDEN", message: "권한이 없습니다." } });
    }
    const next = all.filter((b) => b.id !== id);
    await savePromptBundles(next);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { code: "BUNDLE_DELETE_FAIL", message: err.message } });
  }
});

// PATCH /api/prompt-bundles/:id { name?, prompt?, tags? } → { bundle }
app.patch("/api/prompt-bundles/:id", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const all = await loadPromptBundles();
    const target = all.find((b) => b.id === id);
    if (!target) return res.status(404).json({ error: { code: "BUNDLE_NOT_FOUND", message: "묶음을 찾을 수 없습니다." } });
    if (!promptBundleVisibleTo(target, req.authUser)) {
      return res.status(403).json({ error: { code: "BUNDLE_FORBIDDEN", message: "권한이 없습니다." } });
    }
    applyPromptBundlePatch(target, {
      name: req.body?.name,
      prompt: req.body?.prompt,
      tags: req.body?.tags,
    });
    await savePromptBundles(all);
    res.json({ bundle: target });
  } catch (err) {
    if (err instanceof PromptBundleValidationError) {
      return res.status(400).json({ error: { code: err.code, message: err.message } });
    }
    res.status(500).json({ error: { code: "BUNDLE_PATCH_FAIL", message: err.message } });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Self-hosted login. Endpoints are unauthenticated by design — they sit on
// the public allow-list in authMiddleware so the LoginPage can call them
// before there's a session.
// ─────────────────────────────────────────────────────────────────────────

// POST /api/auth/login { username, password } → { user } + Set-Cookie
app.post("/api/auth/login", express.json({ limit: "16kb" }), (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const result = authLogin(username, password);
    res.append("Set-Cookie", buildSessionCookie(result.sessionId, result.expiresAt));
    res.json({ user: result.user, expiresAt: result.expiresAt });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error("[auth] login failed:", err);
    res.status(500).json({ error: { code: "LOGIN_FAILED", message: err.message } });
  }
});

// POST /api/auth/logout — drops the row and clears the cookie.
app.post("/api/auth/logout", (req, res) => {
  const sid = req.cookies?.ima2_session;
  if (sid) authLogout(sid);
  res.append("Set-Cookie", buildClearSessionCookie());
  res.json({ ok: true });
});

// GET /api/auth/me — { user } if logged in, { user: null } otherwise.
// Public so the LoginPage can probe whether to skip itself on mount.
app.get("/api/auth/me", (req, res) => {
  if (req.session?.user) {
    return res.json({
      user: req.session.user,
      expiresAt: req.session.expiresAt,
      authEnabled: isAuthEnabled(),
    });
  }
  res.json({ user: null, authEnabled: isAuthEnabled() });
});

// GET /api/auth/codex-router-gate — internal gate for nginx auth_request so
// /codex-router/ inherits the main session login. Only ree9622's logged-in
// session passes (204); everyone else gets 401 and nginx redirects to /.
app.get("/api/auth/codex-router-gate", (req, res) => {
  // req.authUser is the resolved username string (authMiddleware sets it
  // from the session). req.session.user would be the full user object, not
  // a string — comparing it to "ree9622" silently fails.
  if (req.authUser === "ree9622") return res.status(204).end();
  res.status(401).end();
});

// -- Provider info --
app.get("/api/providers", (_req, res) => {
  res.json({
    apiKey: false,
    oauth: true,
    oauthPort: OAUTH_PORT,
    apiKeyDisabled: true,
  });
});

// -- Health (for ima2 CLI: ping, discovery verification) --
const __pkg = (() => {
  try {
    return JSON.parse(fsReadFileSync(join(__dirname, "package.json"), "utf-8"));
  } catch {
    return { version: "0.0.0" };
  }
})();
const __startedAt = Date.now();

app.get("/api/health", async (req, res) => {
  const deep = req.query.deep === "1" || req.query.deep === "true";
  const base = {
    ok: true,
    version: __pkg.version,
    provider: "oauth",
    uptimeSec: Math.round(process.uptime()),
    activeJobs: listJobs().length,
    pid: process.pid,
    startedAt: __startedAt,
    oauth: {
      ready: OAUTH_READY,
      port: OAUTH_PORT,
      portRequested: OAUTH_PORT_REQUESTED,
      portDrifted: OAUTH_PORT !== OAUTH_PORT_REQUESTED,
      lastError: OAUTH_LAST_ERROR,
    },
  };
  if (!deep) return res.json(base);
  // Deep check: actually hit the OAuth proxy /v1/models so we detect hung
  // child processes (OAUTH_READY=true but proxy wedged) that the stdout
  // banner can't surface.
  try {
    const t0 = Date.now();
    const r = await fetch(`${OAUTH_URL}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    const elapsedMs = Date.now() - t0;
    res.json({
      ...base,
      oauth: {
        ...base.oauth,
        probe: { ok: r.ok, status: r.status, elapsedMs, url: `${OAUTH_URL}/v1/models` },
      },
    });
  } catch (e) {
    res.status(503).json({
      ...base,
      ok: false,
      oauth: {
        ...base.oauth,
        probe: {
          ok: false,
          error: e?.message || String(e),
          url: `${OAUTH_URL}/v1/models`,
        },
      },
    });
  }
});

// -- History (disk-backed authoritative source for UI history list) --
// Recursively list image files up to 2 levels deep (for 0.04 session/node subdirs)
// Skip helper directories that aren't generation outputs:
//   .trash    soft-deleted images
//   .failed   failure sidecars
//   .refs     reference-image content archive (hashed blobs)
// These leaked into /api/history and rendered as "프롬프트 없음" placeholders.
const SKIP_DIRS = new Set([".trash", ".failed", ".refs", ".thumbs"]);

async function listImages(baseDir) {
  const out = [];
  async function walk(dir, depth) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory() && depth > 0) {
        await walk(full, depth - 1);
      } else if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) {
        out.push({ full, rel: full.slice(baseDir.length + 1), name: e.name });
      }
    }
  }
  await walk(baseDir, 2);
  return out;
}

// Short-TTL cache for /api/history rows. New / deleted images change the
// generated/ dir mtime so the cache invalidates automatically; favorite
// toggles only mutate sidecar contents, so they wait out the TTL (≤5 s,
// invisible in practice). Without this every history poll did N sidecar
// readFile + JSON.parse — fine at 100 images, slow past 1 000.
const HISTORY_CACHE_TTL_MS = 5000;
let __historyRowsCache = null; // { rowsAll, generatedAt, dirMtimeMs }

function invalidateHistoryCache() {
  __historyRowsCache = null;
}

async function loadHistoryRows(baseDir) {
  const now = Date.now();
  let dirMtimeMs = 0;
  try {
    const st = await stat(baseDir);
    dirMtimeMs = st.mtimeMs;
  } catch {}
  if (
    __historyRowsCache &&
    now - __historyRowsCache.generatedAt < HISTORY_CACHE_TTL_MS &&
    __historyRowsCache.dirMtimeMs === dirMtimeMs
  ) {
    return __historyRowsCache.rowsAll;
  }
  const imgs = await listImages(baseDir);
  const rowsAll = await Promise.all(
    imgs.map(async ({ full, rel, name }) => {
      const st = await stat(full).catch(() => null);
      let meta = null;
      try {
        const raw = await readFile(full + ".json", "utf-8");
        meta = JSON.parse(raw);
      } catch (e) {
        if (e.code !== "ENOENT") console.warn("[history] sidecar parse fail:", rel, e.message);
      }
      return {
        _meta: meta,
        filename: rel,
        url: `/generated/${rel.split("/").map(encodeURIComponent).join("/")}`,
        thumb: variantUrls(rel).thumb,
        web: variantUrls(rel).web,
        createdAt: meta?.createdAt || st?.mtimeMs || 0,
        prompt: meta?.prompt || null,
        originalPrompt: typeof meta?.originalPrompt === "string" ? meta.originalPrompt : null,
        quality: meta?.quality || null,
        size: meta?.size || null,
        format: meta?.format || name.split(".").pop(),
        moderation: meta?.moderation || null,
        provider: meta?.provider || "oauth",
        codexAccount: typeof meta?.codexAccount === "string" ? meta.codexAccount : null,
        usage: meta?.usage || null,
        webSearchCalls: meta?.webSearchCalls || 0,
        sessionId: meta?.sessionId || null,
        nodeId: meta?.nodeId || null,
        parentNodeId: meta?.parentNodeId || null,
        clientNodeId: meta?.clientNodeId || null,
        kind: meta?.kind || null,
        favorite: meta?.favorite === true,
        maxAttempts: typeof meta?.maxAttempts === "number" ? meta.maxAttempts : null,
        attempts: Array.isArray(meta?.attempts) ? meta.attempts : [],
        referenceCount: typeof meta?.referenceCount === "number" ? meta.referenceCount : 0,
        references: Array.isArray(meta?.references) ? meta.references : [],
        requestId: typeof meta?.requestId === "string" ? meta.requestId : null,
        outfitModule: meta?.outfitModule || null,
      };
    }),
  );
  __historyRowsCache = { rowsAll, generatedAt: now, dirMtimeMs };
  return rowsAll;
}

app.get("/api/history", async (req, res) => {
  try {
    const dir = join(__dirname, "generated");
    await mkdir(dir, { recursive: true });
    const limitRaw = parseInt(req.query.limit);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 3000);
    const beforeTs = parseInt(req.query.before);
    const beforeFn = typeof req.query.beforeFilename === "string" ? req.query.beforeFilename : null;
    const sinceTs = parseInt(req.query.since);
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : null;
    const groupBy = req.query.groupBy === "session" ? "session" : null;

    const rowsAll = await loadHistoryRows(dir);
    const rows = rowsAll.filter((r) => canAccess(r._meta, req.authUser)).map(({ _meta, ...rest }) => rest);

    // composite sort: createdAt DESC, filename DESC (stable tiebreaker)
    rows.sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      return b.filename < a.filename ? -1 : b.filename > a.filename ? 1 : 0;
    });

    let filtered = rows;
    if (Number.isFinite(sinceTs)) {
      filtered = filtered.filter((r) => r.createdAt > sinceTs);
    }
    if (Number.isFinite(beforeTs)) {
      filtered = filtered.filter((r) => {
        if (r.createdAt < beforeTs) return true;
        if (r.createdAt === beforeTs && beforeFn) return r.filename < beforeFn;
        return false;
      });
    }
    if (sessionId) {
      filtered = filtered.filter((r) => r.sessionId === sessionId);
    }

    const page = filtered.slice(0, limit);
    const nextCursor = page.length === limit && filtered.length > limit
      ? { before: page[page.length - 1].createdAt, beforeFilename: page[page.length - 1].filename }
      : null;

    if (groupBy === "session") {
      // Group by sessionId while preserving createdAt DESC order overall.
      const groups = new Map(); // sessionId|null -> { sessionId, items, lastUsedAt }
      const loose = [];
      for (const r of page) {
        if (r.sessionId) {
          let g = groups.get(r.sessionId);
          if (!g) {
            g = { sessionId: r.sessionId, items: [], lastUsedAt: r.createdAt };
            groups.set(r.sessionId, g);
          }
          g.items.push(r);
          if (r.createdAt > g.lastUsedAt) g.lastUsedAt = r.createdAt;
        } else {
          loose.push(r);
        }
      }
      const sessions = Array.from(groups.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
      return res.json({ sessions, loose, total: rows.length, nextCursor });
    }

    res.json({ items: page, total: rows.length, nextCursor });
  } catch (err) {
    console.error("[history] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- Asset lifecycle: soft-delete to .trash/, auto-purge after TTL --
async function readSidecarSafe(filename) {
  try {
    const target = join(GENERATED_DIR, filename);
    if (target !== GENERATED_DIR && !target.startsWith(GENERATED_DIR + "/")) return null;
    return JSON.parse(await readFile(target + ".json", "utf-8"));
  } catch {
    return null;
  }
}

async function assertHistoryAccess(req, res, filename) {
  if (!req.authUser) return true;
  const meta = await readSidecarSafe(filename);
  if (canAccess(meta, req.authUser)) return true;
  res.status(404).json({ error: "not found", code: "NOT_FOUND" });
  return false;
}

app.delete("/api/history/:filename", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    if (!(await assertHistoryAccess(req, res, filename))) return;
    const result = await trashAsset(__dirname, filename);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

app.post("/api/history/:filename/restore", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const trashId = typeof req.body?.trashId === "string" ? req.body.trashId : null;
    if (!trashId) return res.status(400).json({ error: "trashId required" });
    // Only owners can restore. The sidecar moved with the trashed asset, so check trash sidecar.
    if (req.authUser) {
      try {
        const trashSidecar = JSON.parse(await readFile(join(GENERATED_DIR, ".trash", trashId + ".json"), "utf-8"));
        if (!canAccess(trashSidecar, req.authUser)) {
          return res.status(404).json({ error: "not found" });
        }
      } catch {
        return res.status(404).json({ error: "not found" });
      }
    }
    const result = await restoreAsset(__dirname, trashId, filename);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/history/:filename/favorite", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    if (!(await assertHistoryAccess(req, res, filename))) return;
    const value = Boolean(req.body?.value);
    const result = await setFavoriteFlag(GENERATED_DIR, filename, value);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// -- Generation log (success + failure attempts) --
async function listFailedSidecars(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, e.name), "utf-8");
      const meta = JSON.parse(raw);
      out.push({ ...meta, _file: e.name });
    } catch (err) {
      console.warn("[log] bad failed sidecar:", e.name, err.message);
    }
  }
  return out;
}

app.get("/api/generation-log", async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100, 3000);
    const statusFilter =
      req.query.status === "failed" || req.query.status === "success"
        ? req.query.status
        : null;

    const items = [];

    if (statusFilter !== "failed") {
      const genDir = join(__dirname, "generated");
      await mkdir(genDir, { recursive: true });
      const imgs = await listImages(genDir);
      for (const { full, rel, name } of imgs) {
        const st = await stat(full).catch(() => null);
        let meta = null;
        try {
          meta = JSON.parse(await readFile(full + ".json", "utf-8"));
        } catch (e) {
          if (e.code !== "ENOENT") continue;
        }
        if (!canAccess(meta, req.authUser)) continue;
        items.push({
          id: rel,
          status: "success",
          createdAt: meta?.createdAt || st?.mtimeMs || 0,
          endpoint: meta?.kind === "edit" ? "edit" : meta?.nodeId ? "node" : "generate",
          prompt: meta?.prompt || null,
          originalPrompt: typeof meta?.originalPrompt === "string" ? meta.originalPrompt : null,
          quality: meta?.quality || null,
          size: meta?.size || null,
          format: meta?.format || name.split(".").pop(),
          moderation: meta?.moderation || null,
          maxAttempts: typeof meta?.maxAttempts === "number" ? meta.maxAttempts : null,
          attempts: Array.isArray(meta?.attempts) ? meta.attempts : [],
          referenceCount: typeof meta?.referenceCount === "number" ? meta.referenceCount : 0,
          references: Array.isArray(meta?.references) ? meta.references : [],
          filename: rel,
          url: `/generated/${rel.split("/").map(encodeURIComponent).join("/")}`,
          sessionId: meta?.sessionId || null,
          requestId: typeof meta?.requestId === "string" ? meta.requestId : null,
          errorCode: null,
          errorMessage: null,
          outfitModule: meta?.outfitModule || null,
        });
      }
    }

    if (statusFilter !== "success") {
      const failedDir = join(__dirname, "generated", ".failed");
      await mkdir(failedDir, { recursive: true });
      const failed = await listFailedSidecars(failedDir);
      for (const m of failed) {
        if (!canAccess(m, req.authUser)) continue;
        items.push({
          id: `failed/${m.id || (m._file || "").replace(/\.json$/, "")}`,
          status: "failed",
          createdAt: m.createdAt || 0,
          endpoint: m.endpoint || "generate",
          prompt: m.prompt || null,
          quality: m.quality || null,
          size: m.size || null,
          format: m.format || null,
          moderation: m.moderation || null,
          maxAttempts: Array.isArray(m.attempts) ? m.attempts.length : null,
          attempts: Array.isArray(m.attempts) ? m.attempts : [],
          referenceCount: typeof m.referenceCount === "number" ? m.referenceCount : 0,
          filename: null,
          url: null,
          sessionId: m.sessionId || null,
          requestId: typeof m.requestId === "string" ? m.requestId : null,
          errorCode: m.errorCode || null,
          errorMessage: m.errorMessage || null,
          outfitModule: m.outfitModule || null,
        });
      }
    }

    items.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ items: items.slice(0, limit), total: items.length });
  } catch (err) {
    console.error("[generation-log] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/generation-log/failed/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").replace(/[^\w.-]/g, "");
    if (!id) return res.status(400).json({ error: "invalid id" });
    const path = join(__dirname, "generated", ".failed", `${id}.json`);
    if (!existsSync(path)) return res.status(404).json({ error: "not found" });
    if (req.authUser) {
      try {
        const meta = JSON.parse(await readFile(path, "utf-8"));
        if (!canAccess(meta, req.authUser)) return res.status(404).json({ error: "not found" });
      } catch {
        return res.status(404).json({ error: "not found" });
      }
    }
    unlinkSync(path);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Storage stats + prune --
// Local dev tool: caller is the machine owner. No auth layer, but input
// numeric fields are clamped defensively so a stray large number can't
// wedge the walker or delete something unexpected.
function clampPositiveNumber(v, fallback, { max = Number.MAX_SAFE_INTEGER, min = 0 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

app.get("/api/storage/stats", async (_req, res) => {
  try {
    const stats = await getStorageStats(__dirname);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/storage/prune", async (req, res) => {
  try {
    const body = req.body || {};
    const opts = {
      trashTtlDays:
        body.trashTtlDays == null ? 7 : clampPositiveNumber(body.trashTtlDays, 7, { max: 3650 }),
      failedTtlDays:
        body.failedTtlDays == null ? 14 : clampPositiveNumber(body.failedTtlDays, 14, { max: 3650 }),
      genTtlDays:
        body.genTtlDays == null ? null : clampPositiveNumber(body.genTtlDays, null, { max: 3650 }),
      genMaxMb:
        body.genMaxMb == null ? null : clampPositiveNumber(body.genMaxMb, null, { max: 10 * 1024 * 1024 }),
      keepFavorites: body.keepFavorites !== false,
      dryRun: body.dryRun === true,
    };

    const result = await pruneStorage(__dirname, opts);

    if (!opts.dryRun && result.generated.deletedFilenames.length > 0) {
      let sessionsTouched = 0;
      let nodesTouched = 0;
      for (const fn of result.generated.deletedFilenames) {
        try {
          const summary = markNodesAssetMissing(fn);
          sessionsTouched += summary.sessionsTouched;
          nodesTouched += summary.nodesTouched;
        } catch (e) {
          console.warn("[prune] markNodesAssetMissing failed:", fn, e.message);
        }
      }
      result.generated.sessionsTouched = sessionsTouched;
      result.generated.nodesTouched = nodesTouched;
    }

    res.json(result);
  } catch (err) {
    console.error("[prune] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- OAuth status --
app.get("/api/oauth/status", async (_req, res) => {
  try {
    const r = await fetch(`${OAUTH_URL}/v1/models`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json();
      res.json({ status: "ready", models: data.data?.map((m) => m.id) || [] });
    } else {
      res.json({ status: "auth_required" });
    }
  } catch {
    res.json({ status: "offline" });
  }
});

// -- Inflight registry --
app.get("/api/inflight", (req, res) => {
  const kind =
    typeof req.query.kind === "string" && req.query.kind.length > 0
      ? req.query.kind
      : undefined;
  const sessionId =
    typeof req.query.sessionId === "string" && req.query.sessionId.length > 0
      ? req.query.sessionId
      : undefined;
  res.json({ jobs: listJobs({ kind, sessionId, owner: req.authUser }) });
});

app.delete("/api/inflight/:requestId", (req, res) => {
  if (req.authUser) {
    const job = getJob(req.params.requestId);
    if (job && job.owner !== req.authUser) return res.status(404).end();
  }
  finishJob(req.params.requestId, { canceled: true });
  res.status(204).end();
});

// -- Batch tracking --
//
// GET /api/batch
//   Recent batches (most recent first), default limit 50, max 200. Pure
//   meta listing — no per-entry detail. Use for the "최근 batch" UI panel.
//
// GET /api/batch/:id
//   Single batch's meta + every per-prompt entry (success or failure)
//   that the batch produced, sorted by batchIndex. Includes a top-level
//   summary block (succeeded/failed/totalAttempts/totalUsage/reasons)
//   computed at read time. The 31-prompt 텍스트 일괄 fanout: GET this once
//   the run completes and you see the whole picture in one JSON, instead
//   of grepping 31 sidecars. Owner-scoped when auth is enabled.
app.get("/api/batch", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(200, Math.floor(rawLimit))
      : 50;
    const batches = await listBatches({
      generatedDir: join(__dirname, "generated"),
      limit,
    });
    const filtered = req.authUser
      ? batches.filter((b) => !b.owner || b.owner === req.authUser)
      : batches;
    res.json({ batches: filtered });
  } catch (err) {
    console.warn(`[batch] list failed: ${err?.message || err}`);
    res.status(500).json({ error: err?.message || String(err), batches: [] });
  }
});

// POST /api/batch/:id/close
//   Called by the client when a fanout (e.g. 텍스트 일괄) finishes — including
//   when it bailed early on stop conditions. Stamps _meta.completedAt and
//   _meta.summary so subsequent reads don't have to re-aggregate, and
//   emits the [batch.summary] log line for /var/log/ima2-gen.log so any
//   31-prompt run leaves exactly one greppable summary entry. Idempotent
//   — re-calling overwrites with the freshest snapshot of entries.
app.post("/api/batch/:id/close", async (req, res) => {
  const id = req.params.id;
  if (!isValidBatchId(id)) {
    return res.status(400).json({ error: "Invalid batchId" });
  }
  try {
    const stopReason = typeof req.body?.stopReason === "string"
      ? req.body.stopReason.slice(0, 200)
      : null;
    const closed = await closeBatch({
      generatedDir: join(__dirname, "generated"),
      batchId: id,
    });
    if (!closed) return res.status(404).json({ error: "batch not found" });
    if (req.authUser && closed.meta?.owner && closed.meta.owner !== req.authUser) {
      return res.status(404).json({ error: "batch not found" });
    }
    const { summary, meta } = closed;
    // One-line audit trail per batch. Sanitized via logger.js — promptPreview
    // / errorMessage on individual entries stay in the per-entry JSON, never
    // here. reasons is a small dict of { errorCode: count } so the most
    // common failure mode is one grep away.
    logEvent("batch", "summary", {
      batchId: id,
      total: summary.total,
      succeeded: summary.succeeded,
      failed: summary.failed,
      totalAttempts: summary.totalAttempts,
      reasons: JSON.stringify(summary.reasons),
      promptTokens: summary.totalUsage?.input_tokens ?? null,
      reasoningTokens: summary.totalUsage?.output_tokens ?? null,
      durationMs:
        meta?.completedAt && meta?.startedAt ? meta.completedAt - meta.startedAt : null,
      source: meta?.source || null,
      stopReason: stopReason || null,
    });
    res.json({ meta, summary });
  } catch (err) {
    console.warn(`[batch] close ${id} failed: ${err?.message || err}`);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/batch/:id", async (req, res) => {
  const id = req.params.id;
  if (!isValidBatchId(id)) {
    return res.status(400).json({ error: "Invalid batchId" });
  }
  try {
    const result = await readBatch({
      generatedDir: join(__dirname, "generated"),
      batchId: id,
    });
    if (!result) return res.status(404).json({ error: "batch not found" });
    if (req.authUser && result.meta?.owner && result.meta.owner !== req.authUser) {
      return res.status(404).json({ error: "batch not found" });
    }
    const summary = summarizeBatch(result.entries);
    res.json({
      meta: result.meta,
      summary,
      entries: result.entries,
    });
  } catch (err) {
    console.warn(`[batch] read ${id} failed: ${err?.message || err}`);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// -- Generate image (supports parallel via n) --
app.post("/api/generate", async (req, res) => {
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : null;
  try {
    const sessionId =
      typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    const clientNodeId =
      typeof req.body?.clientNodeId === "string" ? req.body.clientNodeId : null;
    const { prompt: rawPrompt, quality: rawQuality = "low", size: rawSize = "1024x1024", format: rawFormat = "png", moderation: rawModeration = "auto", provider = "auto", n = 1, references = [], referenceMeta: rawReferenceMeta = [], maxAttempts: rawMaxAttempts, originalPrompt: rawOriginalPrompt, outfitModule: rawOutfitModule, batchId: rawBatchId, batchIndex: rawBatchIndex, batchTotal: rawBatchTotal, batchSource: rawBatchSource } =
      req.body;
    const batchId = isValidBatchId(rawBatchId) ? rawBatchId : null;
    const batchIndex = batchId && Number.isFinite(rawBatchIndex)
      ? Math.max(0, Math.floor(rawBatchIndex))
      : null;
    const batchTotal = batchId && Number.isFinite(rawBatchTotal)
      ? Math.max(1, Math.floor(rawBatchTotal))
      : null;
    const batchSource = batchId && typeof rawBatchSource === "string"
      ? rawBatchSource.slice(0, 40)
      : null;
    const outfitModule = rawOutfitModule && typeof rawOutfitModule === "object"
      && typeof rawOutfitModule.id === "string"
      ? {
          id: String(rawOutfitModule.id).slice(0, 80),
          label: typeof rawOutfitModule.label === "string" ? rawOutfitModule.label.slice(0, 80) : null,
          category: typeof rawOutfitModule.category === "string" ? rawOutfitModule.category.slice(0, 40) : null,
          risk: ["low", "medium", "high"].includes(rawOutfitModule.risk) ? rawOutfitModule.risk : null,
        }
      : null;
    const maxAttempts = clampMaxAttempts(rawMaxAttempts, 2);
    const originalPrompt =
      typeof rawOriginalPrompt === "string" && rawOriginalPrompt.trim().length > 0
        ? rawOriginalPrompt.trim().slice(0, 4000)
        : null;

    const pCheck = validatePrompt(rawPrompt);
    if (!pCheck.ok) return send400(res, pCheck);
    const qCheck = validateQuality(rawQuality);
    if (!qCheck.ok) return send400(res, qCheck);
    const sCheck = validateSize(rawSize);
    if (!sCheck.ok) return send400(res, sCheck);
    const fCheck = validateFormat(rawFormat);
    if (!fCheck.ok) return send400(res, fCheck);
    const mCheck = validateModeration(rawModeration);
    if (!mCheck.ok) return send400(res, mCheck);
    const nCheck = validateCount(n, { max: 8 });
    if (!nCheck.ok) return send400(res, nCheck);

    const prompt = pCheck.value;
    const quality = qCheck.value;
    const size = sCheck.value;
    const format = fCheck.value;
    const moderation = mCheck.value;
    const count = nCheck.value;
    startJob({
      requestId,
      kind: "classic",
      prompt,
      maxAttempts,
      owner: req.authUser || LEGACY_OWNER,
      meta: {
        kind: "classic",
        sessionId,
        parentNodeId: null,
        clientNodeId,
        quality,
        size,
        n: count,
      },
    });

    const refCheck = validateAndNormalizeRefs(references);
    if (refCheck.error) return res.status(400).json({ error: { code: refCheck.code, message: refCheck.error } });
    const refB64s = refCheck.refs;

    if (provider === "api") {
      return res.status(403).json({ error: { code: "APIKEY_DISABLED", message: "API key provider is disabled. Use OAuth (Codex login)." } });
    }
    const useOAuth = true;
    const __client = req.get("x-ima2-client") || "ui";
    const __batchTag = batchId ? ` batch=${batchId}#${batchIndex}/${batchTotal}` : "";
    console.log(`[generate][${__client}] provider=oauth quality=${quality} size=${size} moderation=${moderation} n=${count} refs=${refB64s.length}${__batchTag}`);
    const startTime = Date.now();
    if (batchId) {
      // Best-effort — meta write race between sibling calls is harmless,
      // see batchLog.ensureBatchMeta.
      ensureBatchMeta({
        generatedDir: join(__dirname, "generated"),
        batchId,
        batchTotal,
        startedAt: startTime,
        owner: req.authUser || LEGACY_OWNER,
        source: batchSource,
      }).catch((err) => {
        console.warn(`[batch] ensureBatchMeta failed: ${err?.message || err}`);
      });
    }

    const mimeMap = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    const mime = mimeMap[format] || "image/png";
    await mkdir(join(__dirname, "generated"), { recursive: true });

    // Resolve reference lineage once per request — every generated image in
    // this batch shares the same parents. Persists never-before-seen uploads
    // to generated/.refs/<hash>.<ext> for later Lightbox display.
    let refLineage = [];
    if (refB64s.length > 0) {
      try {
        refLineage = await resolveRefLineage(refB64s, {
          generatedDir: join(__dirname, "generated"),
          hint: Array.isArray(rawReferenceMeta) ? rawReferenceMeta : [],
        });
      } catch (err) {
        console.warn("[generate] refLineage failed:", err?.message || err);
        refLineage = [];
      }
    }

    const generateOne = () =>
      runPromptAttempts(
        prompt,
        (attemptPrompt) =>
          generateViaOAuth(attemptPrompt, quality, size, moderation, refB64s, requestId),
        "generate",
        maxAttempts,
        requestId ? (i, _n) => setJobAttempt(requestId, i) : null,
        { requestId, hasRefs: refB64s.length > 0 },
      );

    const results = await Promise.allSettled(Array.from({ length: count }, generateOne));

    const images = [];
    let totalUsage = null;
    let totalWebSearchCalls = 0;
    let promptRewrittenForSafety = false;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.b64) {
        if (r.value.promptRewrittenForSafety === true) promptRewrittenForSafety = true;
        const rand = randomBytes(4).toString("hex");
        const filename = `${Date.now()}_${rand}_${images.length}.${format}`;
        const imageBuf = stampImageMetaIfPng(Buffer.from(r.value.b64, "base64"), format, {
          prompt,
          revisedPrompt: r.value.revisedPrompt,
          size,
          quality,
          moderation,
          originalPrompt,
          outfitModule,
          batchId,
          batchIndex,
          referenceCount: refB64s.length,
          maxAttempts,
        });
        await writeFile(join(__dirname, "generated", filename), imageBuf);
        // Sidecar metadata for /api/history reconstruction
        const meta = {
          prompt,
          promptUsed: r.value.promptUsed || prompt,
          promptRewrittenForSafety: r.value.promptRewrittenForSafety === true,
          ...(originalPrompt ? { originalPrompt } : {}),
          quality,
          size,
          format,
          moderation,
          provider: "oauth",
          codexAccount: r.value.codexAccount || null,
          createdAt: Date.now(),
          usage: r.value.usage || null,
          webSearchCalls: r.value.webSearchCalls || 0,
          maxAttempts,
          attempts: Array.isArray(r.value.attempts) ? r.value.attempts : [],
          attemptsTotalUsage: sumAttemptsUsage(r.value.attempts),
          referenceCount: refB64s.length,
          references: refLineage,
          sessionId,
          owner: req.authUser || LEGACY_OWNER,
          requestId,
          ...(outfitModule ? { outfitModule } : {}),
          ...(batchId ? { batchId, batchIndex } : {}),
        };
        await writeFile(join(__dirname, "generated", filename + ".json"), JSON.stringify(meta)).catch(() => {});
        images.push({
          image: `data:${mime};base64,${r.value.b64}`,
          filename,
          references: refLineage,
        });
        if (r.value.usage) {
          if (!totalUsage) totalUsage = { ...r.value.usage };
          else Object.keys(r.value.usage).forEach(k => { if (typeof r.value.usage[k] === "number") totalUsage[k] = (totalUsage[k] || 0) + r.value.usage[k]; });
        }
        if (typeof r.value.webSearchCalls === "number") totalWebSearchCalls += r.value.webSearchCalls;
      } else if (r.status === "rejected") {
        console.error("[generate] one of parallel jobs failed:", r.reason?.message);
      }
    }

    if (images.length === 0) {
      const firstErr = results.find(r => r.status === "rejected")?.reason;
      const failedSidecarId = await writeFailureSidecar({
        endpoint: "generate",
        prompt,
        originalPrompt,
        quality,
        size,
        format,
        moderation,
        attempts: firstErr?.attempts || [],
        error: firstErr,
        sessionId,
        clientNodeId,
        referenceCount: refB64s.length,
        owner: req.authUser,
        requestId,
        outfitModule,
        batchId,
        batchIndex,
      });
      if (batchId) {
        await appendBatchEntry({
          generatedDir: join(__dirname, "generated"),
          batchId,
          batchIndex,
          entry: {
            ok: false,
            requestId,
            promptChars: prompt.length,
            promptPreview: prompt.slice(0, 120),
            errorCode: firstErr?.code || "UNKNOWN",
            errorMessage: (firstErr?.message || String(firstErr || "")).slice(0, 240),
            attemptsCount: Array.isArray(firstErr?.attempts) ? firstErr.attempts.length : 0,
            usage: sumAttemptsUsage(firstErr?.attempts),
            failedSidecarId,
            durationMs: Date.now() - startTime,
          },
        }).catch((e) => console.warn(`[batch] appendBatchEntry failed: ${e?.message || e}`));
      }
      if (firstErr?.code === "SAFETY_REFUSAL") {
        return res.status(422).json({ error: firstErr.message, code: "SAFETY_REFUSAL", attempts: firstErr.attempts || [], batchId });
      }
      // upstream 45b7892 흡수: 빈 응답을 SAFETY_REFUSAL 로 잘못 라벨하지 않도록 분기.
      if (firstErr?.code === "EMPTY_RESPONSE" || firstErr?.code === "UPSTREAM_EMPTY") {
        return res.status(422).json({
          error: firstErr.message,
          code: "EMPTY_RESPONSE",
          attempts: firstErr.attempts || [],
          batchId,
          ...(firstErr.diagnosticReason ? { diagnosticReason: firstErr.diagnosticReason } : {}),
        });
      }
      if (firstErr?.code === "USAGE_LIMIT" || firstErr?.status === 429) {
        return res.status(429).json({
          error: firstErr.message || "OpenAI usage limit reached",
          code: "USAGE_LIMIT",
          attempts: firstErr.attempts || [],
          batchId,
        });
      }
      if (firstErr?.code === "AUTH_INVALIDATED" || firstErr?.status === 401) {
        return res.status(401).json({
          error: firstErr.message || "OAuth token invalidated — re-authentication required",
          code: "AUTH_INVALIDATED",
          attempts: firstErr.attempts || [],
          batchId,
        });
      }
      return res.status(500).json({ error: "All generation attempts failed", code: firstErr?.code || "ALL_ATTEMPTS_FAILED", attempts: firstErr?.attempts || [], batchId });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const extra = {
      usage: totalUsage,
      provider: "oauth",
      webSearchCalls: totalWebSearchCalls,
      quality,
      size,
      moderation,
      safetyRetryAvailable: hasCompliantRetry(prompt),
      promptRewrittenForSafety,
    };
    if (batchId) {
      const totalAttempts = results.reduce((sum, r) => {
        if (r.status === "fulfilled" && Array.isArray(r.value.attempts)) {
          return sum + r.value.attempts.length;
        }
        return sum;
      }, 0);
      await appendBatchEntry({
        generatedDir: join(__dirname, "generated"),
        batchId,
        batchIndex,
        entry: {
          ok: true,
          requestId,
          promptChars: prompt.length,
          promptPreview: prompt.slice(0, 120),
          imageCount: images.length,
          filenames: images.map((img) => img.filename),
          attemptsCount: totalAttempts,
          usage: totalUsage,
          webSearchCalls: totalWebSearchCalls,
          promptRewrittenForSafety,
          durationMs: Date.now() - startTime,
        },
      }).catch((e) => console.warn(`[batch] appendBatchEntry failed: ${e?.message || e}`));
    }

    if (count === 1) {
      res.json({ image: images[0].image, elapsed, filename: images[0].filename, requestId, batchId, ...extra });
    } else {
      res.json({ images, elapsed, count: images.length, requestId, batchId, ...extra });
    }
  } catch (err) {
    console.error("Generate error:", err.message);
    res.status(err.status || 500).json({ error: err.message, code: err.code, requestId });
  } finally {
    finishJob(requestId);
  }
});

// -- OAuth edit: send image as input to Responses API --
async function editViaOAuth(prompt, imageB64, quality, size, moderation = "auto") {
  // user role carries only the user's prompt (plus boostRefPrompt's face-lock
  // cue when short/variation). Wrapper text lives in EDIT_DEVELOPER_PROMPT.
  const { b64, usage } = await runResponses({
    url: OAUTH_URL,
    body: {
      model: "gpt-5.5",
      reasoning: { effort: "medium" },
      input: [
        { role: "developer", content: EDIT_DEVELOPER_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: `data:${detectImageMimeFromB64(imageB64) || "image/png"};base64,${imageB64}` },
            { type: "input_text", text: boostRefPrompt(prompt) },
          ],
        },
      ],
      // gpt-image-2 auto-applies high fidelity; do NOT pass input_fidelity.
      tools: [{ type: "image_generation", quality, size, moderation }],
      tool_choice: "required",
      stream: true,
    },
  });
  if (b64) {
    console.log("[oauth-edit] got image, b64 length:", b64.length);
    return { b64, usage };
  }
  throw new Error("No image data received from OAuth edit");
}

// -- Edit image (inpainting) --
app.post("/api/edit", async (req, res) => {
  const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : null;
  try {
    const { prompt: rawPrompt, image: imageB64, mask: maskB64, quality: rawQuality = "low", size: rawSize = "1024x1024", moderation: rawModeration = "auto", provider = "oauth", maxAttempts: rawMaxAttempts, originalPrompt: rawOriginalPrompt } =
      req.body;
    const maxAttempts = clampMaxAttempts(rawMaxAttempts, 2);
    const originalPrompt =
      typeof rawOriginalPrompt === "string" && rawOriginalPrompt.trim().length > 0
        ? rawOriginalPrompt.trim().slice(0, 4000)
        : null;

    if (!imageB64)
      return send400(res, { code: "MISSING_IMAGE", message: "image is required" });
    const pCheck = validatePrompt(rawPrompt);
    if (!pCheck.ok) return send400(res, pCheck);
    const qCheck = validateQuality(rawQuality);
    if (!qCheck.ok) return send400(res, qCheck);
    const sCheck = validateSize(rawSize);
    if (!sCheck.ok) return send400(res, sCheck);
    const mCheck = validateModeration(rawModeration);
    if (!mCheck.ok) return send400(res, mCheck);

    const prompt = pCheck.value;
    const quality = qCheck.value;
    const size = sCheck.value;
    const moderation = mCheck.value;

    if (provider === "api") {
      return res.status(403).json({ error: { code: "APIKEY_DISABLED", message: "API key provider is disabled. Use OAuth (Codex login)." } });
    }
    console.log(`[edit][${req.get("x-ima2-client") || "ui"}] provider=oauth quality=${quality} size=${size} moderation=${moderation}`);
    const startTime = Date.now();

    let editResult;
    try {
      editResult = await runPromptAttempts(
        prompt,
        (attemptPrompt) => editViaOAuth(attemptPrompt, imageB64, quality, size, moderation),
        "edit",
        maxAttempts,
        null,
        { requestId, hasRefs: true },
      );
    } catch (e) {
      await writeFailureSidecar({
        endpoint: "edit",
        prompt,
        originalPrompt,
        quality,
        size,
        format: "png",
        moderation,
        attempts: e.attempts || [],
        error: e,
        referenceCount: 0,
        owner: req.authUser,
        requestId,
      });
      throw e;
    }
    const {
      b64: resultB64,
      usage,
      promptUsed,
      promptRewrittenForSafety,
      attempts: editAttempts,
    } = editResult;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    await mkdir(join(__dirname, "generated"), { recursive: true });
    const filename = `${Date.now()}_${randomBytes(4).toString("hex")}.png`;
    const editImageBuf = stampImageMetaIfPng(Buffer.from(resultB64, "base64"), "png", {
      prompt,
      size,
      quality,
      moderation: typeof moderation === "string" ? moderation : undefined,
    });
    await writeFile(join(__dirname, "generated", filename), editImageBuf);
    const meta = {
      prompt,
      promptUsed: promptUsed || prompt,
      promptRewrittenForSafety: promptRewrittenForSafety === true,
      ...(originalPrompt ? { originalPrompt } : {}),
      quality,
      size,
      moderation,
      format: "png",
      provider: "oauth",
      kind: "edit",
      createdAt: Date.now(),
      usage: usage || null,
      webSearchCalls: 0,
      maxAttempts,
      attempts: Array.isArray(editAttempts) ? editAttempts : [],
      owner: req.authUser || LEGACY_OWNER,
      requestId,
    };
    await writeFile(join(__dirname, "generated", filename + ".json"), JSON.stringify(meta)).catch(() => {});

    res.json({
      image: `data:image/png;base64,${resultB64}`,
      elapsed,
      filename,
      requestId,
      usage,
      provider: "oauth",
      moderation,
      safetyRetryAvailable: hasCompliantRetry(prompt),
      promptRewrittenForSafety: promptRewrittenForSafety === true,
    });
  } catch (err) {
    console.error("Edit error:", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// -- Node mode (0.04) --
function wantsSse(req) {
  const accept = typeof req.headers.accept === "string" ? req.headers.accept : "";
  return accept.includes("text/event-stream");
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeNodeError(res, status, code, message, parentNodeId) {
  if (res.headersSent) {
    writeSse(res, "error", { error: { code, message }, parentNodeId, status });
    res.end();
    return;
  }
  res.status(status).json({ error: { code, message }, parentNodeId });
}

function dataUrlFromB64(format, b64) {
  return `data:image/${format === "jpeg" ? "jpeg" : format};base64,${b64}`;
}

app.post("/api/node/generate", async (req, res) => {
  const body = req.body || {};
  const streamResponse = wantsSse(req);
  const parentNodeId = body.parentNodeId ?? null;
  const requestId = typeof body.requestId === "string" ? body.requestId : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  const clientNodeId =
    typeof body.clientNodeId === "string" ? body.clientNodeId : null;
  const __nodeMaxAttempts = clampMaxAttempts(body.maxAttempts, 2);
  startJob({
    requestId,
    kind: "node",
    prompt: body.prompt,
    maxAttempts: __nodeMaxAttempts,
    owner: req.authUser || LEGACY_OWNER,
    meta: {
      kind: "node",
      sessionId,
      parentNodeId,
      clientNodeId,
    },
  });
  try {
    const {
      prompt: rawPrompt,
      quality: rawQuality = "low",
      size: rawSize = "1024x1024",
      format: rawFormat = "png",
      moderation: rawModeration = "auto",
      references = [],
      externalSrc = null,
      maxAttempts: rawMaxAttempts,
      originalPrompt: rawOriginalPrompt,
    } = body;
    const maxAttempts = __nodeMaxAttempts;
    void rawMaxAttempts;
    const originalPrompt =
      typeof rawOriginalPrompt === "string" && rawOriginalPrompt.trim().length > 0
        ? rawOriginalPrompt.trim().slice(0, 4000)
        : null;
    const { provider = "oauth" } = body;

    if (provider === "api") {
      return writeNodeError(res, 403, "APIKEY_DISABLED", "API key provider is disabled. Use OAuth.", parentNodeId);
    }

    const nodeBadRequest = (check) =>
      writeNodeError(res, 400, check.code, check.message, parentNodeId);

    const pCheck = validatePrompt(rawPrompt);
    if (!pCheck.ok) return nodeBadRequest(pCheck);
    const qCheck = validateQuality(rawQuality);
    if (!qCheck.ok) return nodeBadRequest(qCheck);
    const sCheck = validateSize(rawSize);
    if (!sCheck.ok) return nodeBadRequest(sCheck);
    const fCheck = validateFormat(rawFormat);
    if (!fCheck.ok) return nodeBadRequest(fCheck);
    const mCheck = validateModeration(rawModeration);
    if (!mCheck.ok) return nodeBadRequest(mCheck);

    const prompt = pCheck.value;
    const quality = qCheck.value;
    const size = sCheck.value;
    const format = fCheck.value;
    const moderation = mCheck.value;

    const refCheck = validateAndNormalizeRefs(references);
    if (refCheck.error) {
      return writeNodeError(res, 400, refCheck.code, refCheck.error, parentNodeId);
    }
    const refB64s = refCheck.refs;

    // Open the SSE stream now — once we commit, future errors must be
    // serialized as `event: error` instead of res.status().json().
    if (streamResponse) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      writeSse(res, "phase", { requestId, phase: "streaming" });
    }

    const startTime = Date.now();
    let parentB64 = null;
    if (parentNodeId) {
      parentB64 = await loadNodeB64(__dirname, `${parentNodeId}.png`);
    } else if (typeof externalSrc === "string" && externalSrc.length > 0) {
      // TODO(0.09 D4): history promotion should materialize imported assets into a
      // node-owned file path. This stub allows controlled reads from generated/
      // so promotion can fail gracefully instead of assuming <nodeId>.png only.
      parentB64 = await loadAssetB64(__dirname, externalSrc);
    }

    let nodeResult;
    try {
      nodeResult = await runPromptAttempts(
        prompt,
        (attemptPrompt) =>
          parentB64
            ? editViaOAuth(attemptPrompt, parentB64, quality, size, moderation)
            : generateViaOAuth(
                attemptPrompt,
                quality,
                size,
                moderation,
                refB64s,
                requestId,
                {
                  partialImages: streamResponse ? 2 : 0,
                  onPartialImage: streamResponse
                    ? (partial) =>
                        writeSse(res, "partial", {
                          requestId,
                          image: dataUrlFromB64(format, partial.b64),
                          index: partial.index,
                        })
                    : null,
                },
              ),
        "node",
        maxAttempts,
        requestId ? (i) => setJobAttempt(requestId, i) : null,
        { requestId, hasRefs: !!parentB64 || refB64s.length > 0 },
      );
    } catch (err) {
      await writeFailureSidecar({
        endpoint: "node",
        prompt,
        originalPrompt,
        quality,
        size,
        format,
        moderation,
        attempts: err.attempts || [],
        error: err,
        sessionId,
        parentNodeId,
        clientNodeId,
        referenceCount: refB64s.length,
        owner: req.authUser,
        requestId,
      });
      return writeNodeError(res, err.status || 422, err.code || (err?.cause?.code === "EMPTY_RESPONSE" ? "EMPTY_RESPONSE" : "SAFETY_REFUSAL"), err.message, parentNodeId);
    }

    const b64 = nodeResult.b64;
    const usage = nodeResult.usage;
    const webSearchCalls = nodeResult.webSearchCalls || 0;

    const nodeId = newNodeId();
    const elapsed = +((Date.now() - startTime) / 1000).toFixed(1);
    const meta = {
      nodeId,
      parentNodeId,
      sessionId,
      clientNodeId,
      prompt,
      promptUsed: nodeResult.promptUsed || prompt,
      promptRewrittenForSafety: nodeResult.promptRewrittenForSafety === true,
      ...(originalPrompt ? { originalPrompt } : {}),
      options: { quality, size, format, moderation },
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
      elapsed,
      usage: usage || null,
      webSearchCalls,
      provider: "oauth",
      kind: parentB64 ? "edit" : "generate",
      // Fields consumed by /api/history flat scan (so node images appear in history too)
      quality, size, format, moderation,
      maxAttempts,
      attempts: Array.isArray(nodeResult.attempts) ? nodeResult.attempts : [],
      referenceCount: refB64s.length,
      owner: req.authUser || LEGACY_OWNER,
      requestId,
    };
    await mkdir(join(__dirname, "generated"), { recursive: true });
    const { filename } = await saveNode(__dirname, { nodeId, b64, meta, ext: format });

    const payload = {
      nodeId,
      parentNodeId,
      requestId,
      image: dataUrlFromB64(format, b64),
      filename,
      url: `/generated/${filename}`,
      thumb: variantUrls(filename).thumb,
      web: variantUrls(filename).web,
      elapsed,
      usage,
      webSearchCalls,
      provider: "oauth",
      moderation,
      // Echo the resolved size so the UI can derive the node preview aspect
      // ratio (custom sizes can be 3:1, 16:9 etc — square fallback distorts).
      size,
      safetyRetryAvailable: hasCompliantRetry(prompt),
      promptRewrittenForSafety: nodeResult.promptRewrittenForSafety === true,
    };
    if (streamResponse) {
      writeSse(res, "done", payload);
      res.end();
    } else {
      res.json(payload);
    }
    // Step 4-B: persist result so a client that lost the stream can recover.
    if (requestId) {
      void writeNodeResult(__dirname, requestId, {
        status: "done",
        clientNodeId,
        sessionId,
        payload,
      });
    }
  } catch (err) {
    console.error("[node/generate] error:", err.message);
    if (requestId) {
      void writeNodeResult(__dirname, requestId, {
        status: "error",
        clientNodeId,
        sessionId,
        error: { code: err.code || "NODE_GEN_FAILED", message: err.message, status: err.status || 500 },
      });
    }
    writeNodeError(res, err.status || 500, err.code || "NODE_GEN_FAILED", err.message, parentNodeId);
  } finally {
    finishJob(requestId);
  }
});

// Step 4-B: client polls this when the streaming response was lost. Returns
// 404 until the generation finishes (or after TTL eviction), then the cached
// done/error payload until pruneNodeResults sweeps it.
app.get("/api/node/result/:requestId", async (req, res) => {
  const result = await readNodeResult(__dirname, req.params.requestId);
  if (!result) {
    return res.status(404).json({ error: { code: "RESULT_NOT_READY", message: "Not yet available" } });
  }
  // Owner check: cross-reference sessionId against the user's sessions.
  // Skip when auth is disabled. Cheap because we only look up one row.
  res.json(result);
});

// Adopt an existing classic-mode (or other) generated/ image as a brand-new
// root node so node-mode children can branch from it immediately. The source
// file is hardlinked (or copied) under `<newNodeId>.<ext>` and a fresh
// sidecar is written so loadNodeB64 / loadNodeMeta / canAccess all work the
// same way they do for natively-generated nodes.
app.post("/api/node/import-history", async (req, res) => {
  try {
    const body = req.body || {};
    const sourceFilename = typeof body.historyFilename === "string" ? body.historyFilename.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    const clientNodeId = typeof body.clientNodeId === "string" ? body.clientNodeId : null;
    if (!sourceFilename) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "historyFilename is required" } });
    }

    const sourceMeta = await loadAssetSidecar(__dirname, sourceFilename);
    if (sourceMeta && !canAccess(sourceMeta, req.authUser)) {
      return res.status(404).json({ error: { code: "NODE_NOT_FOUND", message: "Source image not found" } });
    }

    const nodeId = newNodeId();
    const createdAt = Date.now();
    const sourcePrompt = typeof sourceMeta?.prompt === "string" ? sourceMeta.prompt : "";
    const sourceSize = typeof sourceMeta?.size === "string" ? sourceMeta.size : null;
    const sourceQuality = typeof sourceMeta?.quality === "string" ? sourceMeta.quality : null;
    const sourceFormat = typeof sourceMeta?.format === "string" ? sourceMeta.format : null;
    const sourceModeration = typeof sourceMeta?.moderation === "string" ? sourceMeta.moderation : null;

    const meta = {
      nodeId,
      parentNodeId: null,
      sessionId,
      clientNodeId,
      prompt: sourcePrompt,
      promptUsed: sourcePrompt,
      options: {
        ...(sourceQuality ? { quality: sourceQuality } : {}),
        ...(sourceSize ? { size: sourceSize } : {}),
        ...(sourceFormat ? { format: sourceFormat } : {}),
        ...(sourceModeration ? { moderation: sourceModeration } : {}),
      },
      createdAt,
      createdAtIso: new Date(createdAt).toISOString(),
      provider: sourceMeta?.provider || "oauth",
      kind: "imported",
      importedFromFilename: sourceFilename,
      ...(sourceQuality ? { quality: sourceQuality } : {}),
      ...(sourceSize ? { size: sourceSize } : {}),
      ...(sourceFormat ? { format: sourceFormat } : {}),
      ...(sourceModeration ? { moderation: sourceModeration } : {}),
      owner: req.authUser || LEGACY_OWNER,
    };

    let result;
    try {
      result = await importExistingFile(__dirname, { sourceFilename, nodeId, meta });
    } catch (err) {
      if (err?.code === "NODE_SOURCE_INVALID") {
        return res.status(400).json({ error: { code: "NODE_SOURCE_INVALID", message: err.message } });
      }
      if (err?.code === "ENOENT") {
        return res.status(404).json({ error: { code: "NODE_NOT_FOUND", message: "Source image not found" } });
      }
      throw err;
    }

    res.json({
      nodeId,
      filename: result.filename,
      url: `/generated/${result.filename}`,
      thumb: variantUrls(result.filename).thumb,
      web: variantUrls(result.filename).web,
      prompt: sourcePrompt,
      size: sourceSize,
      importedFromFilename: sourceFilename,
    });
  } catch (err) {
    console.error("[node/import-history] error:", err.message);
    res.status(500).json({ error: { code: "NODE_IMPORT_FAILED", message: err.message } });
  }
});

app.get("/api/node/:nodeId", async (req, res) => {
  try {
    const { nodeId } = req.params;
    const meta = await loadNodeMeta(__dirname, nodeId);
    if (!meta) {
      return res.status(404).json({ error: { code: "NODE_NOT_FOUND", message: "Node metadata missing" } });
    }
    if (!canAccess(meta, req.authUser)) {
      return res.status(404).json({ error: { code: "NODE_NOT_FOUND", message: "Node metadata missing" } });
    }
    const ext = meta?.options?.format || meta?.format || "png";
    res.json({
      nodeId,
      meta,
      url: `/generated/${nodeId}.${ext}`,
      thumb: variantUrls(`${nodeId}.${ext}`).thumb,
      web: variantUrls(`${nodeId}.${ext}`).web,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { code: err.code || "NODE_FETCH_FAILED", message: err.message },
    });
  }
});

// -- Session DB (0.06) --
app.get("/api/sessions", (req, res) => {
  try {
    let sessions = listSessions(req.authUser);
    if (sessions.length === 0 && req.authUser) {
      ensureDefaultSession(req.authUser);
      sessions = listSessions(req.authUser);
    }
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.post("/api/sessions", (req, res) => {
  try {
    const title = (req.body?.title || "Untitled").slice(0, 200);
    const session = createSession({ title, owner: req.authUser || LEGACY_OWNER });
    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  try {
    const session = getSession(req.params.id, req.authUser);
    if (!session) {
      return res.status(404).json({
        error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
      });
    }
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.patch("/api/sessions/:id", (req, res) => {
  try {
    const title = req.body?.title;
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({
        error: { code: "INVALID_TITLE", message: "Title required" },
      });
    }
    const ok = renameSession(req.params.id, title.slice(0, 200), req.authUser);
    if (!ok) {
      return res.status(404).json({
        error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.delete("/api/sessions/:id", (req, res) => {
  try {
    const ok = deleteSession(req.params.id, req.authUser);
    if (!ok) {
      return res.status(404).json({
        error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

// -- Prompt library (Phase 6.3) — 자주 쓰는 프롬프트 저장/검색/재사용. --
function promptErrorStatus(code) {
  if (code === PROMPT_ERRORS.NOT_FOUND) return 404;
  if (code === PROMPT_ERRORS.FORBIDDEN) return 403;
  return 400;
}

app.get("/api/prompts", (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limitRaw = Number(req.query.limit);
    const offsetRaw = Number(req.query.offset);
    const items = listPrompts({
      owner: req.authUser || LEGACY_OWNER,
      q,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : undefined,
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.post("/api/prompts", (req, res) => {
  try {
    const r = createPrompt({
      title: typeof req.body?.title === "string" ? req.body.title : "",
      body: typeof req.body?.body === "string" ? req.body.body : "",
      owner: req.authUser || LEGACY_OWNER,
    });
    if (r.error) {
      return res.status(promptErrorStatus(r.error)).json({ error: { code: r.error, message: r.error } });
    }
    res.status(201).json({ item: r.item });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.patch("/api/prompts/:id", (req, res) => {
  try {
    const patch = {};
    if (typeof req.body?.title === "string") patch.title = req.body.title;
    if (typeof req.body?.body === "string") patch.body = req.body.body;
    if (typeof req.body?.pinned === "boolean") patch.pinned = req.body.pinned;
    const r = updatePrompt(req.params.id, patch, { owner: req.authUser || LEGACY_OWNER });
    if (r.error) {
      return res.status(promptErrorStatus(r.error)).json({ error: { code: r.error, message: r.error } });
    }
    res.json({ item: r.item });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.delete("/api/prompts/:id", (req, res) => {
  try {
    const r = deletePrompt(req.params.id, { owner: req.authUser || LEGACY_OWNER });
    if (r.error) {
      return res.status(promptErrorStatus(r.error)).json({ error: { code: r.error, message: r.error } });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

app.post("/api/prompts/:id/use", (req, res) => {
  try {
    const r = bumpPromptUse(req.params.id, { owner: req.authUser || LEGACY_OWNER });
    if (r.error) {
      return res.status(promptErrorStatus(r.error)).json({ error: { code: r.error, message: r.error } });
    }
    res.json({ useCount: r.useCount, lastUsedAt: r.lastUsedAt });
  } catch (err) {
    res.status(500).json({ error: { code: "DB_ERROR", message: err.message } });
  }
});

// POST /api/prompts/import-github { url } → { sourceUrl, created: [...] }
//
// fork extension: GitHub URL 의 markdown/raw 를 fetch 해서 fenced code block
// 들을 prompts 라이브러리에 source=github 로 일괄 저장. upstream 의 GitHub
// search discovery 흐름은 가져오지 않고 "URL 직접 붙여넣기" 단순화 버전.
// 결과는 created 배열 — 각 항목이 그대로 PromptLibraryModal 에 추가됨.
app.post("/api/prompts/import-github", express.json({ limit: "32kb" }), async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!url) {
    return res.status(400).json({ error: { code: "URL_REQUIRED", message: "GitHub URL 이 필요합니다." } });
  }
  try {
    const { sourceUrl, items } = await importFromGitHubUrl(url);
    const owner = req.authUser || LEGACY_OWNER;
    const created = [];
    const skipped = [];
    for (const it of items) {
      const r = createPrompt({
        title: it.title || "",
        body: it.body,
        owner,
        source: "github",
        sourceUrl: it.sourceUrl || sourceUrl,
      });
      if (r.error) {
        skipped.push({ title: it.title || it.body.slice(0, 40), error: r.error });
        continue;
      }
      created.push(r.item);
    }
    res.json({ sourceUrl, created, skipped });
  } catch (err) {
    if (err instanceof PromptImportError) {
      const status = err.code === "FETCH_TOO_LARGE" ? 413 : 400;
      return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    console.error("[prompt-import-github] failed:", err);
    res.status(500).json({ error: { code: "IMPORT_FAILED", message: err.message } });
  }
});

app.put("/api/sessions/:id/graph", (req, res) => {
  // Save-tracking headers let multi-tab debugging tell apart which save
  // path / which tab triggered each conflict. They are best-effort; an
  // older client that omits them still works.
  const saveId = req.get("X-Ima2-Graph-Save-Id") || null;
  const saveReason = req.get("X-Ima2-Graph-Save-Reason") || null;
  const tabId = req.get("X-Ima2-Tab-Id") || null;
  const sessionId = req.params.id;
  try {
    const { nodes, edges } = req.body || {};
    const rawIfMatch = req.get("If-Match");
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({
        error: { code: "INVALID_GRAPH", message: "nodes and edges arrays required" },
      });
    }
    if (!rawIfMatch) {
      return res.status(428).json({
        error: {
          code: "GRAPH_VERSION_REQUIRED",
          message: "If-Match header required",
        },
      });
    }
    if (nodes.length > 500 || edges.length > 1000) {
      return res.status(413).json({
        error: {
          code: "GRAPH_TOO_LARGE",
          message: `Graph too large (max 500 nodes / 1000 edges), got ${nodes.length}/${edges.length}`,
        },
      });
    }
    const expectedVersion = Number(String(rawIfMatch).replace(/"/g, ""));
    if (!Number.isFinite(expectedVersion)) {
      return res.status(400).json({
        error: {
          code: "INVALID_GRAPH_VERSION",
          message: "If-Match must be a finite integer",
        },
      });
    }
    const result = saveGraph(sessionId, {
      nodes,
      edges,
      expectedVersion,
      owner: req.authUser,
    });
    logEvent("session", "graph_save", {
      sessionId,
      saveId,
      saveReason,
      tabId,
      nodes: nodes.length,
      edges: edges.length,
      graphVersion: result.graphVersion,
      authUser: req.authUser || null,
    });
    res.json({
      ok: true,
      nodes: nodes.length,
      edges: edges.length,
      graphVersion: result.graphVersion,
    });
  } catch (err) {
    const code = err.code || "DB_ERROR";
    const payload = { error: { code, message: err.message } };
    if (typeof err.currentVersion === "number") {
      payload.currentVersion = err.currentVersion;
    }
    if (code === "GRAPH_VERSION_CONFLICT") {
      // Conflicts are expected concurrency events, not bugs — emit a
      // structured warn-level event so they show up in observability
      // without being treated as server errors.
      logEvent("session", "graph_conflict", {
        sessionId,
        saveId,
        saveReason,
        tabId,
        expectedVersion: Number(String(req.get("If-Match") || "").replace(/"/g, "")),
        currentVersion: err.currentVersion ?? null,
        nodes: Array.isArray(req.body?.nodes) ? req.body.nodes.length : null,
        edges: Array.isArray(req.body?.edges) ? req.body.edges.length : null,
        authUser: req.authUser || null,
      });
    } else {
      logError("session", "graph_error", err, { sessionId, code, saveId, tabId });
    }
    res.status(err.status || 500).json(payload);
  }
});


// Recover orphan node-mode generations whose stream response was lost
// (long /api/node/generate dropped before client received "done"). Scans
// generated/ sidecars + generated/.failed/ sidecars, matches by
// clientNodeId, and patches graph nodes whose imageUrl is missing.
app.post("/api/sessions/:id/reconcile-orphans", async (req, res) => {
  const sessionId = req.params.id;
  try {
    const result = await reconcileSessionFromDisk(sessionId, __dirname, req.authUser);
    if (result.recovered > 0 || result.stalified > 0) {
      logEvent("session", "graph_reconcile", {
        sessionId,
        recovered: result.recovered,
        stalified: result.stalified,
        graphVersion: result.graphVersion,
        authUser: req.authUser || null,
      });
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({
      error: { code: err.code || "RECONCILE_FAILED", message: err.message },
    });
  }
});

// -- Billing info --
app.get("/api/billing", async (_req, res) => {
  if (!HAS_API_KEY) {
    return res.json({ oauth: true, apiKeyValid: false, apiKeySource: "none" });
  }

  try {
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const [subRes, usageRes, modelsRes] = await Promise.allSettled([
      fetch(
        "https://api.openai.com/v1/organization/costs?start_time=" +
          Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000) +
          "&end_time=" + Math.floor(Date.now() / 1000) + "&bucket_width=1d&limit=31",
        { headers },
      ),
      fetch("https://api.openai.com/dashboard/billing/credit_grants", { headers }),
      fetch("https://api.openai.com/v1/models", { headers }),
    ]);

    const billing = { apiKeySource: "env" };
    if (subRes.status === "fulfilled" && subRes.value.ok) billing.costs = await subRes.value.json();
    if (usageRes.status === "fulfilled" && usageRes.value.ok) billing.credits = await usageRes.value.json();
    billing.apiKeyValid =
      modelsRes.status === "fulfilled" && modelsRes.value.ok === true;
    res.json(billing);
  } catch (err) {
    res.status(500).json({ error: err.message, apiKeyValid: false });
  }
});

// -- Enhance prompt (non-streaming OAuth call) --
app.post("/api/enhance-prompt", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const language = req.body?.language === "en" ? "en" : "ko";
    if (!prompt) {
      return res.status(400).json({ error: "prompt required", code: "EMPTY_PROMPT" });
    }
    if (prompt.length > 4000) {
      return res.status(400).json({ error: "prompt too long", code: "PROMPT_TOO_LONG" });
    }

    // Optional reference images. Same validator + cap as /api/generate.
    // Omitted (undefined) defaults to [] and passes; explicit non-array
    // inputs (e.g. a string) now surface as REF_NOT_ARRAY instead of being
    // silently coerced to empty.
    const rawRefs = req.body?.references ?? [];
    const refCheck = validateAndNormalizeRefs(rawRefs);
    if (refCheck.error) {
      return res.status(400).json({ error: refCheck.error, code: refCheck.code });
    }
    const refB64s = refCheck.refs;

    const body = buildEnhancePayload(prompt, language, refB64s);
    const result = await runResponses({ url: OAUTH_URL, body });
    const rawText = result.text || extractEnhancedText(result.raw);
    if (!rawText) {
      return res.status(502).json({ error: "enhancer returned no text", code: "ENHANCE_EMPTY" });
    }
    const cleaned = sanitizeEnhancedText(rawText).trim();
    if (!cleaned) {
      return res.status(502).json({ error: "enhancer returned only safety boilerplate", code: "ENHANCE_EMPTY" });
    }
    res.json({ prompt: cleaned, usage: result.usage ?? null });
  } catch (err) {
    console.error("[enhance] error:", err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message, code: "ENHANCE_FAILED" });
  }
});

// -- Start OAuth proxy as child process --
// The proxy sometimes can't bind to the requested port (another ima2 instance,
// a stale process, etc.) and falls back to a random port, printing a line like:
//   "Port 10531 was unavailable. Using port 10539 instead."
//   "OpenAI-compatible endpoint ready at http://127.0.0.1:10539/v1"
// We parse those lines and rebind OAUTH_URL to the actual live port. Without
// this, every /api/generate hits ECONNREFUSED on the stale port.
function parseOAuthPortFromLine(line) {
  // Prefer the canonical "endpoint ready at" banner (authoritative).
  const ready = line.match(/endpoint ready at\s+https?:\/\/[^:\s]+:(\d+)/i);
  if (ready) return { port: Number(ready[1]), reason: "ready" };
  // Fallback: explicit fallback message.
  const using = line.match(/using port (\d+)\s+instead/i);
  if (using) return { port: Number(using[1]), reason: "fallback" };
  return null;
}

function startOAuthProxy() {
  OAUTH_READY = false;
  console.log(`Starting openai-oauth on port ${OAUTH_PORT_REQUESTED}...`);
  const child = spawnBin(
    "npx",
    ["openai-oauth", "--port", String(OAUTH_PORT_REQUESTED)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  const handleLine = (line) => {
    if (!line) return;
    console.log(`[oauth] ${line}`);
    const parsed = parseOAuthPortFromLine(line);
    if (parsed && Number.isFinite(parsed.port) && parsed.port > 0) {
      if (parsed.port !== OAUTH_PORT) {
        console.warn(
          `[ima2] OAuth proxy bound to port ${parsed.port} ` +
          `(requested ${OAUTH_PORT_REQUESTED}). Switching OAUTH_URL.`,
        );
        OAUTH_PORT = parsed.port;
        OAUTH_URL = `http://127.0.0.1:${OAUTH_PORT}`;
      }
      if (parsed.reason === "ready") {
        OAUTH_READY = true;
        OAUTH_LAST_ERROR = null;
      }
    }
  };

  let stdoutBuf = "";
  child.stdout.on("data", (d) => {
    stdoutBuf += d.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      handleLine(line);
    }
  });

  child.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg && !msg.includes("npm warn")) {
      console.error(`[oauth] ${msg}`);
      OAUTH_LAST_ERROR = msg.slice(0, 500);
    }
  });

  child.on("exit", (code) => {
    OAUTH_READY = false;
    console.log(`[oauth] exited with code ${code}, restarting in 5s...`);
    setTimeout(startOAuthProxy, 5000);
  });

  return child;
}

// -- Boot --
const PORT = process.env.PORT || 3333;
// Default to loopback-only listen so nginx (or whatever reverse proxy is in
// front) is the single ingress. Without this guard, a 0.0.0.0 bind on a
// shared box means anyone on the LAN — or anyone running a browser on the
// box itself — can hit http://<box>:3333/ and bypass nginx basic-auth /
// rate-limit / TLS. Set IMA2_HOST=0.0.0.0 only for self-hosted setups
// without an upstream reverse proxy.
const HOST = process.env.IMA2_HOST || "127.0.0.1";
// Tests (and some CI contexts) can opt out of the OAuth proxy subprocess.
// The proxy is a user-facing login helper, not required for /api/health or
// offline unit tests, and starting it on Windows CI can add 7-10s latency.
const oauthChild = process.env.IMA2_NO_OAUTH_PROXY === "1"
  ? null
  : startOAuthProxy();

// CLI discovery: advertise running server under ~/.ima2/server.json
const __advertisePath = join(homedir(), ".ima2", "server.json");
function __advertise() {
  try {
    mkdirSync(dirname(__advertisePath), { recursive: true });
    writeFileSync(
      __advertisePath,
      JSON.stringify({
        port: Number(PORT),
        pid: process.pid,
        startedAt: __startedAt,
        version: __pkg.version,
      }),
    );
  } catch (e) {
    console.warn("[advertise] skipped:", e.message);
  }
}
function __unadvertise() {
  try {
    if (!existsSync(__advertisePath)) return;
    const cur = JSON.parse(fsReadFileSync(__advertisePath, "utf-8"));
    if (cur.pid === process.pid) unlinkSync(__advertisePath);
  } catch {}
}

// Maximum drain window. Each in-flight generation can take up to ~10 min
// (8 attempts × ~3min reasoning each), so this matches the inflight TTL
// that purgeStaleJobs uses. Override via env for tests.
const SHUTDOWN_DRAIN_TIMEOUT_MS = Number(process.env.IMA2_SHUTDOWN_DRAIN_MS) || 10 * 60 * 1000;
const SHUTDOWN_POLL_INTERVAL_MS = 1000;

onShutdown(async (sig) => {
  // Step 1 — gate new requests immediately. Anything already past the
  // gate (mid-stream) keeps running.
  SHUTTING_DOWN = true;
  console.log(`[shutdown] received ${sig} — gating new mutation requests, draining in-flight jobs`);

  // Step 2 — poll the inflight registry until it's empty or we hit the
  // timeout. We log a status line every 5 seconds so an operator watching
  // `journalctl -fu ima2-gen` can see progress instead of a silent hang.
  const drainStartedAt = Date.now();
  let lastReportAt = 0;
  while (true) {
    let active;
    try {
      // listJobsRaw skips purgeStaleJobs() so the drain doesn't
      // accidentally drop a row whose fetch is still running. Stale
      // rows get cleaned up at startup of the next process anyway.
      active = listJobsRaw();
    } catch (err) {
      console.warn(`[shutdown] listJobsRaw failed during drain: ${err?.message || err}`);
      break;
    }
    if (active.length === 0) {
      console.log(`[shutdown] drain complete after ${Date.now() - drainStartedAt}ms`);
      break;
    }
    const elapsed = Date.now() - drainStartedAt;
    if (elapsed >= SHUTDOWN_DRAIN_TIMEOUT_MS) {
      const ids = active.map((j) => j.requestId).join(", ");
      console.warn(
        `[shutdown] drain timeout after ${elapsed}ms — ${active.length} job(s) still in-flight: ${ids}. ` +
        `Forcing shutdown; OpenAI quota for these requests is forfeit.`,
      );
      break;
    }
    if (elapsed - lastReportAt >= 5000) {
      lastReportAt = elapsed;
      const phases = active.map((j) => `${j.requestId}@${j.phase}(${j.attempt}/${j.maxAttempts})`).join(", ");
      console.log(
        `[shutdown] still draining: ${active.length} job(s) — ${phases} ` +
        `(${Math.round(elapsed / 1000)}s / ${Math.round(SHUTDOWN_DRAIN_TIMEOUT_MS / 1000)}s)`,
      );
    }
    await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_INTERVAL_MS));
  }

  // Step 3 — release process-level resources after the drain.
  __unadvertise();
  try { oauthChild?.kill(); } catch {}
});
process.on("exit", __unadvertise);

// Step 4-B: opportunistic TTL sweep on boot; subsequent writes also rotate.
void pruneNodeResults(__dirname).catch(() => {});

app.listen(PORT, HOST, () => {
  const advertised = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
  console.log(`Image Gen running at http://${advertised}:${PORT} (bind ${HOST})`);
  console.log(`Provider policy: OAuth only (API key hard-disabled). OAuth proxy port ${OAUTH_PORT}.`);
  __advertise();
  try {
    const s = ensureDefaultSession(LEGACY_OWNER);
    console.log(`[db] default session: ${s.id} (${s.title}) owner=${s.owner}`);
  } catch (err) {
    console.error("[db] bootstrap failed:", err.message);
  }
  // Inflight rows whose original fetch died with the previous process
  // are not recoverable — drop everything older than the configured TTL
  // before clients start polling /api/inflight.
  try {
    const purged = purgeStaleJobs();
    if (purged > 0) console.log(`[inflight] purged ${purged} stale job(s) at startup`);
  } catch (err) {
    console.error("[inflight] startup purge failed:", err.message);
  }
});
