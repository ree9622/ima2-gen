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
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--accent)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              marginBottom: 8,
            }}
          >
            SAMLAB INTERNAL
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            SamLab 내부 이미지 생성기
          </h1>
          <div
            aria-label="접속 주소"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 5,
            }}
          >
            images.samlab.click
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)", margin: "10px 0 0" }}>
            SamLab에서 발급한 이 서비스 전용 계정으로 로그인하세요.
          </p>
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

        <div
          role="note"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "9px 10px",
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--text-dim)",
          }}
        >
          <strong style={{ color: "var(--text)" }}>보안 안내</strong>
          <br />
          다른 서비스에서 사용하는 비밀번호를 재사용하지 마세요.
        </div>

        <div style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
          계정이 필요하면 SamLab 관리자에게 요청하세요.
        </div>
      </form>
    </div>
  );
}
