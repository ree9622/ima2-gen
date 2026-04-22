import { useEffect } from "react";

type Props = {
  open: boolean;
  providerLabel: string;
  reason: string;
  hint?: string;
  onClose: () => void;
};

export function ApiDisabledModal({ open, providerLabel, reason, hint, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${providerLabel} unavailable`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__title">{providerLabel} unavailable</div>
        <div className="modal__body">
          <p>{reason}</p>
          {hint ? <p className="modal__hint">{hint}</p> : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="modal__btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
