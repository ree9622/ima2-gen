import { useBilling } from "../hooks/useBilling";
import { useGrokStatus } from "../hooks/useGrokStatus";
import { useOAuthStatus } from "../hooks/useOAuthStatus";
import { useI18n } from "../i18n";

function statusLabel(t: (key: string) => string, status?: string): string {
  if (status === "ready") return t("settings.account.status.ready");
  if (status === "auth_required") return t("settings.account.status.authRequired");
  if (status === "starting") return t("settings.account.status.starting");
  if (status === "offline") return t("settings.account.status.offline");
  if (status === "no_image_model") return t("settings.account.status.noImageModel");
  if (status === "error") return t("settings.account.status.error");
  return t("settings.account.status.checking");
}

export function AccountSettings() {
  const { t } = useI18n();
  const oauth = useOAuthStatus();
  const grok = useGrokStatus();
  const { data, error } = useBilling();
  const showApiKeyCard =
    data?.apiKeySource === "env" ||
    data?.apiKeySource === "config" ||
    data?.apiKeyValid === true;
  const oauthReady = oauth?.status === "ready";
  const apiSource =
    data?.apiKeySource === "config"
      ? t("settings.account.apiSourceConfig")
      : t("settings.account.apiSourceEnv");
  const apiReady = data?.apiKeyValid === true;
  const grokReady = grok?.status === "ready";

  return (
    <>
      <article className="settings-row">
        <div className="settings-row__copy">
          <p className="settings-eyebrow">{t("settings.account.primaryEyebrow")}</p>
          <h4>{t("settings.account.oauthTitle")}</h4>
          <p>{t("settings.account.oauthBody")}</p>
        </div>
        <div className={`settings-status${oauthReady ? " is-ok" : ""}`}>
          <span aria-hidden="true" />
          {statusLabel(t, oauth?.status)}
        </div>
      </article>

      {showApiKeyCard ? (
        <article className="settings-row">
          <div className="settings-row__copy">
            <p className="settings-eyebrow">{apiSource}</p>
            <h4>{t("settings.account.apiTitle")}</h4>
            <p>{t("settings.account.apiBody")}</p>
          </div>
          <div className={`settings-status${apiReady ? " is-ok" : " is-muted"}`}>
            <span aria-hidden="true" />
            {error
              ? t("settings.account.apiUnknown")
              : apiReady
                ? t("settings.account.apiReady")
                : t("settings.account.apiUnavailable")}
          </div>
        </article>
      ) : null}

      <article className="settings-row">
        <div className="settings-row__copy">
          <p className="settings-eyebrow">{t("settings.account.grokEyebrow")}</p>
          <h4>{t("settings.account.grokTitle")}</h4>
          <p>{t("settings.account.grokBody")}</p>
        </div>
        <div className={`settings-status${grokReady ? " is-ok" : " is-muted"}`}>
          <span aria-hidden="true" />
          {statusLabel(t, grok?.status)}
        </div>
      </article>
    </>
  );
}
