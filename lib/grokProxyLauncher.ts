import type { ChildProcess } from "node:child_process";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnBin } from "../bin/lib/platform.js";
import { config } from "../config.js";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\/lib$/, "");

type GrokProxyReadyInfo = {
  url: string;
  port: number;
  requestedPort: number;
};

type GrokProxyOptions = {
  host?: string;
  port?: number;
  restartDelayMs?: number;
  onReady?: (info: GrokProxyReadyInfo) => void;
  onExit?: (info: { code: number | null }) => void;
};

function parseListeningUrl(line: string): { url: string; port: number } | null {
  const match = String(line || "").match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/v1/i);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isFinite(port) ? { url: match[0], port } : null;
}

function localBinPath(): string {
  return join(rootDir, "node_modules", ".bin");
}

export function startGrokProxy(options: GrokProxyOptions = {}) {
  const host = options.host ?? config.grokProvider.proxyHost;
  const port = options.port ?? config.grokProvider.proxyPort;
  const restartDelayMs = options.restartDelayMs ?? config.grokProvider.restartDelayMs;
  let currentChild: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;

  const spawnProxy = () => {
    console.log(`Starting progrok proxy on ${host}:${port}...`);
    const child = spawnBin("progrok", ["proxy", "--host", host, "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${localBinPath()}${delimiter}${process.env.PATH || ""}`,
      },
    });
    currentChild = child;

    child.stdout?.on("data", (d) => {
      const msg = d.toString().trim();
      if (!msg) return;
      console.log(`[grok] ${msg}`);
      for (const line of msg.split(/\r?\n/)) {
        const ready = parseListeningUrl(line);
        if (!ready) continue;
        options.onReady?.({ url: ready.url, port: ready.port, requestedPort: port });
      }
    });

    child.stderr?.on("data", (d) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[grok] ${msg}`);
    });

    child.on("error", (err) => {
      console.error(`[grok] failed to start progrok proxy: ${err.message}`);
    });

    child.on("exit", (code) => {
      if (currentChild === child) currentChild = null;
      if (stopping) return;
      options.onExit?.({ code });
      console.log(`[grok] exited with code ${code}, restarting in ${Math.round(restartDelayMs / 1000)}s...`);
      restartTimer = setTimeout(spawnProxy, restartDelayMs);
    });
  };

  spawnProxy();

  return {
    get child() {
      return currentChild;
    },
    kill(signal: NodeJS.Signals = "SIGTERM") {
      this.stop(signal);
    },
    stop(signal: NodeJS.Signals = "SIGTERM") {
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      try { currentChild?.kill(signal); } catch {}
    },
  };
}
