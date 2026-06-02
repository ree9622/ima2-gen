import { useState } from "react";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { useOAuthStatus } from "../hooks/useOAuthStatus";
import { useGrokStatus } from "../hooks/useGrokStatus";
import { useKeyStatus } from "../hooks/useKeyStatus";

const DISMISS_KEY = "ima2.onboardingDismissed";

// First-run welcome popup. Shows only when GPT(oauth), Grok, AND Gemini are
// ALL unauthenticated, and only until the user dismisses it once (localStorage).
export function OnboardingPopup() {
  const { t } = useI18n();
  const openSettings = useAppStore((s) => s.openSettings);
  const oauth = useOAuthStatus();
  const grok = useGrokStatus();
  const { data: keyStatus } = useKeyStatus();

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Only decide once every status has loaded — avoid a flash while null/loading.
  const loaded = oauth !== null && grok !== null && keyStatus != null;
  const oauthUnauth = oauth?.status === "auth_required" || oauth?.status === "offline";
  const grokUnauth = grok?.status === "offline" || grok?.status === "error";
  const geminiUnauth = keyStatus
    ? !keyStatus.gemini?.configured && !keyStatus.vertex?.configured
    : false;
  const allUnauthenticated = loaded && oauthUnauth && grokUnauth && geminiUnauth;

  if (dismissed || !allUnauthenticated) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore storage errors */
    }
    setDismissed(true);
  };

  const goLogin = () => {
    dismiss();
    openSettings("account");
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div id="onboarding-title" className="modal__title">
          {t("onboarding.title")}
        </div>
        <div className="modal__body">
          <p>{t("onboarding.body")}</p>
        </div>
        <div className="modal__actions">
          <button type="button" className="modal__btn modal__btn--secondary" onClick={dismiss}>
            {t("onboarding.skip")}
          </button>
          <button type="button" className="modal__btn" onClick={goLogin}>
            {t("onboarding.login")}
          </button>
        </div>
      </div>
    </div>
  );
}
