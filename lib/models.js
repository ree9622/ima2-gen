// Single source of truth for the Responses API model ids this app sends
// upstream. Two distinct roles with different constraints — do NOT collapse
// them into one constant.
//
// ─────────────────────────────────────────────────────────────────────────
// IMAGE_MODEL — orchestrator that must call the `image_generation` tool
// ─────────────────────────────────────────────────────────────────────────
// Pinned to the 5.5 line. The Codex OAuth backend advertises newer ids via
// `GET /v1/models` (gpt-5.6-sol / -terra / -luna), and they answer plain text
// fine, but **none of them accept the `image_generation` tool**: the upstream
// silently drops `tools` and then rejects the request with
//
//     "Tool choice 'required' must be specified with 'tools' parameter."
//
// Measured 2026-08-03 against the live proxy (127.0.0.1:10530) with an
// identical body per model:
//
//     gpt-5.5       → status completed, output [image_generation_call, message]
//     gpt-5.6-sol   → invalid_request_error (tool dropped)
//     gpt-5.6-terra → invalid_request_error (tool dropped)
//     gpt-5.6-luna  → invalid_request_error (tool dropped)
//
// ima2-router does not touch `tools` (no reference to it anywhere in the
// router source), so this is an upstream capability gap, not a proxy bug.
// Do not "upgrade" this constant to a 5.6 id without re-running that probe —
// the failure mode is every generation returning UPSTREAM_EMPTY.
export const IMAGE_MODEL = process.env.IMA2_RESPONSES_MODEL || "gpt-5.5";

// ─────────────────────────────────────────────────────────────────────────
// TEXT_MODEL — text-only helpers (prompt 다듬기, safety-retry rewrite)
// ─────────────────────────────────────────────────────────────────────────
// These never send `tools`, so the image-tool gap above does not apply and
// they can ride the newest line. Latency measured 2026-08-03 through the live
// proxy with the real payload builders, reasoning effort "low":
//
//     enhance (다듬기)  gpt-5.5 3.2-6.3s (n=5)   gpt-5.6-sol 4.8-9.4s (n=5)
//     safety rewrite    gpt-5.5 3.4s             gpt-5.6-sol 3.4s
//
// Run-to-run spread is wider than the gap between the two models, so there is
// no reliable latency penalty — the single 9.4s 5.6 sample did not reproduce
// (a same-payload 3x rerun averaged 5.0s vs 5.4s). Output shape and length
// were equivalent on both; the rewrite tier came back slightly more concise.
// If 다듬기 ever does feel slower in practice, set IMA2_TEXT_MODEL=gpt-5.5 in
// the systemd unit and restart — no code change required.
export const TEXT_MODEL = process.env.IMA2_TEXT_MODEL || "gpt-5.6-sol";
