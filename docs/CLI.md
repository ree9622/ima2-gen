# CLI Reference

Every server route under `/api/*` has a CLI wrapper. The CLI is a thin shell over the local server, so most commands require a running `ima2 serve` (the few exceptions — `serve`, `setup`, `doctor`, `status`, `open`, `reset`, `config`, `skill`, `capabilities`, and local `defaults` inspection — work without a live server).

For a quick start, see the [main README](../README.md). For endpoint mapping, see [API.md](API.md).

## Server commands

| Command | Description |
|---|---|
| `ima2 serve [--dev]` | Start the local web server; `--dev` enables verbose server diagnostics |
| `ima2 setup` / `ima2 login` | Reconfigure saved auth (interactive) |
| `ima2 status` | Show config and OAuth status |
| `ima2 doctor` | Diagnose Node, package, config, and auth |
| `ima2 open` | Open the web UI in a browser |
| `ima2 reset` | Remove saved config |

## Common flags

These work on most client commands:

| Flag | Meaning |
|---|---|
| `--server <url>` | Override server discovery (default uses `~/.ima2/server.json`, falls back to `IMA2_SERVER` env) |
| `--json` | Emit machine-readable JSON instead of human-formatted output |
| `-h`, `--help` | Show subcommand help |

## Agent discovery

Agents should start from the packaged skill and capability commands instead of guessing from scattered help text.

| Command | Description |
|---|---|
| `ima2 skill` | Print the packaged Markdown skill from `skills/ima2/SKILL.md` |
| `ima2 skill --json` | Print a JSON wrapper around the Markdown skill content |
| `ima2 skill path` | Print the installed skill file path |
| `ima2 capabilities --json` | Print supported commands, model/quality/reasoning values, and advisory limits |
| `ima2 defaults --json` | Print the running server's effective model/reasoning defaults, falling back to local config when no server is reachable |
| `ima2 defaults --local --json` | Print local effective defaults without contacting the server |

`ima2 capabilities --json` separates supported and unsupported model ids. Agents should use only `valid.imageModels.supported` for generation/default choices. `limits.maxParallel` is advisory queue guidance; it is not a server-side concurrency semaphore.

## Generation

| Command | Description |
|---|---|
| `ima2 gen <prompt>` | Generate from the CLI |
| `ima2 edit <file> --prompt <text>` | Edit an existing image |
| `ima2 multimode <prompt>` | Multi-image SSE generation (streams `phase` / `partial` / `image` events) |
| `ima2 node generate` | Node-mode generate (SSE; supports `--no-stream`) |
| `ima2 node show <nodeId>` | Read node metadata |

Generation flags include `--provider <auto|oauth|api>`, `--reasoning-effort {none\|low\|medium\|high\|xhigh}`, `--web-search` / `--no-web-search`, `--model`, `--mode`, `--moderation`, `--ref <file>` (repeatable, up to 5 where supported), `-q low|medium|high`, `-n <count>`, `-o <file>`.

Provider override semantics:

- `api` forces the API-key Responses path and requires a configured API key.
- `oauth` forces the local OAuth proxy path.
- `auto` preserves route default behavior and currently resolves to OAuth unless server routing changes.

```bash
ima2 gen "a poster of a samurai cat" --model gpt-5.4 --provider api --reasoning-effort high
ima2 edit input.png --prompt "make it rainy" --provider oauth --web-search
ima2 multimode "two cats playing" --max-images 2 --ref cat.png --mode direct
ima2 node generate --node n_abc --prompt "add neon lights" --no-stream
```

### Prompting with visible text

GPT Image 2 can render visible text in generated images. If the output needs
text, include the exact words in the target language and script instead of vague
phrases like "Korean text" or "Japanese words".

Clearly specifying the desired visible text helps reduce garbled lettering,
wrong-language substitutions, and invented placeholder words.

Use style words directly, such as `manga panel`, `webtoon style`, `children's
book illustration`, `photorealistic product photo`, or `realistic packaging
mockup`.

For dense or critical text, keep the text large and explicit. Exact placement,
small text, and pixel-perfect typography can still need iteration or post-editing.

Multimode-specific flags include `--max-images <1..8>`, `--ref <file>` (repeatable, max 5), `--mode <auto|direct>`, `--provider <auto|oauth|api>`, and `--show-partial`. `ima2 edit --mask` remains intentionally deferred to #31 because current mask plumbing is guided edit rather than guaranteed true masked/inpaint semantics.

## History and metadata

