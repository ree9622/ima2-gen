import { spawnSync } from "node:child_process";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

const result = spawnSync(npmCommand(), ["publish", "--dry-run", "--ignore-scripts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: {
    ...process.env,
    npm_config_loglevel: process.env.npm_config_loglevel ?? "notice",
  },
});

const combinedOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
if (result.status === 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(0);
}

if (combinedOutput.includes("You cannot publish over the previously published versions")) {
  if (result.stdout) process.stdout.write(result.stdout);
  console.warn(
    "[ima2] npm publish dry-run reached the registry publish step; version already exists, so package validation is considered complete.",
  );
  process.exit(0);
}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
