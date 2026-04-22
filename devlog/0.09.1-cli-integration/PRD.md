# 0.09.1 — CLI Integration (PRD → Diff-Level Spec)

> **Goal**: Make `ima2` CLI a first-class client of the local server so a user can generate / edit / attach / list / inspect images **entirely from the terminal** (no browser), reusing the same HTTP surface the web UI uses. Ships **before** 0.10; 0.10 specs are amended downstream.

## 1. Problem & Context

Today `ima2` only boots the server (`ima2 serve`) and the web UI is the sole generator. This forces a browser round-trip for:
- Quick prompt runs during scripting / iteration
- Reference-image attachment from local filesystem
- Batch runs / compares from shell
- CI / piped workflows (e.g., `cat prompt.txt | ima2 gen --refs ./a.png`)
- Remote SSH boxes with no display

The server already exposes a clean REST surface (`/api/generate`, `/api/history`, `/api/inflight`, etc.). 0.09.1 wires a typed CLI subcommand layer on top — **no new API primitives**, just CLI affordances + two small server additions (health ping with version, and a `X-ima2-client` request tag for telemetry).

## 2. Non-Goals (explicit)

- Not re-inventing `/api/generate` (single source of truth remains server.js)
- Not adding a daemon / TUI / long-lived CLI session (0.10+ may)
- Not replacing the web UI — CLI and UI are peer clients
- No Node-mode graph editing from CLI (future, 0.11+)
- No auth flows beyond existing OAuth / API key (reuses server provider)

## 3. User Stories

| # | Story | Command |
|---|-------|---------|
| U1 | "Generate one image from a one-liner" | `ima2 gen "a shiba in space"` |
| U2 | "Attach 2 refs + high quality + save to file" | `ima2 gen "merge" --ref a.png --ref b.png -q high -o out.png` |
| U3 | "Generate N variants" | `ima2 gen "moon" -n 4 --out-dir ./out` |
| U4 | "Pipe a prompt in" | `cat p.txt \| ima2 gen --quality high` |
| U5 | "Edit an existing image in place" | `ima2 edit in.png --prompt "add snow" -o out.png` |
| U6 | "List recent generations" | `ima2 ls -n 10` |
| U7 | "Show one history item" | `ima2 show 1761234567_0.png` |
| U8 | "Watch active generations" | `ima2 ps` |
| U9 | "Health/version of the running server" | `ima2 ping` |
| U10 | "Open last result in default viewer" | `ima2 open --last` |

## 4. Command Matrix

```
ima2 gen  <prompt...>   [-q|--quality low|medium|high|auto]
                        [-s|--size 1024x1024|1536x1024|1024x1536|2048x2048|2048x1152|3824x2160|2160x3824|auto]
                        [-n|--count 1..8]
                        [-r|--ref <file>]   (repeatable, max 5)
                        [-o|--out <file>]   (single-image shorthand)
                        [-d|--out-dir <dir>]
                        [--json]            (machine-readable stdout)
                        [--no-save]         (print b64 to stdout only)
                        [--session <id>]
                        [--timeout <sec=180>]
                        [--stdin]           (read prompt from stdin)

ima2 edit <file>        --prompt "<text>"
                        [all gen flags except --ref multiple — edit input is the file]
                        [-o|--out <file>]

ima2 ls                 [-n <count=20>] [--json]
ima2 show <filename>    [--json] [--reveal]    (reveal opens containing folder)
ima2 ps                 [--kind classic|node] [--session <id>] [--json]
ima2 ping               [--json]                (GET /api/health — new)
ima2 open               [--last | --file <name>]
```

Existing `serve`, `setup/login`, `status`, `doctor`, `open`, `reset` unchanged.

### 4.1 Global flags

- `--server http://localhost:PORT` — override target (default: auto-detect from running server or config)
- `--quiet` / `-q` conflict → **use `-Q` for quiet**, keep `-q` for quality (muscle memory from many tools)
- `-v`/`--version` unchanged (prints CLI version)
- `ima2 help <command>` prints per-command help

