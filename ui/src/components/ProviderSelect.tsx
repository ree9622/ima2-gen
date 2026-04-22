import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useOAuthStatus } from "../hooks/useOAuthStatus";
import { useBilling } from "../hooks/useBilling";
import { ApiDisabledModal } from "./ApiDisabledModal";
import type { Provider } from "../types";

type ProviderAvailability = {
  ok: boolean;
  reason: string;
  hint?: string;
};

function useProviderAvailability(): Record<Provider, ProviderAvailability> {
  const oauth = useOAuthStatus();
  const { data } = useBilling();

  const oauthReady = oauth?.status === "ready";
  let oauthReason = "OAuth proxy not ready yet.";
  let oauthHint: string | undefined;
  if (oauth?.status === "auth_required") {
    oauthReason = "Codex login required.";
    oauthHint = "Run `codex login` in a terminal, then reload this page.";
  } else if (oauth?.status === "starting") {
    oauthReason = "OAuth proxy is starting. Wait a few seconds and try again.";
  } else if (!oauth) {
    oauthReason = "Cannot reach the server. Check that the backend is running.";
  }

  const apiOk = data?.apiKeyValid === true;

  return {
    oauth: { ok: oauthReady, reason: oauthReason, hint: oauthHint },
    api: {
      ok: apiOk,
      reason: apiOk
        ? ""
        : "API key is not configured or invalid. Set OPENAI_API_KEY in the server .env file.",
    },
  };
}

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "oauth", label: "OAuth" },
  { value: "api", label: "API Key" },
];

export function ProviderSelect() {
  const provider = useAppStore((s) => s.provider);
  const setProvider = useAppStore((s) => s.setProvider);
  const availability = useProviderAvailability();
  const [blocked, setBlocked] = useState<Provider | null>(null);

  const handleClick = (p: Provider) => {
    if (availability[p].ok) {
      setProvider(p);
    } else {
      setBlocked(p);
    }
  };

  const blockedInfo = blocked
    ? { label: PROVIDERS.find((x) => x.value === blocked)!.label, ...availability[blocked] }
    : null;

  return (
    <>
      <div className="section-title">Provider</div>
      <div className="provider-row">
        {PROVIDERS.map((p) => {
          const selected = provider === p.value;
          const ok = availability[p.value].ok;
          return (
            <button
              key={p.value}
              type="button"
              className={`provider-pill${selected ? " selected" : ""}`}
              onClick={() => handleClick(p.value)}
              title={ok ? `${p.label} ready` : availability[p.value].reason}
              aria-label={`${p.label}: ${ok ? "ready" : "unavailable"}`}
              aria-pressed={selected}
            >
              <span
                className={`status-dot ${ok ? "status-dot--ok" : "status-dot--bad"}`}
                aria-hidden="true"
              />
              <span>{p.label}</span>
              <span className="sr-only">{ok ? "(ready)" : "(unavailable)"}</span>
            </button>
          );
        })}
      </div>
      <ApiDisabledModal
        open={!!blockedInfo}
        providerLabel={blockedInfo?.label ?? ""}
        reason={blockedInfo?.reason ?? ""}
        hint={blockedInfo?.hint}
        onClose={() => setBlocked(null)}
      />
    </>
  );
}
