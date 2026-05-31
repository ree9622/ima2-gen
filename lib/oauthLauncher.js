import { isWin } from "../bin/lib/platform.js";
import { config } from "../config.js";
import { parseLocalhostPortFromUrl, parseOAuthReadyUrl } from "./runtimePorts.js";
import { hasAuthFile } from "./codexDetect.js";
import { spawn } from "node:child_process";
export function startOAuthProxy(options = {}) {
    const oauthPort = options.oauthPort ?? config.oauth.proxyPort;
    const restartDelayMs = options.restartDelayMs ?? config.oauth.restartDelayMs;
    let currentChild = null;
    let stopping = false;
    let restartTimer = null;
    let hasBeenReady = false;
    let restartCount = 0;
    const MAX_RESTARTS = 3;
    const spawnProxy = () => {
        // Guard: don't start if no auth file exists (avoids pointless crash loops
        // and prevents openai-oauth from corrupting state on refresh failure)
        if (!hasAuthFile()) {
            console.log("[oauth] No Codex auth file found. Skipping OAuth proxy.");
            options.onExit?.({ code: 0 });
            return;
        }
        console.log(`Starting openai-oauth on port ${oauthPort}...`);
        const spawnedAt = Date.now();
        const child = spawn("npx", ["openai-oauth", "--port", String(oauthPort)], {
            stdio: ["ignore", "pipe", "pipe"],
            shell: isWin,
            windowsHide: true,
            env: { ...process.env },
        });
        currentChild = child;
        child.stdout?.on("data", (d) => {
            const msg = d.toString().trim();
            if (!msg)
                return;
            console.log(`[oauth] ${msg}`);
            for (const line of msg.split(/\r?\n/)) {
                const url = parseOAuthReadyUrl(line);
                if (!url)
                    continue;
                const port = parseLocalhostPortFromUrl(url);
                if (port && port !== oauthPort) {
                    console.log(`[oauth] requested port ${oauthPort}, actual port ${port}`);
                }
                options.onReady?.({ url, port: port || oauthPort, requestedPort: oauthPort });
                hasBeenReady = true;
            }
        });
        child.stderr?.on("data", (d) => {
            const msg = d.toString().trim();
            if (msg && !msg.includes("npm warn"))
                console.error(`[oauth] ${msg}`);
        });
        child.on("exit", (code) => {
            if (currentChild === child)
                currentChild = null;
            if (stopping)
                return;
            const uptime = Date.now() - spawnedAt;
            if (uptime < 5000 && !hasBeenReady) {
                // Crashed immediately without ever becoming ready — likely missing openai-oauth or no token.
                // Don't restart; just mark as failed silently.
                console.log(`[oauth] proxy exited immediately (code ${code}). Skipping — Grok-only mode is fine.`);
                options.onExit?.({ code });
                return;
            }
            options.onExit?.({ code });
            if (restartCount >= MAX_RESTARTS) {
                console.log(`[oauth] max restarts (${MAX_RESTARTS}) reached. Giving up — Grok-only mode is fine.`);
                return;
            }
            restartCount++;
            console.log(`[oauth] exited with code ${code}, restarting in ${Math.round(restartDelayMs / 1000)}s... (attempt ${restartCount}/${MAX_RESTARTS})`);
            restartTimer = setTimeout(spawnProxy, restartDelayMs);
        });
    };
    spawnProxy();
    return {
        get child() {
            return currentChild;
        },
        kill(signal = "SIGTERM") {
            this.stop(signal);
        },
        stop(signal = "SIGTERM") {
            stopping = true;
            if (restartTimer)
                clearTimeout(restartTimer);
            try {
                currentChild?.kill(signal);
            }
            catch { }
        },
    };
}
