import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

interface QuotaWindow {
  label: string;
  percent: number;
  resetsAt: string | null;
}

interface QuotaResult {
  provider: string;
  account?: { email: string | null; plan: string | null } | null;
  windows: QuotaWindow[];
  error?: boolean;
  authenticated?: boolean;
  billing?: { usedUsd: number; limitUsd: number };
}

interface QuotaResponse {
  codex?: QuotaResult;
  grok?: QuotaResult;
}

interface SwitchState {
  phase: "idle" | "starting" | "waiting" | "complete" | "error";
  userCode?: string;
  verificationUrl?: string;
  sessionId?: string;
  error?: string;
}

function barColor(pct: number): string {
  if (pct > 80) return "var(--error, #e53935)";
  if (pct > 50) return "var(--warning, #f59e0b)";
  return "var(--info, #3b82f6)";
}

function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function CodexIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.049 6.049 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.612-1.5z" />
    </svg>
  );
}

function GrokIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true">
      <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
    </svg>
  );
}

function QuotaBar({ window: w }: { window: QuotaWindow }) {
  const reset = formatReset(w.resetsAt);
  return (
    <div className="quota-bar">
      <span className="quota-bar__label">{w.label}</span>
      <div className="quota-bar__track">
        <div
          className="quota-bar__fill"
          style={{ width: `${Math.min(w.percent, 100)}%`, background: barColor(w.percent) }}
        />
      </div>
      <span className="quota-bar__pct">{w.percent}%</span>
      {reset && <span className="quota-bar__reset">{reset}</span>}
    </div>
  );
}

