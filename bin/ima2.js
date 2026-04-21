#!/usr/bin/env node
import { createInterface } from "readline/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_DIR = join(ROOT, ".ima2");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  }
  return {};
}

function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function setup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n  ima2-gen — GPT Image 2 Generator\n");
  console.log("  Choose authentication method:\n");
  console.log("    1) API Key  — paste your OpenAI API key (paid)");
  console.log("    2) OAuth    — login with ChatGPT account (free)\n");

  const choice = await rl.question("  Enter 1 or 2: ");
  const config = loadConfig();

  if (choice.trim() === "1") {
    const key = await rl.question("  OpenAI API Key: ");
    if (!key.startsWith("sk-")) {
      console.log("  Invalid API key format. Expected sk-...");
      rl.close();
      process.exit(1);
    }
    config.provider = "api";
    config.apiKey = key.trim();
    saveConfig(config);
    console.log("\n  API key saved. Starting server...\n");
  } else {
    config.provider = "oauth";
    delete config.apiKey;
    saveConfig(config);
    console.log("\n  Starting OAuth login...\n");

    // Check if codex auth exists
    const hasAuth =
      existsSync(join(process.env.HOME, ".codex", "auth.json")) ||
      existsSync(join(process.env.HOME, ".chatgpt-local", "auth.json"));

    if (!hasAuth) {
      console.log("  Running 'codex login' — follow the browser prompt.\n");
      try {
        execSync("npx @openai/codex login", { stdio: "inherit" });
      } catch {
        console.log("\n  Login failed or cancelled. You can retry with 'ima2 serve'.\n");
        rl.close();
        process.exit(1);
      }
    } else {
      console.log("  Existing OAuth session found.\n");
    }

    saveConfig(config);
    console.log("  OAuth configured. Starting server...\n");
  }

  rl.close();
  return config;
}

async function serve() {
  let config = loadConfig();

  if (!config.provider) {
    config = await setup();
  }

  const env = { ...process.env };

  if (config.provider === "api" && config.apiKey) {
    env.OPENAI_API_KEY = config.apiKey;
  }

  const serverPath = join(ROOT, "server.js");
  const child = spawn("node", [serverPath], {
    stdio: "inherit",
    env,
    cwd: ROOT,
  });

  child.on("exit", (code) => process.exit(code));

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

// ── CLI ──
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "serve":
    serve();
    break;
  case "setup":
  case "login":
    setup().then(() => console.log("  Done. Run 'ima2 serve' to start."));
    break;
  case "reset":
    if (existsSync(CONFIG_FILE)) {
      writeFileSync(CONFIG_FILE, "{}");
      console.log("  Config reset. Run 'ima2 serve' to reconfigure.");
    }
    break;
  default:
    console.log(`
  ima2-gen — GPT Image 2 Generator

  Usage:
    ima2 serve     Start the image generation server
    ima2 setup     Configure API key or OAuth (interactive)
    ima2 reset     Reset configuration

  First run of 'ima2 serve' will prompt for setup automatically.
`);
}
