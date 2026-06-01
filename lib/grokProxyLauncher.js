import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isWin } from "../bin/lib/platform.js";
import { config } from "../config.js";
import { findAvailablePort } from "./runtimePorts.js";
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseListeningUrl(line) {
    const match = String(line || "").match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/v1/i);
    if (!match)
        return null;
    const port = Number(match[1]);
    return Number.isFinite(port) ? { url: match[0], port } : null;
}
export function isGrokProxyAuthRequiredMessage(line) {
    const normalized = String(line || "").toLowerCase();
    return normalized.includes("not logged in")
        && (normalized.includes("progrok login") || normalized.includes("ima2 grok login"));
}
export function normalizeGrokProxyMessage(line) {
    return String(line || "").replace(/`?progrok login`?/gi, "`ima2 grok login`");
}
function localBinPath() {
    return join(rootDir, "node_modules", ".bin");
}
export async function startGrokProxy(options = {}) {
    const host = options.host ?? config.grokProvider.proxyHost;
    const requestedPort = options.port ?? config.grokProvider.proxyPort;
    const restartDelayMs = options.restartDelayMs ?? config.grokProvider.restartDelayMs;
    let currentChild = null;
    let stopping = false;
    let restartTimer = null;
    let authRequired = false;
    const scheduleRestart = () => {
        restartTimer = setTimeout(() => {
            void spawnProxy();
        }, restartDelayMs);
    };
    const spawnProxy = async () => {
        let port;
        try {
            port = await findAvailablePort(requestedPort, { host });
        }
        catch (err) {
            const e = err;
            console.error(`[grok] failed to select progrok port: ${e.message || e}`);
            if (!stopping) {
                console.log(`[grok] retrying port selection in ${Math.round(restartDelayMs / 1000)}s...`);
                scheduleRestart();
            }
            return;
        }
        if (port !== requestedPort) {
            console.log(`[grok] requested port ${requestedPort}, actual port ${port}`);
        }
        options.onPortSelected?.({ host, port, requestedPort, url: `http://${host}:${port}/v1` });
        console.log(`Starting bundled progrok proxy for Grok images at http://${host}:${port}/v1 (managed by ima2 serve)...`);
        const progrokBin = options.progrokBinPath ?? join(localBinPath(), isWin ? "progrok.cmd" : "progrok");
        const child = spawn(progrokBin, ["proxy", "--host", host, "--port", String(port)], {
            stdio: ["ignore", "pipe", "pipe"],
            shell: isWin,
            windowsHide: true,
            env: process.env,
        });
        currentChild = child;
        authRequired = false;
        child.stdout?.on("data", (d) => {
            const msg = normalizeGrokProxyMessage(d.toString().trim());
            if (!msg)
                return;
            console.log(`[grok] ${msg}`);
            for (const line of msg.split(/\r?\n/)) {
                if (isGrokProxyAuthRequiredMessage(line))
                    authRequired = true;
                const ready = parseListeningUrl(line);
                if (!ready)
                    continue;
                console.log(`[grok] ready for ima2 Grok provider at ${ready.url}`);
                options.onReady?.({ url: ready.url, port: ready.port, requestedPort });
            }
        });
        child.stderr?.on("data", (d) => {
            const msg = normalizeGrokProxyMessage(d.toString().trim());
            if (msg)
                console.error(`[grok] ${msg}`);
            for (const line of msg.split(/\r?\n/)) {
                if (isGrokProxyAuthRequiredMessage(line))
                    authRequired = true;
            }
        });
        child.on("error", (err) => {
            console.error(`[grok] failed to start progrok proxy: ${err.message}`);
        });
        child.on("exit", (code) => {
            if (currentChild === child)
                currentChild = null;
            if (stopping)
                return;
            options.onExit?.({ code });
            if (authRequired && code !== 0) {
                console.error("[grok] Grok OAuth is not logged in. Run `ima2 grok login` to enable Grok images/video.");
                console.error("[grok] Continuing without auto-restarting the Grok proxy. GPT OAuth/API image generation can still run.");
                return;
            }
            console.log(`[grok] exited with code ${code}, restarting in ${Math.round(restartDelayMs / 1000)}s...`);
            scheduleRestart();
        });
    };
    await spawnProxy();
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
