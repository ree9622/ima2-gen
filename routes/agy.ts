import type { Express } from "express";
import { spawn } from "node:child_process";

// Detect whether the Antigravity CLI (`agy`) is installed, using the same
// spawn-and-catch style as lib/agyImageAdapter.ts (no shell `which`/`where`).
// Login state cannot be probed — agy has no status command — so we only
// report installation here.
function isAgyInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn("agy", ["--version"], { stdio: "ignore" });
      child.on("error", () => done(false)); // ENOENT when not on PATH
      child.on("exit", (code) => done(code === 0));
      // Safety timeout so a hung binary never blocks the request.
      setTimeout(() => {
        try { if (!child.killed) child.kill(); } catch { /* ignore */ }
        done(false);
      }, 3000).unref?.();
    } catch {
      done(false);
    }
  });
}

export function registerAgyRoutes(app: Express) {
  app.get("/api/agy/status", async (_req, res) => {
    try {
      const installed = await isAgyInstalled();
      res.json({ installed });
    } catch {
      res.json({ installed: false });
    }
  });
}
