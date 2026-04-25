import { useAppStore } from "../store/useAppStore";

function truncate(s: string, max = 28) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

const PHASE_LABEL: Record<string, string> = {
  queued: "대기 중",
  streaming: "생성 중",
  decoding: "마무리 중",
};

function formatElapsed(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const sec = ms / 1000;
  if (sec < 10) return `${sec.toFixed(1)}초`;
  return `${Math.round(sec)}초`;
}

function statusLabel(status: string | undefined, phase: string | undefined): string {
  switch (status) {
    case "success":
      return "완료";
    case "error":
      return "실패";
    case "running":
    default:
      return phase ? PHASE_LABEL[phase] ?? phase : "대기 중";
  }
}

export function InFlightList() {
  const inFlight = useAppStore((s) => s.inFlight);
  const dismissActivity = useAppStore((s) => s.dismissActivity);
  const clearActivityHistory = useAppStore((s) => s.clearActivityHistory);
  const retryActivity = useAppStore((s) => s.retryActivity);
  const cancelActivity = useAppStore((s) => s.cancelActivity);
  const selectActivity = useAppStore((s) => s.selectActivity);

  if (inFlight.length === 0) return null;

  const hasTerminal = inFlight.some((f) => (f.status ?? "running") !== "running");

  return (
    <div className="activity-log">
      {hasTerminal && (
        <div className="activity-log-header">
          <span className="activity-log-title">최근 생성</span>
          <button
            type="button"
            className="activity-log-clear"
            onClick={() => clearActivityHistory()}
            title="완료/실패 항목 모두 지우기"
          >
            모두 지우기
          </button>
        </div>
      )}
      <ul className="in-flight-list">
        {inFlight.map((f) => {
          const status = (f.status ?? "running") as "running" | "success" | "error";
          const label = statusLabel(status, f.phase);
          const attemptNum = typeof f.attempt === "number" ? f.attempt : 1;
          const maxNum = typeof f.maxAttempts === "number" ? f.maxAttempts : 1;
          const isRetrying =
            status === "running" && maxNum > 1 && attemptNum > 1;
          const elapsed = status === "success" ? formatElapsed(f.elapsedMs) : "";

          const clickable = status === "success" && !!f.filename;
          return (
            <li
              key={f.id}
              className={`in-flight-item${clickable ? " in-flight-item--clickable" : ""}`}
              data-status={status}
              data-phase={f.phase ?? "queued"}
              onClick={clickable ? () => selectActivity(f.id) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectActivity(f.id);
                      }
                    }
                  : undefined
              }
            >
              <div className="in-flight-row">
                <span className="in-flight-prompt" title={f.prompt}>
                  {truncate(f.prompt, 36)}
                </span>
                <span className="in-flight-meta">
                  {isRetrying && (
                    <span
                      className="in-flight-attempt in-flight-attempt--retry"
                      title="앞선 시도가 실패해 자동 재시도 중입니다"
                    >
                      재시도 {attemptNum}/{maxNum}
                    </span>
                  )}
                  {status === "success" && elapsed && (
                    <span className="in-flight-elapsed">{elapsed}</span>
                  )}
                  <span className="in-flight-phase">{label}</span>
                  {status === "running" && (
                    <span className="in-flight-spinner" aria-hidden="true" />
                  )}
                  {status === "running" && (
                    <button
                      type="button"
                      className="in-flight-dismiss"
                      onClick={(e) => { e.stopPropagation(); cancelActivity(f.id); }}
                      title="생성 취소"
                      aria-label="생성 취소"
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
              {status === "error" && f.errorMessage && (
                <div className="in-flight-error" title={f.errorMessage}>
                  {f.errorMessage}
                </div>
              )}
              {status !== "running" && (
                <div className="in-flight-actions">
                  {status === "error" && f.retry && (
                    <button
                      type="button"
                      className="in-flight-retry"
                      onClick={(e) => { e.stopPropagation(); retryActivity(f.id); }}
                    >
                      재시도
                    </button>
                  )}
                  <button
                    type="button"
                    className="in-flight-dismiss"
                    onClick={(e) => { e.stopPropagation(); dismissActivity(f.id); }}
                    title="이 항목 지우기"
                    aria-label="이 항목 지우기"
                  >
                    ×
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
