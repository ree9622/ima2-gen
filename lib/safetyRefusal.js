import { parseSafetyViolation } from "./safetyRetry.js";

const REFUSAL_CODES = new Set([
  "SAFETY_REFUSAL", "SAFETY_UNRECOVERABLE", "content_policy_violation",
  "moderation_blocked", "safety_violation",
]);
const REFUSAL_MESSAGE = /rejected by (?:the )?safety system|safety_violations\s*=\s*\[|content_policy_violation|blocked by (?:the )?(?:safety|moderation)|violat(?:es|ed|ion of) (?:our |the )?content polic/i;

export function isSafetyRefusal(error) {
  if (!error) return false;
  if ([error.code, error.upstreamCode].some((code) => REFUSAL_CODES.has(code))) return true;
  return Boolean(error.refusalText) || REFUSAL_MESSAGE.test(
    typeof error === "string" ? error : (error.message || ""),
  );
}

// Safety decisions are terminal. Preserve upstream evidence for support;
// never cycle prompts, accounts, or rewrite tiers after a policy rejection.
export function throwIfSafetyRefusal(error, attempts) {
  if (!isSafetyRefusal(error)) return;
  const stop = new Error(
    "안전 정책에 따라 이미지 생성이 거절됐습니다. 같은 요청의 자동 재시도를 중단했습니다. " +
    "프롬프트를 수정해주세요.\n" + (error.refusalText || error.message || String(error)),
  );
  stop.code = "SAFETY_REFUSAL";
  stop.status = 422;
  stop.cause = error;
  stop.attempts = attempts;
  stop.promptRuntime = error.promptRuntime || attempts.at(-1)?.promptRuntime || null;
  const violation = parseSafetyViolation(error);
  if (violation) stop.violationCategories = Array.from(violation.categories);
  const last = attempts.at(-1);
  if (last) last.errorCode = stop.code;
  throw stop;
}
