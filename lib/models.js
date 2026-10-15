// Single source of truth for the model ids and image route this app sends
// upstream. Two distinct roles with different constraints — do NOT collapse
// them into one constant.
//
// ─────────────────────────────────────────────────────────────────────────
// Image route — which upstream endpoint actually renders pixels
// ─────────────────────────────────────────────────────────────────────────
// 2026-10-15 20:20 KST the Codex OAuth backend started rejecting gpt-5.5 with
// "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT
// account." and /v1/models now lists only gpt-6.1-sol / gpt-6-* / gpt-5.6-* /
// gpt-image-2. None of the remaining chat models can drive the Responses
// `image_generation` tool through openai-oauth 2.0.0: it rewrites them to
// "responses lite", strips `tools`, and then
//   tool_choice {type:"image_generation"} / "required" → 400
//   tool_choice "auto"                                  → SVG text, no image
// (measured against the live proxy, 127.0.0.1:10530).
//
// Codex CLI itself (0.162.x) renders images by calling the Images API with
// gpt-image-2, and openai-oauth exposes the same thing:
//   POST /v1/images/generations  JSON  {model,prompt,size,quality,background,n}
//   POST /v1/images/edits        multipart, 1-5 `image[]` files (no mask)
// moderation / output_format / output_compression / partial_images / stream /
// mask are rejected by the proxy (400), so lib/imagesApi.js never sends them.
// Measured 2026-10-15: generations low ≈17-22s, edits with 2 refs ≈48s; the
// backend ignores `size` and picks the canvas from the prompt (an orientation
// sentence yields 1536x1024 / 1024x1536, otherwise 1254x1254), and pins
// quality to low for opaque output (medium when transparent).
//
// IMA2_IMAGE_ROUTE=images     (default) Images API, model IMAGE_API_MODEL
// IMA2_IMAGE_ROUTE=responses  legacy Responses + image_generation tool driven
//                             by IMAGE_MODEL. Only useful if the backend ever
//                             accepts an orchestrator model with the tool again.
export const IMAGE_ROUTE =
  String(process.env.IMA2_IMAGE_ROUTE || "").trim().toLowerCase() === "responses"
    ? "responses"
    : "images";

// Model sent to /v1/images/*.
export const IMAGE_API_MODEL = process.env.IMA2_IMAGE_API_MODEL || "gpt-image-2";

// Orchestrator for the legacy Responses route only (IMA2_IMAGE_ROUTE=responses).
// gpt-5.5 was the last id that could carry the image_generation tool and the
// backend no longer serves it, so the default is the current top model; it is
// unused unless the route is switched back.
export const IMAGE_MODEL = process.env.IMA2_RESPONSES_MODEL || "gpt-6.1-sol";

// ─────────────────────────────────────────────────────────────────────────
// TEXT_MODEL — text-only helpers (prompt 다듬기, safety-retry rewrite)
// ─────────────────────────────────────────────────────────────────────────
// These never send `tools`, so the image-tool gap above does not apply and
// they can ride the newest line (gpt-6.1-sol re-checked 2026-10-15 after the
// 5.5 removal). Latency measured 2026-08-03 through the live
// proxy with the real payload builders, reasoning effort "low":
//
//     enhance (다듬기)  gpt-5.5 3.2-6.3s (n=5)   gpt-5.6-sol 4.8-9.4s (n=5)
//     safety rewrite    gpt-5.5 3.4s             gpt-5.6-sol 3.4s
//
// Run-to-run spread is wider than the gap between the two models, so there is
// no reliable latency penalty — the single 9.4s 5.6 sample did not reproduce
// (a same-payload 3x rerun averaged 5.0s vs 5.4s). Output shape and length
// were equivalent on both; the rewrite tier came back slightly more concise.
// To change it, set IMA2_TEXT_MODEL in the systemd unit and restart — no code
// change required. (gpt-5.5 is no longer served by the backend.)
export const TEXT_MODEL = process.env.IMA2_TEXT_MODEL || "gpt-6.1-sol";
