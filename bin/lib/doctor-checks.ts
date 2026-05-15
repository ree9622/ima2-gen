import { createRequire } from "module";
import { createServer } from "net";
import { existsSync, statSync } from "fs";
import { join } from "path";
import { config as runtimeConfig } from "../../config.js";
import { isSensitiveConfigKey } from "../../lib/configKeys.js";

export type DoctorCheckLine = {
  kind: "pass" | "fail" | "warn" | "info";
  text: string;
};

function hasSensitiveValue(value: unknown, path = ""): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (isSensitiveConfigKey(nextPath) && nested) return true;
    if (hasSensitiveValue(nested, nextPath)) return true;
  }
  return false;
}

async function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function probeBetterSqlite(root: string): DoctorCheckLine {
  try {
    const requireFromRoot = createRequire(join(root, "package.json"));
    const mod = requireFromRoot("better-sqlite3") as { default?: unknown };
    const Database = (mod.default ?? mod) as new (path: string) => { close: () => void };
    const db = new Database(":memory:");
    db.close();
    return { kind: "pass", text: "better-sqlite3 native binding loads" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "fail", text: `better-sqlite3 native binding failed: ${message}` };
  }
}

function configPermissionLine(configFile: string, fileConfig: unknown): DoctorCheckLine | null {
  if (process.platform === "win32" || !existsSync(configFile) || !hasSensitiveValue(fileConfig)) {
    return null;
  }
  const mode = statSync(configFile).mode;
  if ((mode & 0o077) === 0) return null;
  return {
    kind: "warn",
    text: `${configFile} is readable by group/other; consider chmod 600`,
  };
}

export async function buildHardeningDoctorLines({
  root,
  configFile,
  fileConfig,
}: {
  root: string;
  configFile: string;
  fileConfig: unknown;
}): Promise<DoctorCheckLine[]> {
  const lines: DoctorCheckLine[] = [];
  const portAvailable = await probePort(runtimeConfig.server.host, runtimeConfig.server.port);
  lines.push({
    kind: "info",
    text: `Preferred backend port ${runtimeConfig.server.port}: ${portAvailable ? "available" : "in use"}`,
  });
  lines.push({
    kind: "info",
    text: `Card News: ${runtimeConfig.features.cardNews ? "enabled" : "disabled"}`,
  });

  const skillPath = join(root, "skills", "ima2", "SKILL.md");
  lines.push(
    existsSync(skillPath)
      ? { kind: "pass", text: `packaged skill found: ${skillPath}` }
      : { kind: "fail", text: `packaged skill missing: ${skillPath}` },
  );
  lines.push(probeBetterSqlite(root));

  const perm = configPermissionLine(configFile, fileConfig);
  if (perm) lines.push(perm);
  return lines;
}
