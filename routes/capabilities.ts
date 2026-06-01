import type { Express, Request, Response } from "express";
import { buildIma2Capabilities } from "../lib/capabilities.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

const GROK_PLANNER_MODELS = ["grok-composer-2.5-fast", "grok-4.3"];

export function registerCapabilitiesRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);

  app.get("/api/capabilities", (_req: Request, res: Response) => {
    res.json(
      buildIma2Capabilities({
        appConfig: ctx.config,
        packageVersion: ctx.packageVersion,
        source: "server",
        server: ctx.serverUrl || `http://localhost:${ctx.serverActualPort || ctx.config.server.port}`,
      }),
    );
  });

  app.get("/api/config/grok-planner", (_req: Request, res: Response) => {
    res.json({ model: (ctx.config as any).grokProvider.plannerModel, options: GROK_PLANNER_MODELS });
  });

  app.patch("/api/config/grok-planner", (req: Request, res: Response) => {
    const model = req.body?.model;
    if (typeof model !== "string" || !GROK_PLANNER_MODELS.includes(model)) {
      res.status(400).json({ error: `Invalid model. Options: ${GROK_PLANNER_MODELS.join(", ")}` });
      return;
    }
    (ctx.config as any).grokProvider.plannerModel = model;
    res.json({ model });
  });
}