| Command | Description |
|---|---|
| `ima2 ls [--session <id>] [--favorites]` | List recent history; `--favorites` uses server-side favorites filtering before pagination |
| `ima2 show <name> [--metadata]` | Reveal a generated asset; optional embedded-metadata read |
| `ima2 history rm <name> [--permanent]` | Soft-delete (default) or permanently delete |
| `ima2 history restore --trash-id <id>` | Restore from trash |
| `ima2 history favorite <name>` | Toggle favorite (sends `X-Ima2-Browser-Id`) |
| `ima2 history import <file>` | Import a local image (raw PNG/JPEG/WEBP) into history |
| `ima2 metadata <file>` | Read embedded metadata from any local image (no server roundtrip needed for the read itself, but the route lives on the server) |

## Sessions and graphs

| Command | Description |
|---|---|
| `ima2 session ls / show <id> / create <title> / rm <id> / rename <id> <title>` | Session CRUD |
| `ima2 session graph save <id> --file <graph.json>` | Save a graph (uses GET-then-PUT with `If-Match` to guard against `GRAPH_VERSION_CONFLICT`) |
| `ima2 session graph load <id>` | Read the latest graph snapshot |
| `ima2 session style-sheet get <id> / put <id> --file <style.json> / enable <id> / disable <id> / extract <id>` | Style-sheet ops (advanced; UI no longer surfaces this — kept for API-level workflows) |

## Annotations and canvas

| Command | Description |
|---|---|
| `ima2 annotate get <name>` | Read annotation for an image |
| `ima2 annotate set <name> --body <json\|@file\|->` | Write annotation (sends `X-Ima2-Browser-Id`) |
| `ima2 annotate rm <name>` | Remove annotation |
| `ima2 canvas-versions save <imagefile> [--source <name>] [--prompt <text>]` | Save a raw PNG canvas version |
| `ima2 canvas-versions update <name> <imagefile>` | Update an existing canvas version |

## Prompt library

| Command | Description |
|---|---|
| `ima2 prompt ls [-q <search>] [--folder <id>] [--favorites]` | List prompts |
| `ima2 prompt show <id>` | Read one prompt |
| `ima2 prompt create --name <n> --text <t> [--folder <id>] [--tags <a,b>]` | Create |
| `ima2 prompt edit <id> [--name] [--text] [--folder] [--tags]` | Edit |
| `ima2 prompt rm <id>` | Delete |
| `ima2 prompt favorite <id>` | Toggle favorite |
| `ima2 prompt export <id> [-o <file>]` | Export one prompt to JSON |
| `ima2 prompt folder ls / create <name> / rename <id> <name> / rm <id> [--strategy moveToRoot\|deleteItems]` | Folder CRUD |
| `ima2 prompt import sources` | List configured import sources |
| `ima2 prompt import refresh --source <id>` | Re-index a source |
| `ima2 prompt import curated --source <id> --q <query>` | Curated import (commits prompts) |
| `ima2 prompt import discovery --q <query> --seeds <a,b,c>` | Discovery import (curator-only on some servers) |
| `ima2 prompt import folder <localpath>` | Import a local folder of prompts |
| `ima2 prompt import json <file\|@file\|-> [--folder <id>]` | Import a JSON export body through `/api/prompts/import` |
| `ima2 prompt import preview <file\|@file\|-> [--filename <name>]` | Preview local markdown/text candidates without committing |

## Card News (gated)

Card News requires the server to be started with `IMA2_CARD_NEWS=1` (or `features.cardNews: true` in `~/.ima2/config.json`). When disabled, the CLI exits 2 with a clear message instead of producing a 404.

| Command | Description |
|---|---|
| `ima2 cardnews templates` | List image-templates and role-templates |
| `ima2 cardnews template preview <id>` | Preview an image template |
| `ima2 cardnews sets` | List card sets |
| `ima2 cardnews set show <id>` / `set manifest <id>` | Show a set or its manifest |
| `ima2 cardnews draft / generate / export [--data <json>]` | Pass-through bodies (server forwards `req.body`) |
| `ima2 cardnews job create [--data <json>]` | Create + start a job |
| `ima2 cardnews job show <jobId>` | Show one job |
| `ima2 cardnews job retry <jobId> [--cards <id,id>]` | Retry a job (optionally specific cards) |
| `ima2 cardnews card regenerate <cardId> [--data <json>]` | Regenerate a single card |

## Observability and jobs

