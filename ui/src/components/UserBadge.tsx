import { useAppStore } from "../store/useAppStore";

// Tiny floating badge in the top-right corner: shows the logged-in user
// and exposes a logout action. Rendered only when auth is enabled and we
// have a user — kept out of the way otherwise so legacy single-user
// installs (IMA2_AUTH != "enabled") look unchanged.
export function UserBadge() {
  const auth = useAppStore((s) => s.auth);
  const logout = useAppStore((s) => s.logout);

  if (auth.status !== "authed" || !auth.authEnabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 14,
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "4px 10px 4px 12px",
        fontSize: 12,
        color: "var(--text)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        opacity: 0.9,
      }}
    >
      <span style={{ color: "var(--text-dim)" }}>👤</span>
      <span style={{ fontWeight: 500 }}>{auth.user.username}</span>
      <button
        type="button"
        onClick={() => void logout()}
        title="로그아웃"
        style={{
          background: "transparent",
          color: "var(--text-dim)",
          border: "1px solid var(--border)",
          borderRadius: 999,
          padding: "1px 8px",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