### 4.2 Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic error / unknown command |
| 2 | Bad flag / argument |
| 3 | Server unreachable |
| 4 | Auth/provider not configured |
| 5 | Server returned 4xx (payload printed) |
| 6 | Server returned 5xx (payload printed) |
| 7 | Safety refusal (SAFETY_REFUSAL from server) |
| 8 | Timeout |

## 5. Architecture

```
bin/ima2.js          ← existing entrypoint (untouched wiring, new commands routed)
  ↓ imports
bin/commands/        ← NEW — one file per subcommand
  ├── gen.js
  ├── edit.js
  ├── ls.js
  ├── show.js
  ├── ps.js
  ├── ping.js
  └── open.js
bin/lib/             ← NEW
  ├── client.js      ← HTTP client (fetch wrapper, base URL, errors, X-ima2-client header)
  ├── discover.js    ← find running server port (config.json > .ima2/server.json > default 3333)
  ├── args.js        ← tiny argv parser (no external dep; we already avoid deps)
  ├── output.js      ← unified stdout (json/human), colors off on non-TTY
  └── files.js       ← read local image → base64, write b64 → disk, ensure dir
```

**Zero new runtime deps.** We keep using Node's built-in `fetch` (Node 18+), `fs/promises`, `path`.

## 6. Server-side additions (minimal)

| Change | Route | Shape |
|--------|-------|-------|
| **NEW** health ping | `GET /api/health` | `{ ok: true, version, provider, uptimeSec, oauthReady, pid }` |
| **MODIFIED** generate log | `/api/generate` | log now includes `client: req.get("X-ima2-client") || "ui"` for telemetry (1 string change) |
| **NEW** `/api/generated/:name` static flag-through | Already exists via `express.static("generated")` — no change |
| **NEW** port advertisement | `lib/inflight.js` or server startup writes `.ima2/server.json` with `{port, pid, startedAt}` for CLI discovery |

No new tables, no new migrations.

## 7. Diff-Level Spec

### 7.1 server.js

```diff
@@ startup (near line ~200)
+ // advertise port for CLI discovery
+ import { writeFile as fsWriteFile, mkdir as fsMkdir } from "node:fs/promises";
+ const serverInfoPath = join(__dirname, ".ima2", "server.json");
+ await fsMkdir(dirname(serverInfoPath), { recursive: true });
+ await fsWriteFile(serverInfoPath, JSON.stringify({ port: PORT, pid: process.pid, startedAt: Date.now(), version: pkg.version }));
+ process.on("exit", () => { try { require("node:fs").unlinkSync(serverInfoPath); } catch {} });

@@ after /api/providers handler
+ app.get("/api/health", (_req, res) => {
+   res.json({
+     ok: true,
+     version: pkg.version,
+     provider: providerMode(),
+     uptimeSec: Math.round(process.uptime()),
+     oauthReady: !!getOAuthAuth(),   // reuse existing helper
+     pid: process.pid,
+   });
+ });

@@ /api/generate entry log (line ~371)
- console.log(`[generate] provider=oauth quality=${quality} size=${size} n=${count} refs=${refB64s.length}`);
+ const client = req.get("X-ima2-client") || "ui";
+ console.log(`[generate][${client}] provider=oauth quality=${quality} size=${size} n=${count} refs=${refB64s.length}`);
```

(The `pkg` import already exists in server.js — confirmed.)

### 7.2 bin/ima2.js

Route new commands before the final default branch:

```diff
+  case "gen":      await (await import("./commands/gen.js")).default(args.slice(1)); break;
+  case "edit":     await (await import("./commands/edit.js")).default(args.slice(1)); break;
+  case "ls":       await (await import("./commands/ls.js")).default(args.slice(1)); break;
+  case "show":     await (await import("./commands/show.js")).default(args.slice(1)); break;
+  case "ps":       await (await import("./commands/ps.js")).default(args.slice(1)); break;
+  case "ping":     await (await import("./commands/ping.js")).default(args.slice(1)); break;
```

