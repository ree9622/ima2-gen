// Express middleware: parse the session cookie, look up the user, set
// req.authUser. Unauthenticated requests get a 401 unless they hit an
// explicit allow-list (login / logout / health / static UI assets).
//
// Mounting strategy in server.js:
//   1) cookieParserMiddleware — populates req.cookies.
//   2) authMiddleware — sets req.authUser for valid sessions; returns 401
//      otherwise on protected paths.
// The two are mounted AFTER the legacy `req.authUser = X-Auth-User`
// middleware, which means session-based auth wins. Once nginx basic auth
// is removed in M3, X-Auth-User header simply stops arriving.

import { resolveSession, SESSION_COOKIE_NAME } from "./userAuth.js";

// Auth gating is OFF by default so this commit can land before the UI is
// ready (M2). Set IMA2_AUTH=enabled in systemd once the LoginPage exists.
export function isAuthEnabled() {
  return process.env.IMA2_AUTH === "enabled";
}

// Tiny cookie parser — avoids pulling in cookie-parser. RFC-flavored: we
// trim spaces, decode the value, and tolerate empty pairs. Multiple cookies
// with the same name → the first one wins (browser would dedupe before us).
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function cookieParserMiddleware(req, _res, next) {
  if (!req.cookies) {
    req.cookies = parseCookies(req.headers.cookie || "");
  }
  next();
}

// Paths that bypass the auth check entirely. Login/logout obviously need
// to be reachable while unauthenticated; /api/health is what `ima2 ping`
// hits and must work without credentials so the CLI can probe the server.
// Static UI (`/`, `/assets/*`, `/index.html`, `/favicon.ico`) is also
// allowed so the LoginPage itself can be served.
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/health",
  "/api/providers",
]);

function isPublicPath(reqPath) {
  if (PUBLIC_API_PATHS.has(reqPath)) return true;
  if (!reqPath.startsWith("/api/")) return true; // static UI / generated assets
  return false;
}

// authMiddleware:
//   - reads ima2_session cookie
//   - if valid, sets req.authUser = username (overriding any X-Auth-User
//     value left over from nginx) and req.session = { id, expiresAt }
//   - if missing or invalid AND the path is protected, returns 401
//   - if auth is disabled (IMA2_AUTH != "enabled"), behaves as today: just
//     pass through, leaving whatever req.authUser the legacy middleware set
export function authMiddleware(req, res, next) {
  const sid = req.cookies?.[SESSION_COOKIE_NAME];
  if (sid) {
    const ses = resolveSession(sid);
    if (ses) {
      req.authUser = ses.user.username;
      req.session = { id: ses.sessionId, expiresAt: ses.expiresAt, user: ses.user };
      return next();
    }
    // Stale/expired cookie — clear it so the browser stops sending it.
    res.append("Set-Cookie", `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    req.cookies[SESSION_COOKIE_NAME] = undefined;
  }

  if (!isAuthEnabled()) return next();
  if (isPublicPath(req.path)) return next();

  // Protected path, no valid session → 401. The UI watches for this and
  // redirects to the LoginPage.
  res.status(401).json({
    error: { code: "AUTH_REQUIRED", message: "로그인이 필요합니다." },
  });
}

// Helper for /api/auth/login: build a Set-Cookie value for a fresh session.
export function buildSessionCookie(sessionId, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    // Secure flag is intentionally OFF here — nginx terminates TLS, the
    // proxied request to 127.0.0.1:3333 is plain HTTP and Set-Cookie with
    // Secure would be dropped by the browser. nginx forwards X-Forwarded-
    // Proto=https; if you ever serve directly over HTTPS, add ; Secure.
  ].join("; ");
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}
