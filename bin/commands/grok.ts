import { spawn } from "node:child_process";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { color, die, out } from "../lib/output.js";
import { resolveBin, isWin } from "../lib/platform.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const HELP = `
  ima2 grok <subcommand> [options]

  Manage the bundled progrok runtime used by the Grok image provider.
  No separate progrok install is required.

  Subcommands:
    login [--device-code]  Log in to xAI OAuth for the bundled proxy
    logout                 Remove stored xAI credentials
    status                 Show bundled progrok authentication status
    models                 List available Grok models
    proxy [options]        Start the bundled proxy directly

  Notes:
    ima2 serve auto-starts the bundled proxy on 127.0.0.1:18645 by default.
    Use IMA2_NO_GROK_PROXY=1 to disable automatic proxy startup.
`;

function localBinPath() {
  return join(ROOT, "node_modules", ".bin");
}

function spawnProgrok(argv: string[], env: NodeJS.ProcessEnv): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn("cmd.exe", ["/d", "/s", "/c", `progrok ${argv.map((a) => a.includes(" ") ? `"${a}"` : a).join(" ")}`], {
          cwd: ROOT,
          env,
          stdio: "inherit",
          windowsHide: true,
        })
      : spawn(resolveBin("progrok"), argv, {
          cwd: ROOT,
          env,
          stdio: "inherit",
          windowsHide: true,
        });
    child.on("error", (err) => reject(err));
    child.on("close", resolve);
  });
}

export default async function grokCmd(argv: string[]) {
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
    const code = await spawnProgrok(argv, env);
    if (code && code !== 0) {
      // Auto-fallback: if login (without --device-code) failed, retry with device-code
      if (sub === "login" && !argv.includes("--device-code")) {
        out(color.yellow("⚠ ") + "Browser login failed. Retrying with device-code flow...\n");
        const fallbackCode = await spawnProgrok(["login", "--device-code"], env);
        if (fallbackCode && fallbackCode !== 0) {
          die(fallbackCode, "bundled progrok device-code login also failed");
        }
      } else {
        die(code, `bundled progrok exited with code ${code}`);
      }
    }
  } catch (err: any) {
    die(1, `bundled progrok failed to start: ${err.message}`);
  }

  if (sub === "login") {
    out(color.green("✓ ") + "Grok OAuth is ready for ima2 serve");
  }
}