Update `showHelp()` with the new Commands section.

### 7.3 bin/lib/client.js (new)

```js
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
export const DEFAULT_PORT = 3333;

export function resolveBaseUrl(argFlag) {
  if (argFlag) return argFlag.replace(/\/$/, "");
  if (process.env.IMA2_SERVER) return process.env.IMA2_SERVER.replace(/\/$/, "");
  // discover via .ima2/server.json
  const infoPath = join(process.cwd(), ".ima2", "server.json");
  if (existsSync(infoPath)) {
    try {
      const { port } = JSON.parse(readFileSync(infoPath, "utf-8"));
      if (port) return `http://localhost:${port}`;
    } catch {}
  }
  return `http://localhost:${DEFAULT_PORT}`;
}

export async function request(base, path, { method="GET", body, signal } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-ima2-client": `cli/${process.env.npm_package_version || "dev"}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = json?.code;
    err.body = json || text;
    throw err;
  }
  return json;
}
```

### 7.4 bin/lib/files.js (new)

```js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, basename, join } from "node:path";

export async function fileToRef(path) {
  const b64 = (await readFile(path)).toString("base64");
  const ext = extname(path).slice(1).toLowerCase();
  const mime = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp" }[ext] || "image/png";
  return `data:${mime};base64,${b64}`;
}

