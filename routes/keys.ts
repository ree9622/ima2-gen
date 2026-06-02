import type { Express, Request, Response } from "express";
import { readFile, writeFile, chmod } from "node:fs/promises";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { initVertexAuth, clearVertexAuth } from "../lib/vertexAuth.js";

type KeyProvider = "openai" | "xai" | "gemini";

const KEY_PREFIX_MAP: Record<KeyProvider, string[]> = {
  openai: ["sk-"],
  xai: ["xai-"],
  gemini: ["AI"],
};

const VALIDATE_URL_MAP: Record<KeyProvider, string> = {
  openai: "https://api.openai.com/v1/models",
  xai: "https://api.x.ai/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
};

const CONFIG_KEY_MAP: Record<KeyProvider, string> = {
  openai: "apiKey",
  xai: "xaiApiKey",
  gemini: "geminiApiKey",
};

function isKeyProvider(v: string): v is KeyProvider {
  return v === "openai" || v === "xai" || v === "gemini";
}

function maskKey(key: string): string {
  if (key.length <= 7) return "***";
  return `${key.slice(0, 4)}...${key.slice(-3)}`;
}

function keySourceForProvider(ctx: RuntimeContext, provider: KeyProvider): { key: string | undefined; source: string } {
  if (provider === "openai") return { key: ctx.apiKey, source: ctx.apiKeySource || "none" };
  if (provider === "xai") return { key: ctx.xaiApiKey, source: ctx.xaiApiKeySource || "none" };
  if (provider === "gemini") return { key: ctx.geminiApiKey, source: ctx.geminiApiKeySource || "none" };
  return { key: undefined, source: "none" };
}

