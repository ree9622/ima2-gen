import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useOAuthStatus } from "../hooks/useOAuthStatus";
import { useBilling } from "../hooks/useBilling";
import { useGrokStatus } from "../hooks/useGrokStatus";
import { ApiDisabledModal } from "./ApiDisabledModal";
import type { Provider } from "../types";
import { useI18n } from "../i18n";

type ProviderAvailability = {
  ok: boolean;
  reason: string;
  hint?: string;
};

export function useProviderAvailability(): Record<Provider, ProviderAvailability> {
  const { t } = useI18n();
  const oauth = useOAuthStatus();
  const { data } = useBilling();
  const grok = useGrokStatus();

  const oauthReady = oauth?.status === "ready";
  let oauthReason = t("provider.oauthNotReady");
  let oauthHint: string | undefined;
  if (oauth?.status === "auth_required") {
    oauthReason = t("provider.codexLoginRequired");
    oauthHint = t("provider.codexLoginHint");
  } else if (oauth?.status === "starting") {
    oauthReason = t("provider.oauthStarting");
  } else if (!oauth) {
    oauthReason = t("provider.serverUnreachable");
  }

  const apiOk = data?.apiKeyValid === true;

  const grokReady = grok?.status === "ready";
  const grokReason = !grok
    ? t("provider.grokNotReady")
    : grok.status === "offline"
      ? t("provider.grokOffline")
      : grok.status === "no_image_model"
        ? t("provider.grokNoImageModel")
        : grok.status === "error"
          ? t("provider.grokNotReady")
          : "";

  return {
    oauth: { ok: oauthReady, reason: oauthReason, hint: oauthHint },
    api: {
      ok: apiOk,
      reason: apiOk ? "" : t("provider.apiInvalid"),
    },
    grok: {
      ok: grokReady,
      reason: grokReason,
      hint: grokReady ? undefined : t("provider.grokOfflineHint"),
    },
  };
}

type ProviderSelectProps = {
  allowGrok?: boolean;
};

export function ProviderSelect({ allowGrok = true }: ProviderSelectProps) {
  const { t } = useI18n();
  const provider = useAppStore((s) => s.provider);
  const setProvider = useAppStore((s) => s.setProvider);
  const availability = useProviderAvailability();
  const [blocked, setBlocked] = useState<Provider | null>(null);

  const PROVIDERS: { value: Provider; label: string }[] = [
    { value: "oauth", label: "GPT OAuth" },
    { value: "api", label: t("provider.apiLabel") },
    { value: "grok", label: "Grok" },
  ];

  const providerAvailability = {
    ...availability,
    grok: allowGrok
      ? availability.grok
      : { ok: false, reason: t("provider.grokClassicOnly"), hint: t("provider.grokClassicOnlyHint") },
  };

  const handleClick = (p: Provider) => {
    if (providerAvailability[p].ok) {
      setProvider(p);
    } else {
      setBlocked(p);
    }
  };

  const blockedInfo = blocked
    ? { label: PROVIDERS.find((x) => x.value === blocked)!.label, ...providerAvailability[blocked] }
    : null;

  return (
    <>
      <div className="section-title">{t("provider.authTitle")}</div>
      <div className="provider-row">
        {PROVIDERS.map((p) => {
          const selected = provider === p.value;
          const ok = providerAvailability[p.value].ok;
          return (
            <button
              key={p.value}
              type="button"
              className={`provider-pill${selected ? " selected" : ""}`}
              onClick={() => handleClick(p.value)}
              title={ok ? t("provider.availableTitle", { name: p.label }) : providerAvailability[p.value].reason}
              aria-label={ok ? t("provider.availableAria", { name: p.label }) : t("provider.unavailableAria", { name: p.label })}
              aria-pressed={selected}
            >
              <span
                className={`status-dot ${ok ? "status-dot--ok" : "status-dot--bad"}`}
                aria-hidden="true"
              />
              <span>{p.label}</span>
              <span className="sr-only">{ok ? t("provider.availableSr") : t("provider.unavailableSr")}</span>
            </button>
          );
        })}
      </div>
      {provider === "grok" ? (
        <p className="provider-helper">{t("provider.grokManagedByIma2")}</p>
      ) : null}
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
