import { useState, type FormEvent } from "react";
import { useAppStore } from "../store/useAppStore";

// Single-purpose login screen. Rendered by App when auth.status ===
// "anonymous". On success the store flips auth.status to "authed" and App
// re-renders the main UI.
export function LoginPage() {
  const login = useAppStore((s) => s.login);
  const loginError = useAppStore((s) => s.loginError);
  const loginPending = useAppStore((s) => s.loginPending);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
    // store handles success/error state; on success App un-mounts us.
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--text)",
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 28,
          width: "100%",
          maxWidth: 360,
          boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>ima2-gen 로그인</h2>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
            관리자가 발급한 계정으로 접속하세요.
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>사용자명</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={loginPending}
            maxLength={32}
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loginPending}
            style={{
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 14,
            }}
          />
        </label>

        {loginError && (
          <div
            role="alert"
            style={{
              background: "rgba(255,80,80,0.12)",
              border: "1px solid rgba(255,80,80,0.4)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 12,
              color: "#ffd0d0",
            }}
          >
            {loginError}
          </div>
        )}

        <button
          type="submit"
          disabled={loginPending || !username.trim() || !password}
          style={{
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            borderRadius: 6,
            padding: "9px 14px",
            fontSize: 14,
            fontWeight: 600,
            cursor: loginPending ? "wait" : "pointer",
            opacity: loginPending || !username.trim() || !password ? 0.6 : 1,
            marginTop: 4,
          }}
        >
          {loginPending ? "확인 중…" : "로그인"}
        </button>

        <div style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
          계정이 필요하면 관리자에게 요청하세요. (CLI: <code>ima2-user add</code>)
        </div>
      </form>
    </div>
  );
}
