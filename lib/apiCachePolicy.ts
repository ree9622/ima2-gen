import type { Express, NextFunction, Request, Response } from "express";

export function setApiNoStoreHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  next();
}

export function configureApiCachePolicy(app: Express) {
  app.set("etag", false);
  app.use("/api", setApiNoStoreHeaders);
}
