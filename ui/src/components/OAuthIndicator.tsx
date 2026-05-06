import { useOAuthStatus } from "../hooks/useOAuthStatus";

// Header dot indicator. The full ProviderSelect card still mounts when
// OAuth isn't ready (so the user gets the actual error/hint), but the
// 99% steady-state "ready" case collapses to this 8px dot — freeing up
// ~80px of vertical sidebar real estate.
export function OAuthIndicator() {
  const oauth = useOAuthStatus();
  const status = oauth?.status;
  const tone = status === "ready" ? "ok" : status === "starting" ? "warn" : "bad";
  const label =
    status === "ready"
      ? "OAuth 연결됨"
      : status === "starting"
        ? "OAuth 준비 중"
        : status === "auth_required"
          ? "로그인 필요 — 'codex login'"
          : status === "offline"
            ? "OAuth 프록시 오프라인"
            : "OAuth 상태 확인 중";

  return (
    <span
      className={`oauth-dot oauth-dot--${tone}`}
      title={label}
      aria-label={label}
      role="status"
    />
  );
}