export function mountKeyRoutes(app: Express, ctx: RuntimeContext) {
  app.get("/api/keys/status", (_req: Request, res: Response) => {
    const status: Record<string, unknown> = {};
    for (const provider of ["openai", "xai", "gemini"] as const) {
      const { key, source } = keySourceForProvider(ctx, provider);
      status[provider] = {
        configured: !!key,
        source,
        valid: !!key,
        maskedKey: key ? maskKey(key) : null,
      };
    }
    const vertexJson = ctx.vertexServiceAccountJson;
    const vertexSource = vertexJson
      ? (process.env.VERTEX_SERVICE_ACCOUNT_JSON ? "env" : "config")
      : "none";
    status.vertex = {
      configured: !!vertexJson,
      source: vertexSource,
      valid: !!vertexJson,
      maskedKey: ctx.vertexProjectId ? `project: ${ctx.vertexProjectId}` : null,
    };
    res.json(status);
  });

  // Vertex JSON — dedicated route (before generic :provider)
  app.put("/api/keys/vertex", async (req: Request, res: Response) => {
    const { serviceAccountJson } = req.body as { serviceAccountJson?: string };
    if (!serviceAccountJson || typeof serviceAccountJson !== "string") {
      return res.status(400).json({ ok: false, error: "Missing serviceAccountJson", code: "MISSING_KEY" });
    }
    const trimmed = serviceAccountJson.trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON", code: "INVALID_JSON" });
    }
    if (parsed.type !== "service_account" || !parsed.project_id) {
      return res.status(400).json({
        ok: false,
        error: "JSON must be a Google Cloud service account (type: service_account, project_id required)",
        code: "INVALID_SERVICE_ACCOUNT",
      });
    }

    // Validate by initializing auth (catches key format issues)
    try {
      initVertexAuth(trimmed);
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: `Auth init failed: ${e.message}`, code: "KEY_VALIDATION_FAILED" });
    }

    // Save to config.json
    const cfgPath = ctx.config.storage.configFile;
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(cfgPath, "utf-8"));
    } catch { /* new file */ }
    existing.vertexServiceAccountJson = trimmed;
    existing.geminiAuthMode = "vertex";
    await writeFile(cfgPath, JSON.stringify(existing, null, 2), "utf-8");
    try { await chmod(cfgPath, 0o600); } catch { /* ignore on Windows */ }

    // Hot-update runtime
    (ctx as any).vertexServiceAccountJson = trimmed;
    (ctx as any).vertexProjectId = parsed.project_id as string;
    (ctx as any).hasVertexKey = true;
    (ctx as any).geminiAuthMode = "vertex";

    return res.json({ ok: true, provider: "vertex", source: "config", valid: true, projectId: parsed.project_id });
  });

  app.delete("/api/keys/vertex", async (_req: Request, res: Response) => {
    const source = ctx.vertexServiceAccountJson
      ? (process.env.VERTEX_SERVICE_ACCOUNT_JSON ? "env" : "config")
      : "none";
    if (source === "env") {
      return res.status(400).json({ ok: false, error: "Cannot remove env-sourced key", code: "ENV_KEY_IMMUTABLE" });
    }

    const cfgPath = ctx.config.storage.configFile;
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(cfgPath, "utf-8"));
    } catch { /* ignore */ }
    delete existing.vertexServiceAccountJson;
    await writeFile(cfgPath, JSON.stringify(existing, null, 2), "utf-8");

    clearVertexAuth();
    (ctx as any).vertexServiceAccountJson = undefined;
    (ctx as any).vertexProjectId = undefined;
    (ctx as any).hasVertexKey = false;

    return res.json({ ok: true, provider: "vertex", removed: true });
  });

  app.put("/api/keys/:provider", async (req: Request<{ provider: string }>, res: Response) => {
    const { provider } = req.params;
    if (!isKeyProvider(provider)) {
      return res.status(400).json({ ok: false, error: "Invalid provider", code: "INVALID_PROVIDER" });
    }
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return res.status(400).json({ ok: false, error: "Missing apiKey", code: "MISSING_KEY" });
    }
    const trimmed = apiKey.trim();

    // Format check
    const validPrefix = KEY_PREFIX_MAP[provider].some((p) => trimmed.startsWith(p));
    if (!validPrefix) {
      return res.status(400).json({
        ok: false,
        error: `Invalid key format for ${provider}: expected prefix ${KEY_PREFIX_MAP[provider].join(" or ")}`,
        code: "INVALID_KEY_FORMAT",
      });
    }

    // Validate against provider API
    try {
      const url = VALIDATE_URL_MAP[provider];
      const opts: RequestInit = { signal: AbortSignal.timeout(10_000) };
      if (provider === "gemini") {
        const validateRes = await fetch(`${url}?key=${trimmed}`, opts);
        if (!validateRes.ok) throw new Error(`HTTP ${validateRes.status}`);
      } else {
        opts.headers = { Authorization: `Bearer ${trimmed}` };
        const validateRes = await fetch(url, opts);
        if (!validateRes.ok) throw new Error(`HTTP ${validateRes.status}`);
      }
    } catch (e: any) {
      return res.status(400).json({
        ok: false,
        error: `API key validation failed: ${e.message || "unknown"}`,
        code: "KEY_VALIDATION_FAILED",
      });
    }

    // Save to config.json
    const cfgPath = ctx.config.storage.configFile;
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(cfgPath, "utf-8"));
    } catch { /* new file */ }
    existing[CONFIG_KEY_MAP[provider]] = trimmed;
    await writeFile(cfgPath, JSON.stringify(existing, null, 2), "utf-8");
    try { await chmod(cfgPath, 0o600); } catch { /* ignore on Windows */ }

    // Hot-update runtime context
    if (provider === "openai") {
      (ctx as any).apiKey = trimmed;
      (ctx as any).apiKeySource = "config";
      (ctx as any).hasApiKey = true;
      try {
        const OpenAI = (await import("openai")).default;
        (ctx as any).openai = new OpenAI({ apiKey: trimmed });
      } catch { /* ignore */ }
    } else if (provider === "xai") {
      (ctx as any).xaiApiKey = trimmed;
      (ctx as any).xaiApiKeySource = "config";
      (ctx as any).hasXaiApiKey = true;
    } else if (provider === "gemini") {
      (ctx as any).geminiApiKey = trimmed;
      (ctx as any).geminiApiKeySource = "config";
      (ctx as any).hasGeminiApiKey = true;
      (ctx as any).geminiAuthMode = "apikey";
      existing[CONFIG_KEY_MAP[provider]] = trimmed;
      existing.geminiAuthMode = "apikey";
    }

    return res.json({ ok: true, provider, source: "config", valid: true });
  });

  app.delete("/api/keys/:provider", async (req: Request<{ provider: string }>, res: Response) => {
    const { provider } = req.params;
    if (!isKeyProvider(provider)) {
      return res.status(400).json({ ok: false, error: "Invalid provider", code: "INVALID_PROVIDER" });
    }
    const { source } = keySourceForProvider(ctx, provider);
    if (source === "env") {
      return res.status(400).json({ ok: false, error: "Cannot remove env-sourced key", code: "ENV_KEY_IMMUTABLE" });
    }

    // Remove from config.json
    const cfgPath = ctx.config.storage.configFile;
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(cfgPath, "utf-8"));
    } catch { /* ignore */ }
    delete existing[CONFIG_KEY_MAP[provider]];
    await writeFile(cfgPath, JSON.stringify(existing, null, 2), "utf-8");

    // Clear runtime
    if (provider === "openai") {
      (ctx as any).apiKey = undefined;
      (ctx as any).apiKeySource = "none";
      (ctx as any).hasApiKey = false;
      (ctx as any).openai = null;
    } else if (provider === "xai") {
      (ctx as any).xaiApiKey = undefined;
      (ctx as any).xaiApiKeySource = "none";
      (ctx as any).hasXaiApiKey = false;
    } else if (provider === "gemini") {
      (ctx as any).geminiApiKey = undefined;
      (ctx as any).geminiApiKeySource = "none";
      (ctx as any).hasGeminiApiKey = false;
    }

    return res.json({ ok: true, provider, removed: true });
  });
}
