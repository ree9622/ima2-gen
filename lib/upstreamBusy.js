export function isUpstreamBusy(error) {
  return error?.status === 503 && /all codex accounts busy/i.test(error.message || "");
}

export function upstreamBusyError(cause, attempts) {
  const error = new Error("이미지 생성 계정이 모두 사용 중입니다. 대기 후에도 자리가 나지 않았습니다. 잠시 후 다시 시도하거나 동시 생성 개수를 줄여주세요.");
  error.code = "UPSTREAM_BUSY";
  error.status = 503;
  error.cause = cause;
  error.attempts = attempts;
  error.promptRuntime = cause?.promptRuntime || attempts.at(-1)?.promptRuntime || null;
  return error;
}
