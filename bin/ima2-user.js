#!/usr/bin/env node
// User management CLI for the self-hosted login system.
// Usage:
//   ima2-user add <username>       — interactive password prompt, creates user
//   ima2-user list                 — show all users
//   ima2-user remove <username>    — delete user (and cascade their sessions)
//   ima2-user passwd <username>    — change password (interactive)
//
// The DB lives under IMA2_CONFIG_DIR (default ~/.ima2/sessions.db). Always
// run this on the same box / as the same user that runs `ima2 serve` so
// the file path resolves to the same DB.

import { createInterface } from "node:readline";
import process from "node:process";
import {
  createUser,
  listUsers,
  deleteUser,
  setUserPassword,
  AuthError,
} from "../lib/userAuth.js";

function usage() {
  console.error(
    "Usage:\n" +
      "  ima2-user add <username>\n" +
      "  ima2-user list\n" +
      "  ima2-user remove <username>\n" +
      "  ima2-user passwd <username>",
  );
  process.exit(2);
}

// Reads a line from stdin without echoing characters (for password input).
// Falls back to a visible prompt if stdin is not a TTY (CI / piped input).
function readPasswordHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }
    process.stdout.write(prompt);
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      if (s.includes("")) {
        // Ctrl+C
        process.stdout.write("\n");
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        reject(new Error("aborted"));
        return;
      }
      if (s === "\r" || s === "\n" || s.endsWith("\n")) {
        process.stdout.write("\n");
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(buf);
        return;
      }
      buf += s;
    };
    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function promptNewPassword() {
  const a = await readPasswordHidden("새 비밀번호: ");
  const b = await readPasswordHidden("비밀번호 확인: ");
  if (a !== b) {
    console.error("두 비밀번호가 다릅니다.");
    process.exit(1);
  }
  return a;
}

async function main() {
  const [, , cmd, arg] = process.argv;
  if (!cmd) usage();
  try {
    if (cmd === "add") {
      if (!arg) usage();
      const password = await promptNewPassword();
      const user = createUser(arg, password);
      console.log(`✓ user created: ${user.username} (id=${user.id})`);
    } else if (cmd === "list") {
      const users = listUsers();
      if (users.length === 0) {
        console.log("(no users)");
        return;
      }
      for (const u of users) {
        const last = u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : "never";
        const created = new Date(u.createdAt).toISOString();
        console.log(`${u.id}\t${u.username}\tcreated=${created}\tlast=${last}`);
      }
    } else if (cmd === "remove") {
      if (!arg) usage();
      const ok = deleteUser(arg);
      if (!ok) {
        console.error(`사용자 "${arg}" 를 찾지 못했습니다.`);
        process.exit(1);
      }
      console.log(`✓ user removed: ${arg}`);
    } else if (cmd === "passwd") {
      if (!arg) usage();
      const password = await promptNewPassword();
      setUserPassword(arg, password);
      console.log(`✓ password updated: ${arg}`);
    } else {
      usage();
    }
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exit(1);
    }
    console.error(err.stack || err.message || String(err));
    process.exit(1);
  }
}

main();
