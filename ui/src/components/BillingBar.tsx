import { useEffect, useMemo, useState } from "react";
import { useBilling } from "../hooks/useBilling";
import { useAppStore } from "../store/useAppStore";

const WINDOW_MS = 5 * 60 * 60 * 1000; // 5h — matches the typical Codex/ChatGPT cap window
const QUOTA_HINT = (() => {
  // Optional user-supplied hint for "how many images per 5h" their plan
  // allows. Set via VITE_IMA2_QUOTA_5H at build time, or
  // localStorage["ima2.quota5h"] at runtime. Falsy = render count only.
  if (typeof window !== "undefined") {
    try {
      const ls = window.localStorage.getItem("ima2.quota5h");
      if (ls) {
        const n = Number(ls);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {}
  }
  const env = (import.meta.env as Record<string, string | undefined>).VITE_IMA2_QUOTA_5H;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
})();

export function BillingBar() {
  const { data, error } = useBilling();
  const history = useAppStore((s) => s.history);
  const usageLimitedUntil = useAppStore((s) => s.usageLimitedUntil);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const recentCount = useMemo(() => {
    const cutoff = now - WINDOW_MS;
    return history.reduce(
      (acc, h) => (h.createdAt && h.createdAt >= cutoff ? acc + 1 : acc),
      0,
    );
  }, [history, now]);
  const cooling = !!(usageLimitedUntil && usageLimitedUntil > now);

  let text = "확인 중...";
  let color = "var(--text-dim)";

  if (error || !data) {
    if (error) {
      text = "오프라인";
      color = "var(--red)";
    }
  } else if (data.credits) {
    const total = data.credits.total_granted ?? 0;
    const used = data.credits.total_used ?? 0;
    const remaining = total - used;
    text = `$${remaining.toFixed(2)} 남음`;
    color =
      remaining > 5
        ? "var(--green)"
        : remaining > 1
        ? "var(--amber)"
        : "var(--red)";
  } else if (data.costs?.data?.length) {
    const totalCost = data.costs.data.reduce((sum, bucket) => {
      return sum + bucket.results.reduce((s, r) => s + (r.amount?.value ?? 0), 0);
    }, 0);
    text = `이번 달 $${(totalCost / 100).toFixed(2)}`;
    color = "var(--accent)";
  } else if (data.oauth) {
    text = "OAuth 무료 사용 가능";
    color = "var(--green)";
  } else if (data.apiKeyValid) {
    text = "API 키 비활성화됨 (OAuth 전용)";
    color = "var(--text-dim)";
  } else {
    text = "OAuth 모드";
    color = "var(--text-dim)";
  }

  // Approximation: pull the cap from VITE_IMA2_QUOTA_5H or
  // localStorage["ima2.quota5h"]. We deliberately don't ship a hard-coded
  // ChatGPT/Codex limit because OpenAI changes it per plan — the user knows
  // their own ceiling.
  const usageColor = cooling
    ? "var(--red)"
    : QUOTA_HINT && recentCount >= QUOTA_HINT
      ? "var(--red)"
      : QUOTA_HINT && recentCount >= QUOTA_HINT * 0.8
        ? "var(--amber)"
        : "var(--text)";
  const usageText = cooling
    ? `한도 도달 · cool-down 중`
    : QUOTA_HINT
      ? `${recentCount} / ${QUOTA_HINT} (5시간)`
      : `${recentCount}장 (최근 5시간)`;

  return (
    <div className="billing-bar">
      <div className="label">API 상태</div>
      <div className="value" style={{ color }}>
        {text}
      </div>
      <div className="label" style={{ marginTop: 4 }}>최근 사용량</div>
      <div className="value" style={{ color: usageColor }} title="사이드카 createdAt 기준 5시간 윈도우">
        {usageText}
      </div>
    </div>
  );
}
