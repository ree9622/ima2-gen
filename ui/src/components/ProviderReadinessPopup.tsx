import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { useProviderAvailability } from "./ProviderSelect";

export function ProviderReadinessPopup() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.readinessPopupOpen);
  const close = useAppStore((s) => s.closeReadinessPopup);
  const openSettings = useAppStore((s) => s.openSettings);
  const provider = useAppStore((s) => s.provider);
  const imageModel = useAppStore((s) => s.imageModel);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const webSearchEnabled = useAppStore((s) => s.webSearchEnabled);
  const availability = useProviderAvailability();

  if (!open) return null;
  const current = availability[provider];
  const ready = current.ok;

  const goAccount = () => {
    close();
    openSettings("account");
  };

  return (
    <div className="modal-backdrop provider-readiness-backdrop" onClick={close} role="presentation">
      <div
        className="modal provider-readiness"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-readiness-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div id="provider-readiness-title" className="modal__title">
          {t("readiness.title")}
        </div>
        <div className="modal__body provider-readiness__body">
          <div className={`provider-readiness__status${ready ? " is-ok" : " is-blocked"}`}>
            <span aria-hidden="true" />
            <strong>{ready ? t("readiness.ready") : t("readiness.blocked")}</strong>
            <small>{ready ? t("readiness.readyBody") : current.reason}</small>
          </div>
          {current.hint ? <p className="modal__hint">{current.hint}</p> : null}
          <dl className="provider-readiness__facts">
            <div>
              <dt>{t("readiness.provider")}</dt>
              <dd>{provider === "oauth" ? "OAuth" : t("provider.apiLabel")}</dd>
            </div>
            <div>
              <dt>{t("readiness.model")}</dt>
              <dd>{imageModel}</dd>
            </div>
            <div>
              <dt>{t("readiness.reasoning")}</dt>
              <dd>{reasoningEffort}</dd>
            </div>
            <div>
              <dt>{t("readiness.webSearch")}</dt>
              <dd>{webSearchEnabled ? t("settings.webSearch.on") : t("settings.webSearch.off")}</dd>
            </div>
          </dl>
        </div>
        <div className="modal__actions">
          <button type="button" className="modal__btn modal__btn--secondary" onClick={close}>
            {t("common.close")}
          </button>
          <button type="button" className="modal__btn" onClick={goAccount}>
            {t("readiness.openAccount")}
          </button>
        </div>
      </div>
    </div>
  );
}
