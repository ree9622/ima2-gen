import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";

const TOAST_AUTO_DISMISS_MS = 8000;

export function Toast() {
  const toastLog = useAppStore((s) => s.toastLog);
  const dismissToast = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (toastLog.length === 0) return;
    const timers = toastLog.map((toast) => {
      const elapsed = Date.now() - toast.createdAt;
      const delay = Math.max(1200, TOAST_AUTO_DISMISS_MS - elapsed);
      return window.setTimeout(() => dismissToast(toast.id), delay);
    });
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [dismissToast, toastLog]);

  if (toastLog.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toastLog.map((toast) => {
        const cls = ["toast", toast.error ? "error" : ""].filter(Boolean).join(" ");
        return (
          <div className={cls} key={toast.id}>
            <span className="toast__message">{toast.message}</span>
            <button
              type="button"
              className="toast__dismiss"
              aria-label="알림 닫기"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