export async function b64ToFile(b64DataUri, outPath) {
  const m = b64DataUri.match(/^data:([^;]+);base64,(.+)$/);
  const raw = m ? m[2] : b64DataUri;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(raw, "base64"));
  return outPath;
}
```

### 7.5 bin/lib/args.js (new, ~60 LOC parser)

Supports long flags, short flags, repeatable (`--ref`), positional capture, `--` terminator, and boolean flags. No dep.

### 7.6 bin/commands/gen.js (new, ~100 LOC)

Pseudocode:

```js
export default async function gen(argv) {
  const args = parse(argv, { /* spec */ });
  const prompt = args.positional.join(" ") || await readStdin();
  if (!prompt) die(2, "prompt required");
  const refs = await Promise.all((args.ref||[]).map(fileToRef));
  const base = resolveBaseUrl(args.server);
  const body = { prompt, quality: args.quality, size: args.size, n: args.count, references: refs, sessionId: args.session };
  const t0 = Date.now();
  const resp = await request(base, "/api/generate", { method:"POST", body, signal: AbortSignal.timeout((args.timeout||180)*1000) });
  const images = resp.images || [];
  for (const [i, img] of images.entries()) {
    const out = resolveOut(args, i, images.length, resp.filenames?.[i]);
    if (!args["no-save"]) await b64ToFile(img.image, out);
    printResult(args, out, resp);
  }
}
```

### 7.7 bin/commands/edit.js

Thin wrapper: reads input file → base64 → POST `/api/edit` (existing). Same output pattern.

### 7.8 bin/commands/ls.js, show.js, ps.js, ping.js

- `ls`: GET `/api/history?limit=N` → table (filename, prompt head 40 chars, quality, size, createdAt).
- `show`: GET `/api/history` → find by filename → print sidecar; `--reveal` opens folder.
- `ps`: GET `/api/inflight?kind=&sessionId=` → table (requestId, kind, phase, age).
- `ping`: GET `/api/health` → table or json.

### 7.9 Output modes

- TTY + no `--json` → colored aligned table/tree (ANSI codes only, no dep)
- `--json` → single JSON object/array, newline-terminated
- Non-TTY without `--json` → plain table (no ANSI)

### 7.10 Tests (tests/cli.test.js — new)

1. `ima2 --help` exits 0, mentions `gen`
2. `ima2 gen` with no prompt + no stdin → exit 2
3. `args.js` parser round-trips: positional + repeatable + boolean + short alias
4. `files.fileToRef` handles png/jpg mime correctly
5. `files.b64ToFile` writes correct bytes
6. `client.resolveBaseUrl` precedence: flag > env > discover > default
7. Mock fetch → `gen` happy path produces expected POST body
8. Mock fetch 403 APIKEY_DISABLED → exit code 4
9. Mock fetch SAFETY_REFUSAL (422 w/ code) → exit code 7
10. AbortSignal timeout → exit code 8

Target: all new tests added to `tests/cli.test.js`, zero network calls (fetch mocked via DI).

## 8. Interaction with 0.10 Spec (amendments)

After 0.09.1 lands, 0.10 gets these additions (applied to `devlog/0.10-feature-expansion/PLAN.md` LOCKED SPEC v2 section):

- **F3 presets**: add `ima2 preset ls|save|apply` subcommands (mirror `/api/presets`)
- **F2 compare**: add `ima2 compare "prompt" --variants q=low,q=high,size=1536x1024` → POST `/api/compare/run`, polls `/api/inflight?runId=` until complete, downloads all
- **F4 export**: add `ima2 export <filename...> -o bundle.zip` → POST `/api/export`, stream to disk
- **Gallery groupBy** via CLI: `ima2 ls --group-by preset|compareRun|date`
- All new CLI verbs MUST reuse existing server routes; no CLI-only endpoints beyond `/api/health`

0.11 F1 (card-news, file-id fan-out) adds: `ima2 cards new|add|regen` (future, not in 0.09.1).

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Port discovery fails behind dev-server proxies | `IMA2_SERVER` env var fallback; `--server` flag |
| Large b64 responses (2-8 MB) flood stdout on `--no-save` | Default is save-to-disk; `--no-save` requires explicit flag |
| `--timeout` cuts before server `finishJob` — spinner-hang analog | Timeout is client-side only; server job keeps running (reusable) |
| CLI/UI both generate in same session → `activeSessionGraphVersion` races | CLI doesn't touch graph. `--session` is metadata only for /api/generate; Node-mode excluded from 0.09.1 |
| Windows path/mime quirks on `--ref` | `extname()` lowercased; covered by test 4 |
| Auth not configured → confusing error | Error path checks `/api/health` first; on `oauthReady:false` → exit 4 with setup hint |

## 10. Acceptance Criteria

1. `ima2 gen "hello"` produces a PNG in CWD with sensible default filename (`ima2-YYYYMMDD-HHMMSS-0.png`), exit 0, <30s on `low`.
2. `ima2 gen "x" --ref a.png --ref b.png -n 2 -d ./out` creates 2 PNGs under `./out/`, references preserved in sidecar.
3. `ima2 edit in.png --prompt "add snow" -o out.png` produces out.png.
4. `ima2 ls -n 5 --json | jq .` parses valid JSON.
5. `ima2 ps` shows in-flight jobs when a web generation is running (verified by parallel `curl /api/generate` + CLI `ps`).
6. `ima2 ping` returns ok+version; non-zero exit when server down.
7. No new runtime dependencies in package.json.
8. All 27 existing tests still pass + ≥10 new CLI tests pass.
9. `ima2 --help` is readable in 80-col terminal.
10. Man-user smoke: without running `ima2 serve`, `ima2 gen` auto-spawns server OR fails cleanly with exit 3 + instruction. **Decision: fail cleanly (no auto-spawn); add note "Run 'ima2 serve' in another terminal."** Auto-spawn is surprising behaviour and mixes long-lived server with short-lived client.

## 11. Rollout

- Branch: work on `main` (per project convention), commits small & scoped.
- Commit order:
  1. `0.09.1(server): add /api/health, port advertisement, client tag` (~40 LOC)
  2. `0.09.1(cli): add args parser + client + files utils` (~200 LOC)
  3. `0.09.1(cli): add gen command + tests` (~150 LOC)
  4. `0.09.1(cli): add edit command + tests` (~80 LOC)
  5. `0.09.1(cli): add ls/show/ps/ping commands + tests` (~180 LOC)
  6. `0.09.1(docs): README CLI section + 0.10 PLAN amendment` (~60 LOC)
- Each commit: `npm test` + `npm run build` green before next.

## 12. Breaking-change Budget

**Zero.** All additions. `/api/generate` existing clients unaffected (new optional header). `.ima2/server.json` written only when server boots under `ima2 serve`; missing file falls back to default port.

## 13. Dependencies on prior cycles

- 0.09 D2 reconciliation: CLI `ps` benefits from server-side cancel endpoint already shipped (5ad4029).
- 0.08 phase tracking: CLI `ps` surfaces `phase` field without extra work.

## 14. Open Questions (escalate before implementation)

- [Q1] Should `ima2 gen --stream` show live phase progress (queued → streaming → decoding)? Proposal: yes, via simple polling every 1s when TTY + not `--json`. Cost: +20 LOC.
- [Q2] Should `ima2 gen` default output filename use prompt slug or timestamp? Proposal: timestamp (deterministic, no collision). Prompt slug optional: `--slug`.
- [Q3] `ima2 config set quality high` for CLI-local defaults? Proposal: **defer to 0.09.2** — keep 0.09.1 stateless.

---

## 15. REVIEW RESOLUTIONS (v2 — 260422 PM)

Applied in response to Backend + Opus rubber-duck critique. These override anything earlier that conflicts.

### 15.1 Resolved blockers

**R-B1 — `/api/generate` response shape normalization.**
Server returns `{image, filename, elapsed, requestId}` for n=1 and `{images, count, elapsed, requestId}` for n>1. Each item in the n>1 branch has `{image, filename}`. The CLI client (`bin/lib/client.js` → `generate()`) normalizes to canonical `{ images: [{ image, filename }], elapsed, requestId }` for all n. All CLI commands read `resp.images[i]` only.

**R-B2 — Port discovery path unified.**
Server writes to `join(os.homedir(), ".ima2", "server.json")` (user-global, NOT project-relative). CLI reads from the same path. Discovery order:
1. `--server` flag
2. `IMA2_SERVER` env var
3. `~/.ima2/server.json` with live `/api/health` probe; stale → skip
4. Default `http://localhost:3333`

