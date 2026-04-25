import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

function formatRemaining(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  }
  return `${sec}초`;
}

export function GenerateButton() {
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const generate = useAppStore((s) => s.generate);
  const usageLimitedUntil = useAppStore((s) => s.usageLimitedUntil);
  const setUsageLimitedUntil = useAppStore((s) => s.setUsageLimitedUntil);

  // Force a 1-Hz tick so the countdown label updates while we wait.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!usageLimitedUntil || usageLimitedUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [usageLimitedUntil]);
  // Auto-clear cool-down state once it elapses (so other components can
  // re-enable inputs without polling).
  useEffect(() => {
    if (!usageLimitedUntil) return;
    const remain = usageLimitedUntil - Date.now();
    if (remain <= 0) {
      setUsageLimitedUntil(null);
      return;
    }
    const t = window.setTimeout(() => setUsageLimitedUntil(null), remain + 200);
    return () => window.clearTimeout(t);
  }, [usageLimitedUntil, setUsageLimitedUntil]);

  const loading = activeGenerations > 0;
  const cooling = !!(usageLimitedUntil && usageLimitedUntil > now);
  const remainingMs = cooling ? (usageLimitedUntil as number) - now : 0;

  const label = cooling
    ? `한도 도달 · ${formatRemaining(remainingMs)} 후 재시도`
    : loading
      ? `생성 중 (${activeGenerations})`
      : "생성";

  return (
    <button
      type="button"
      className={`generate-btn${loading ? " loading" : ""}${cooling ? " cooling" : ""}`}
      onClick={() => void generate()}
      disabled={cooling}
      title={cooling ? "OpenAI 사용 한도에 도달했습니다." : undefined}
    >
      {label}
    </button>
  );
}
