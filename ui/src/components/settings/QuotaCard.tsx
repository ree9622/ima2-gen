import { useEffect, useState } from "react";
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
}

interface QuotaResponse {
  codex?: QuotaResult;
}

function barColor(pct: number): string {
  if (pct > 80) return "var(--error, #e53935)";
  if (pct > 50) return "var(--warning, #f59e0b)";
  return "var(--info, #3b82f6)";
}

function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
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

export function QuotaCard() {
  const { t } = useI18n();
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/quota")
        .then((r) => r.json() as Promise<QuotaResponse>)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const codex = data?.codex;
  const hasCodexWindows = codex?.windows && codex.windows.length > 0;
  const accountLine = codex?.account
    ? [codex.account.email, codex.account.plan].filter(Boolean).join(" · ")
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
        </div>

        <div className="quota-card">
          <div className="quota-card__header">
            <strong>Grok</strong>
          </div>
          <a
            href="https://grok.com/?_s=usage"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-action-btn"
          >
            {t("settings.quota.grokUsageLink")}
          </a>
        </div>
      </div>
    </article>
  );
}
