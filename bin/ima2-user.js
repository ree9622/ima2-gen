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

import process from "node:process";
import {
  createUser,
  listUsers,
  deleteUser,
  setUserPassword,
  AuthError,
} from "../lib/userAuth.js";

const ETX = String.fromCharCode(3); // Ctrl+C

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

// TTY-only hidden password prompt. Echoes each keystroke as nothing,
// hands back the buffered string on newline. The non-TTY branch lives in
// promptNewPassword because the readline approach is fragile when stdin
// closes after the first line (we'd have lost the second prompt).
function readPasswordHiddenTTY(prompt) {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let buf = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      if (s.includes(ETX)) {
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
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function readAllStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

async function promptNewPassword() {
  if (!process.stdin.isTTY) {
    // Non-TTY (CI / `printf "..." | ima2-user add ko`): read all of stdin
    // once, take the first non-empty line as the password. If two lines
    // were piped (legacy two-prompt flow) we verify they match; one line
    // alone is also accepted.
    const all = await readAllStdin();
    const lines = all.split(/\r?\n/).filter((s) => s.length > 0);
    if (lines.length === 0) {
      console.error("stdin 에서 비밀번호를 읽지 못했습니다.");
      process.exit(1);
    }
    if (lines.length >= 2 && lines[0] !== lines[1]) {
      console.error("두 비밀번호가 다릅니다.");
      process.exit(1);
    }
    return lines[0];
  }
  const a = await readPasswordHiddenTTY("새 비밀번호: ");
  const b = await readPasswordHiddenTTY("비밀번호 확인: ");
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
