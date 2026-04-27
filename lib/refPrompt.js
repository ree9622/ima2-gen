// Reference-mode prompt boosters.
//
// In reference mode (user attaches an image to vary pose / outfit / background)
// short prompts like "다른 자세", "비키니로 변경", "카페에서" provide little
// context, so the model often regenerates the face or drifts the identity.
// This module appends a face-lock cue to those prompts.
//
// Heuristics:
//   - boost only if a reference image is attached (caller's responsibility)
//   - boost only if the prompt is short OR clearly an edit/variation command
//     ("다른", "변경", "체인지", "바꿔", "change", "different", etc.)
//   - skip if the prompt already contains face-lock language (avoid duplication)

const VARIATION_HINTS = [
  /다른/, /변경/, /바꿔/, /체인지/, /바꾸/, /로\s*해/,
  /\bchange\b/i, /\bdifferent\b/i, /\bswap\b/i, /\binstead\b/i, /\bnew\b/i,
];

const FACE_LOCK_HINTS = [
  /얼굴/, /face/i, /identity/i, /같은 사람/, /동일 인물/, /동일\s*인물/,
];

const KOREAN_FACE_LOCK =
  "얼굴은 레퍼런스 이미지와 100% 동일하게 유지(같은 사람, 같은 이목구비, 같은 눈/코/입/턱선/피부톤). 다시 그리거나 스타일라이즈하지 말 것.";

const ENGLISH_FACE_LOCK =
  "Keep the face IDENTICAL to the reference image (same individual, same facial features, same eye shape, same nose, same lip contour, same jawline, same skin tone). Do not redraw or stylize the face.";

const KOREAN_RE = /[가-힣]/;

function looksLikeVariationCommand(text) {
  return VARIATION_HINTS.some((re) => re.test(text));
}

function alreadyHasFaceLock(text) {
  return FACE_LOCK_HINTS.some((re) => re.test(text));
}

// Decide whether to boost. Returns true when:
//   - prompt is short (<= 40 chars), OR
//   - prompt looks like a variation command,
//   AND the prompt does not already contain face-lock language.
export function shouldBoostRefPrompt(prompt) {
  if (typeof prompt !== "string") return false;
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (alreadyHasFaceLock(trimmed)) return false;
  if (trimmed.length <= 40) return true;
  if (looksLikeVariationCommand(trimmed)) return true;
  return false;
}

// Append the face-lock cue to a reference-mode prompt. Caller MUST verify
// that a reference image is attached before invoking this.
export function boostRefPrompt(prompt) {
  if (typeof prompt !== "string") return prompt;
  if (!shouldBoostRefPrompt(prompt)) return prompt;
  const trimmed = prompt.trim();
  const isKo = KOREAN_RE.test(trimmed);
  const lock = isKo ? KOREAN_FACE_LOCK : ENGLISH_FACE_LOCK;
  return `${trimmed}\n\n${lock}`;
}
