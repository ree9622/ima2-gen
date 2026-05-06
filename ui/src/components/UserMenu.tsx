import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

// Header user button → popover. Replaces the bottom UserBadge card,
// freeing vertical space and putting account actions where users expect
// them (top-right). Click outside / Escape closes.
export function UserMenu() {
  const auth = useAppStore((s) => s.auth);
  const logout = useAppStore((s) => s.logout);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (auth.status !== "authed" || !auth.authEnabled) return null;
  const username = auth.user.username;
  const initial = (username || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="user-menu">
      <button
        type="button"
        className="user-menu__btn"
        onClick={() => setOpen((v) => !v)}
        title={username}
        aria-label={`사용자: ${username}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {initial}
      </button>
      {open && (
        <>
          <div
            className="user-menu__overlay"
            onClick={() => setOpen(false)}
            role="presentation"
          />
          <div className="user-menu__pop" role="menu">
            <div className="user-menu__name" title={username}>
              {username}
            </div>
            <button
              type="button"
              className="user-menu__logout"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              role="menuitem"
            >
              로그아웃
            </button>
          </div>
        </>
      )}
    </div>
  );
}