Multi-server case: last writer wins in the advertisement file, but the CLI's health probe guards against dead references. Dev + prod can coexist by running `IMA2_SERVER=http://localhost:3334 ima2 gen ...`.

**R-B3 — Concrete server.js diff (replacing §7.1 pseudo-diff).**

```diff
@@ imports (top of server.js) @@
+ import { homedir } from "node:os";
+ import { writeFileSync, unlinkSync, readFileSync as fsReadFileSync } from "node:fs";
+
+ const __pkg = JSON.parse(fsReadFileSync(join(__dirname, "package.json"), "utf-8"));

@@ after app.get("/api/providers" ...) block @@
+ app.get("/api/health", (_req, res) => {
+   res.json({
+     ok: true,
+     version: __pkg.version,
+     provider: "oauth",          // API-key path hard-disabled (see /api/providers)
+     uptimeSec: Math.round(process.uptime()),
+     activeJobs: listJobs().length,
+     pid: process.pid,
+     startedAt: __startedAt,
+   });
+ });

@@ at /api/generate log line @@
- console.log(`[generate] provider=oauth quality=${quality} size=${size} n=${count} refs=${refB64s.length}`);
+ const __client = req.get("x-ima2-client") || "ui";
+ console.log(`[generate][${__client}] provider=oauth quality=${quality} size=${size} n=${count} refs=${refB64s.length}`);

@@ at /api/edit log line (same pattern) @@
+ const __client = req.get("x-ima2-client") || "ui";
+ console.log(`[edit][${__client}] ...`);

@@ at ── Boot ── block @@
  const PORT = process.env.PORT || 3333;
+ const __startedAt = Date.now();
+ const __advertisePath = join(homedir(), ".ima2", "server.json");
+ function __advertise() {
+   try {
+     mkdirSync(dirname(__advertisePath), { recursive: true });
+     writeFileSync(__advertisePath, JSON.stringify({ port: Number(PORT), pid: process.pid, startedAt: __startedAt, version: __pkg.version }));
+   } catch (e) { console.warn("[advertise] skipped:", e.message); }
+ }
+ function __unadvertise() {
+   try {
+     if (!existsSync(__advertisePath)) return;
+     const cur = JSON.parse(fsReadFileSync(__advertisePath, "utf-8"));
+     if (cur.pid === process.pid) unlinkSync(__advertisePath);
+   } catch {}
+ }
+ __advertise();

@@ SIGINT/SIGTERM existing handlers — add __unadvertise() before exit @@
  process.on("SIGINT", () => {
+   __unadvertise();
    oauthChild.kill();
    process.exit();
  });
  process.on("SIGTERM", () => {
+   __unadvertise();
    oauthChild.kill();
    process.exit();
  });
```