function SwitchAccountButton({ provider, onComplete }: { provider: "grok" | "codex"; onComplete: () => void }) {
  const [state, setState] = useState<SwitchState>({ phase: "idle" });
  const switching = useRef(false);

  const startSwitch = useCallback(async () => {
    if (switching.current) return;
    switching.current = true;
    setState({ phase: "starting" });
    try {
      const res = await fetch("/api/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        setState({ phase: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }
      const data = await res.json() as { sessionId: string; userCode: string; verificationUrl: string };
      setState({ phase: "waiting", ...data });
      window.open(data.verificationUrl, "_blank");
    } catch (e) {
      switching.current = false;
      setState({ phase: "error", error: (e as Error).message });
    }
  }, [provider]);

  useEffect(() => {
    if (state.phase !== "waiting" || !state.sessionId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/switch/${state.sessionId}`);
        const data = await res.json() as { status: string; error?: string };
        if (cancelled) return;
        if (data.status === "complete") {
          setState({ phase: "complete" });
          setTimeout(onComplete, 1000);
          return;
        }
        if (data.status === "error" || data.status === "expired") {
          setState({ phase: "error", error: data.error || data.status });
          return;
        }
      } catch { /* retry */ }
      if (!cancelled) setTimeout(poll, 3000);
    };
    const timer = setTimeout(poll, 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [state.phase, state.sessionId, onComplete]);

  if (state.phase === "idle") {
    return (
      <button
        type="button"
        className="settings-action-btn"
        style={{ width: "100%", marginTop: "6px" }}
        onClick={startSwitch}
      >
        Switch {provider === "grok" ? "Grok" : "Codex"} Account
      </button>
    );
  }

  if (state.phase === "starting") {
    return (
      <div className="quota-card__hint" style={{ textAlign: "center", marginTop: "6px" }}>
        Starting login...
      </div>
    );
  }

  if (state.phase === "waiting") {
    return (
      <div style={{ marginTop: "6px", padding: "8px", background: "var(--surface, #f5f5f5)", borderRadius: "6px", fontSize: "12px" }}>
        <div style={{ textAlign: "center", marginBottom: "4px" }}>
          Enter this code in the opened tab:
        </div>
        <div style={{ textAlign: "center", fontSize: "18px", fontWeight: 700, fontFamily: "monospace", letterSpacing: "2px", margin: "6px 0" }}>
          {state.userCode}
        </div>
        <div style={{ textAlign: "center", color: "var(--text-dim, #888)", fontSize: "11px" }}>
          Waiting for approval...
        </div>
      </div>
    );
  }

  if (state.phase === "complete") {
    return (
      <div className="quota-card__hint" style={{ textAlign: "center", marginTop: "6px", color: "var(--success, #22c55e)" }}>
        Account switched! Refreshing...
      </div>
    );
  }

  return (
    <div style={{ marginTop: "6px" }}>
      <div className="quota-card__hint" style={{ color: "var(--error, #e53935)", marginBottom: "4px" }}>
        {state.error || "Switch failed"}
      </div>
      <button
        type="button"
        className="settings-action-btn"
        style={{ width: "100%", fontSize: "11px" }}
        onClick={() => { switching.current = false; setState({ phase: "idle" }); }}
      >
        Try again
      </button>
    </div>
  );
}

export function QuotaCard() {
  const { t } = useI18n();
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshQuota = useCallback(() => {
    setLoading(true);
    fetch("/api/quota")
      .then((r) => r.json() as Promise<QuotaResponse>)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(refreshQuota, 1500);
    return () => clearTimeout(timer);
  }, [refreshQuota]);

  const codex = data?.codex;
  const grok = data?.grok;
  const hasCodexWindows = codex?.windows && codex.windows.length > 0;
  const hasGrokWindows = grok?.windows && grok.windows.length > 0;
  const accountLine = codex?.account
    ? [codex.account.email, codex.account.plan].filter(Boolean).join(" · ")
    : null;
  const grokAccountLine = grok?.account
    ? [grok.account.email, grok.account.plan].filter(Boolean).join(" · ")
    : null;

  return (
    <article className="settings-row">
      <div className="settings-row__copy">
        <p className="settings-eyebrow">{t("settings.quota.eyebrow")}</p>
        <h4>{t("settings.quota.title")}</h4>
      </div>
      <div className="settings-row__control quota-cards">
        <div className="quota-card">
          <div className="quota-card__header">
            <CodexIcon />
            <strong>Codex</strong>
            {accountLine && <span className="quota-card__account">{accountLine}</span>}
          </div>
          {loading ? (
            <span className="quota-card__loading">{t("common.loading")}</span>
          ) : hasCodexWindows ? (
            codex!.windows.map((w) => <QuotaBar key={w.label} window={w} />)
          ) : codex?.authenticated === false ? (
            <span className="quota-card__hint">{t("settings.quota.codexNotLoggedIn")}</span>
          ) : codex?.error ? (
            <span className="quota-card__hint">{t("settings.quota.fetchError")}</span>
          ) : (
            <span className="quota-card__hint">{t("settings.quota.noData")}</span>
          )}
          <SwitchAccountButton provider="codex" onComplete={refreshQuota} />
        </div>

        <div className="quota-card">
          <div className="quota-card__header" style={{ display: "flex", alignItems: "center" }}>
            <GrokIcon />
            <strong>Grok</strong>
            {grokAccountLine && <span className="quota-card__account">{grokAccountLine}</span>}
            {grok?.billing && (
              <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-dim, #888)", whiteSpace: "nowrap" }}>
                ${grok.billing.usedUsd.toFixed(1)}/${grok.billing.limitUsd}
              </span>
            )}
          </div>
          {loading ? (
            <span className="quota-card__loading">{t("common.loading")}</span>
          ) : hasGrokWindows ? (
            grok!.windows.map((w) => <QuotaBar key={w.label} window={w} />)
          ) : grok?.authenticated === false ? (
            <span className="quota-card__hint">Not logged in</span>
          ) : (
            <a
              href="https://grok.com/?_s=usage"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-action-btn"
            >
              {t("settings.quota.grokUsageLink")}
            </a>
          )}
          <SwitchAccountButton provider="grok" onComplete={refreshQuota} />
        </div>
      </div>
    </article>
  );
}
