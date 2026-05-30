import type { Express } from "express";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";

export function registerGrokRoutes(app: Express, ctx: RouteRuntimeContext) {
  app.get("/api/grok/status", async (_req, res) => {
    const grokCfg = (ctx.config as any).grokProvider || {};
    const host = grokCfg.proxyHost || "127.0.0.1";
    const port = grokCfg.proxyPort || 18645;
    const timeoutMs = grokCfg.statusTimeoutMs || 3000;
    try {
      const r = await fetch(`http://${host}:${port}/v1/models`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) {
        const data: any = await r.json();
        const models: string[] = data?.data?.map((m: any) => m.id).filter(Boolean) || [];
        const hasImageModel = models.some((m: string) => m.startsWith("grok-imagine"));
        return res.json({ status: hasImageModel ? "ready" : "no_image_model", models });
      }
      return res.json({ status: "error", reason: `HTTP ${r.status}` });
    } catch {
      return res.json({ status: "offline" });
    }
  });
}