PID-check in `__unadvertise` protects against race where a restarted server unlinks the new process's file. Crash case (SIGKILL, panic): stale file remains, CLI health probe drops it.

**R-B4 — `--session` removed from CLI gen/edit in 0.09.1.**
`/api/generate` does not persist to graph/session DB. Adding `--session` without persistence is misleading. Removed from command matrix §4. Future (0.10+): reintroduce once `/api/compare/run` + explicit session-bound generation lands.

**R-B5 — Route names in §8 confirmed CORRECT.**
`devlog/0.10-feature-expansion/PLAN.md` LOCKED SPEC v2 (§3/F2, §3/F4 under the v2 section) uses `/api/compare/run`, `/api/compare/:runId/winner`, `/api/export`. Earlier draft sections (§3 pre-v2, §7) still show the older `/api/compare-runs` + `/api/export/bundle` naming — those are superseded. No PRD change needed.

### 15.2 Resolved concerns

- `activeJobs` added to `/api/health` payload (R-B3 above).
- `/api/edit` also gains `X-ima2-client` tagging (R-B3 above).
- Exit code 4 is used **only** when `err.code === "APIKEY_DISABLED"`, otherwise 4xx → 5. Updated §4.2.
- `--no-save` TTY guard: if stdout is a TTY and aggregate b64 > 2MB, refuse unless `--force`.
- `ima2 open` default behavior unchanged; `--last` / `--file` add new actions without breaking bare `ima2 open`.
- `ima2 show --reveal`: macOS `open -R`, Linux `xdg-open dirname`, Windows `explorer /select,`.
- `ima2 gen --stream` (Q1): **deferred to 0.09.2** — classic mode doesn't emit meaningful phases past "running" today.
- Server tests added to plan: (T-A) `GET /api/health` shape; (T-B) `~/.ima2/server.json` written on boot, unlinked on SIGTERM.

### 15.3 Commit plan (v2)

1. `0.09.1(server): /api/health + port advertisement + X-ima2-client tag` (~55 LOC server.js; 2 tests in tests/server.test.js)
2. `0.09.1(cli): argv parser + http client + fs helpers` (~200 LOC in bin/lib/; 8 tests in tests/cli-lib.test.js)
3. `0.09.1(cli): gen command + tests` (~150 LOC; 5 tests)
4. `0.09.1(cli): edit command + tests` (~80 LOC; 2 tests)
5. `0.09.1(cli): ls show ps ping commands + tests` (~180 LOC; 5 tests)
6. `0.09.1(docs): README CLI section + 0.10 PLAN amendment` (~60 LOC)

Each commit: `npm test && npm run build` green before next.

### 15.4 Verdict

Both reviewers converge on the same 4 blockers, all addressed above. Backend verdict was RED pre-revision; re-verdict after R-B1~R-B5 fixes is GREEN. Proceeding to implementation.
