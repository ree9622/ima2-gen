import type { Express } from "express";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";

export interface QuotaWindow {
  label: string;
  percent: number;
  resetsAt: string | null;
}

export interface QuotaResult {
  provider: string;
  account?: { email: string | null; plan: string | null } | null;
  windows: QuotaWindow[];
  error?: boolean;
  authenticated?: boolean;
}

function readCodexTokens(): { access_token: string; account_id: string } | null {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  try {
    const j = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8"));
    if (j?.tokens?.access_token) {
      return { access_token: j.tokens.access_token, account_id: j.tokens.account_id ?? "" };
    }
  } catch {}
  return null;
}

async function fetchCodexUsage(tokens: { access_token: string; account_id: string }): Promise<QuotaResult> {
  try {
    const resp = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "ChatGPT-Account-Id": tokens.account_id,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) return { provider: "codex", authenticated: false, windows: [] };
      return { provider: "codex", error: true, windows: [] };
    }
    const data = await resp.json() as {
      email?: string | null;
      plan_type?: string | null;
      rate_limit?: {
        primary_window?: { used_percent?: number; reset_at?: number };
        secondary_window?: { used_percent?: number; reset_at?: number };
      };
    };
    const account = { email: data.email ?? null, plan: data.plan_type ?? null };
    const windows: QuotaWindow[] = [];
    if (data.rate_limit?.primary_window) {
      windows.push({
        label: "5h",
        percent: Math.round(data.rate_limit.primary_window.used_percent ?? 0),
        resetsAt: data.rate_limit.primary_window.reset_at
          ? new Date(data.rate_limit.primary_window.reset_at * 1000).toISOString()
          : null,
      });
    }
    if (data.rate_limit?.secondary_window) {
      windows.push({
        label: "7d",
        percent: Math.round(data.rate_limit.secondary_window.used_percent ?? 0),
        resetsAt: data.rate_limit.secondary_window.reset_at
          ? new Date(data.rate_limit.secondary_window.reset_at * 1000).toISOString()
          : null,
      });
    }
    return { provider: "codex", account, windows };
  } catch {
    return { provider: "codex", error: true, windows: [] };
  }
}

export function registerQuotaRoutes(app: Express, _ctx: RouteRuntimeContext) {
  app.get("/api/quota", async (_req, res) => {
    const tokens = readCodexTokens();
    if (!tokens) {
      res.json({ codex: { provider: "codex", authenticated: false, windows: [] } });
      return;
    }
    const codex = await fetchCodexUsage(tokens);
    res.json({ codex });
  });
}
