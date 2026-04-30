import { useAppStore } from "../store/useAppStore";

// Inline user badge — rendered as a normal block at the bottom of the
// sidebar (NOT a floating fixed-position widget). The previous floating
// versions (top-right, then bottom-left) kept overlapping other UI on
// every layout the user opened (right-panel buttons, history strip,
// sidebar inflight rows). Inline placement guarantees zero overlap by
// construction — the layout reserves space for it.
//
// Rendered only when auth is enabled AND we have a user. Renders nothing
// otherwise so legacy single-user installs (IMA2_AUTH != "enabled") look
// unchanged.
export function UserBadge() {
  const auth = useAppStore((s) => s.auth);
  const logout = useAppStore((s) => s.logout);

  if (auth.status !== "authed" || !auth.authEnabled) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        margin: "4px 8px 6px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      <span style={{ color: "var(--text-dim)" }}>👤</span>
      <span style={{ flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {auth.user.username}
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        title="로그아웃"
        style={{
          background: "transparent",
          color: "var(--text-dim)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: 11,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        로그아웃
      </button>
    </div>
  );
}