| Command | Description |
|---|---|
| `ima2 ps` | Alias for `inflight ls` (kept for backward compatibility) |
| `ima2 cancel <id>` | Alias for `inflight rm` |
| `ima2 inflight ls [--kind classic\|node\|multimode] [--session <id>] [--terminal]` | List active (and optionally terminal) jobs with phase / model / prompt |
| `ima2 inflight rm <requestId>` | Force-remove a stuck job |
| `ima2 storage status` | Storage inspection (richer than `doctor`) |
| `ima2 storage open` | Open the generated dir in the OS file manager (POST) |
| `ima2 billing` | API usage / quota |
| `ima2 providers` | Configured providers |
| `ima2 oauth status` | OAuth proxy state |
| `ima2 ping` | Health-check the running server |

## Config

`config` reads/writes `~/.ima2/config.json` (the file layer). Effective values follow `env > file > defaults`.

| Command | Description |
|---|---|
| `ima2 config path` | Print the config file path |
| `ima2 config ls [--effective]` | Print the file layer (default), or merged effective config with `--effective` |
| `ima2 config get <key>` | Read a dotted key from the effective config; secrets matching `/token\|secret\|apikey\|password/i` are redacted |
| `ima2 config set <key> <value>` | Write to the file layer; rejects unknown keys, refuses auth keys (`provider`, `apiKey`), warns when an env var is overriding the same key, prints a restart-required note |
| `ima2 config rm <key> [--yes]` | Remove a key from the file layer; non-TTY agents must pass `--yes` |
| `ima2 config keys [--json]` | List writable keys and the env vars that override them |

`defaults` is the agent-friendly wrapper for persistent image model and reasoning policy. It writes both OAuth and API-provider default keys so the user-facing "default model" stays one concept across provider paths.

| Command | Description |
|---|---|
| `ima2 defaults` / `ima2 defaults ls` | Show default model/reasoning values |
| `ima2 defaults --json` | Prefer running server defaults; fall back to local effective config |
| `ima2 defaults --local --json` | Read local effective config only |
| `ima2 defaults set model <model>` | Write `imageModels.default` and `apiProvider.defaultImageModel` |
| `ima2 defaults set reasoning <effort>` | Write `imageModels.reasoningEffort` and `apiProvider.defaultReasoningEffort` |
| `ima2 defaults reset model` | Remove persisted model defaults |
| `ima2 defaults reset reasoning` | Remove persisted reasoning defaults |

Allowed keys (whitelist):

```
imageModels.default          imageModels.reasoningEffort
apiProvider.defaultImageModel apiProvider.defaultReasoningEffort
log.level                    features.cardNews
cardNewsPlanner.{enabled,model,timeoutMs,deterministicFallback}
comfy.{defaultUrl,uploadTimeoutMs,maxUploadBytes}
storage.{generatedDir,generatedDirName}
server.{port,host,bodyLimit}
oauth.{proxyPort,statusTimeoutMs,restartDelayMs}
limits.{maxRefCount,maxParallel}
history.{defaultPageSize,maxPageCap}
```

To change `provider` / `apiKey`, run `ima2 setup` or `ima2 login` instead.

## Other

| Command | Description |
|---|---|
| `ima2 comfy export <filename>` | Export a ComfyUI workflow (`POST /api/comfy/export-image`) |

## Discovery

The server writes `~/.ima2/server.json` on start. CLI commands read this file to find the actual port (the backend can fall back from `3333` to `3334+`). Override discovery with `--server <url>` or `IMA2_SERVER=http://localhost:3333`.

## Examples

```bash
# Generation with reasoning effort and web search
ima2 gen "poster" --model gpt-5.4 --moderation low --reasoning-effort high
ima2 edit input.png --prompt "make it rainy" --web-search
ima2 multimode "two cats playing" --max-images 2 --ref cat.png --mode direct -o cat.png

# History and metadata
ima2 ls --session sess_abc --favorites
ima2 show img_xyz.png --metadata
ima2 history import ./local.png

# Prompts
ima2 prompt ls -q sunset
ima2 prompt import refresh --source curated
ima2 prompt import preview ./prompts.md --json
ima2 prompt import json ./prompts-export.json --folder __root__

# Observability
ima2 inflight ls --terminal
ima2 storage status --json

# Config
ima2 skill --json
ima2 capabilities --json
ima2 defaults set model gpt-5.5
ima2 defaults set reasoning high
ima2 config set imageModels.reasoningEffort high
ima2 config get log.level
ima2 config keys --json
ima2 config ls --effective --json
```
