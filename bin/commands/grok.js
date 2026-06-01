import { spawn } from "node:child_process";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { color, die, out } from "../lib/output.js";
import { isWin } from "../lib/platform.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const HELP = `
  ima2 grok <subcommand> [options]

  Manage the bundled progrok runtime used by the Grok image provider.
  No separate progrok install is required.

  Subcommands:
    login [options]        Log in to xAI OAuth (default: --manual-paste)
    logout                 Remove stored xAI credentials
    status                 Show bundled progrok authentication status
    models                 List available Grok models
    proxy [options]        Start the bundled proxy directly

  Notes:
    ima2 serve auto-starts the bundled proxy on 127.0.0.1:18645 by default.
    ima2 grok login defaults to --manual-paste for reliable copy/paste auth.
    Use IMA2_NO_GROK_PROXY=1 to disable automatic proxy startup.
`;
const MANUAL_PASTE_FLAG = "--manual-paste";
const NON_MANUAL_LOGIN_FLOW_FLAGS = new Set(["--device-code", "--browser"]);
function localBinPath() {
    return join(ROOT, "node_modules", ".bin");
}
function spawnProgrok(argv, env) {
    return new Promise((resolve, reject) => {
        const progrokBin = join(localBinPath(), isWin ? "progrok.cmd" : "progrok");
        const child = spawn(progrokBin, argv, {
            cwd: ROOT,
            env,
            stdio: "inherit",
            shell: isWin,
            windowsHide: true,
        });
        child.on("error", (err) => reject(err));
        child.on("close", resolve);
    });
}
export function normalizeGrokLoginArgs(argv) {
    const sub = argv[0];
    if (sub !== "login")
        return argv;
    const normalized = argv.filter((arg) => !NON_MANUAL_LOGIN_FLOW_FLAGS.has(arg));
    if (normalized.includes(MANUAL_PASTE_FLAG))
        return normalized;
    return [...normalized, MANUAL_PASTE_FLAG];
}
export default async function grokCmd(argv) {
    const sub = argv[0];
    if (!sub || sub === "--help" || sub === "-h") {
        out(HELP);
        return;
    }
    const env = {
        ...process.env,
        PATH: `${localBinPath()}${delimiter}${process.env.PATH || ""}`,
    };
    try {
        argv = normalizeGrokLoginArgs(argv);
        const code = await spawnProgrok(argv, env);
        if (code && code !== 0) {
            if (sub === "login") {
                out(color.yellow("⚠ ") + "Login failed. Try again with:\n");
                out("  ima2 grok login\n");
                die(code, "bundled Grok OAuth login failed");
            }
            else {
                die(code, `bundled progrok exited with code ${code}`);
            }
        }
    }
    catch (err) {
        die(1, `bundled progrok failed to start: ${err.message}`);
    }
    if (sub === "login") {
        out(color.green("✓ ") + "Grok OAuth is ready for ima2 serve");
    }
}
