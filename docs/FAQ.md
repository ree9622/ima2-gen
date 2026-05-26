# ima2-gen FAQ

Last reviewed: 2026-05-26

This FAQ collects the questions that tend to come up after installing or updating `ima2-gen`. The README stays short; this page is the place for practical details and recovery steps.

For Korean, see [FAQ.ko.md](FAQ.ko.md).

## Quick fixes

| Symptom | Try first |
|---|---|
| The server is unreachable | Run `ima2 serve`, then `ima2 ping`. |
| OAuth login fails | Run `npx @openai/codex login`, then restart `ima2 serve`. |
| API key provider says `API_KEY_REQUIRED` | Configure an API key, or switch back to the OAuth provider. |
| Old gallery images look missing | Run `ima2 doctor`, then see [Recover Old Generated Images](RECOVER_OLD_IMAGES.md). |
| `gpt-5.5` fails | Update Codex CLI first, then try `gpt-5.4` as the stable fallback. |
| Reference upload fails | Use JPEG/PNG, lower the resolution, and keep references to 5 images or fewer. |
| Prompt Studio controls are unclear | Read the [Prompt Studio manual](PROMPT_STUDIO.md) for multimode, Direct, reasoning, and gallery behavior. |
| Image generation returns `EMPTY_RESPONSE` or no image data | Run `ima2 doctor image-probe --json`, then collect the safe support bundle below. |
| Windows reports OAuth/proxy failures around port `10531` | Run `ima2 doctor`; if needed start with `IMA2_OAUTH_PROXY_PORT=11531 ima2 serve`. |
| `fetch failed` repeats on a proxy/VPN network | Enable proxy TUN/TURN-style mode, or set `HTTP_PROXY` / `HTTPS_PROXY` in the same terminal. |

## Install and update

### What version of Node do I need?

Use Node.js 20 or newer. The package declares Node `>=20`, and the README badge follows that requirement.

### Should I use `npx` or a global install?

Both are supported.

```bash
npx ima2-gen serve
```

or:

```bash
npm install -g ima2-gen
ima2 serve
```

If an old global install behaves strangely, update first:

```bash
npm install -g ima2-gen@latest
```

Then run:

```bash
ima2 doctor
```

### Windows says `spawn EINVAL`. What should I do?

Update to the latest version. Older versions had trouble spawning npm/npx shims on Windows. Current builds route those commands through a Windows-safe path.

If Codex login itself is unreliable on native Windows, WSL can be the more predictable environment.

### Windows says `EBUSY` or `resource busy or locked` during update. What should I do?

This usually means npm cannot replace the global package because a running
`ima2 serve`, stale `node.exe`, terminal, Explorer window, antivirus, or indexer
still holds the package folder. Stop ima2, close related terminals, end stale
`node.exe` processes if needed, then retry:

```bash
npm install -g ima2-gen@latest
```

If the lock persists, reboot Windows and run the update before starting ima2
again.

## Authentication and providers

### Do I need an OpenAI API key?

No for the default generation path. The normal path uses your local Codex/ChatGPT OAuth session.

If you configure an API key, image generation routes can also use `provider: "api"` through the Responses API `image_generation` tool.

### Why does the settings page say "API key provider available"?

It means `ima2-gen` found a valid API key. API-key mode can generate, edit, run multimode, and create node outputs. If no key is configured, `provider: "api"` fails before upstream with `API_KEY_REQUIRED`.

### If Codex CLI is already logged in, does ima2-gen reuse it?

Yes. `ima2-gen` checks for an existing Codex login and uses the local OAuth path. If detection fails or the token expires, run:

```bash
npx @openai/codex login
ima2 doctor
```

Then restart `ima2 serve`.

### What if I see `Provided authentication token is expired`?

Your Codex/ChatGPT OAuth session needs to be refreshed.

```bash
npx @openai/codex login
ima2 serve
```

If this happens on a company network, a firewall, VPN, proxy, or captive portal may also be blocking the OAuth flow.

## Models and quota

### Which model should I use?

Start with `gpt-5.4` for the safest balanced workflow.

- `gpt-5.4`: recommended balanced choice.
- `gpt-5.4-mini`: current app default and faster draft model.
- `gpt-5.5`: strongest quality option when supported.

### Why does `gpt-5.5` fail when other models work?

`gpt-5.5` may require a newer Codex CLI, backend capability, or account/quota availability. Update Codex CLI first. If it still fails, use `gpt-5.4` as the stable fallback.

### How many images can Plus or Pro generate?

Do not treat any community number as a guarantee. OAuth generation can be limited by account, backend capability, traffic, and policy changes. `ima2-gen` does not publish a fixed Plus/Pro image count because that number is not stable enough to document as a promise.

## Prompt Studio and multimode

### Is there a detailed Prompt Studio manual?

Yes. See the [Prompt Studio manual](PROMPT_STUDIO.md). It explains the composer,
multimode slots, 1:1 Direct, model/reasoning quick settings, recent history,
gallery favorites, and which actions intentionally import prompt text.

### Why did multimode images look unrelated?

Multimode starts several separate image requests from the same prompt. The slots
are candidate outputs, not panels inside one shared canvas and not a guaranteed
story sequence. To get related alternatives, write the common subject first and
then name the allowed variations. To get one multi-panel image, use a normal
single-image request and ask for a two-panel, collage, or contact-sheet layout.

### Should selecting a gallery image change my current prompt?

Passive image selection is view-only. It should focus the selected image without
rewriting the composer. Prompt Library insert, "continue from this image", and
other explicit reuse actions are the actions that intentionally change prompt
text.

### What changed for issue #75?

The Prompt Studio closeout fixed navigation and state-coupling regressions:
keyboard movement now follows the visible recent history domain, the gallery
entry remains reachable, long prompts no longer starve the image viewer,
Direct and Multimode states are visible together, gallery favorites preserve the
browsing viewport, and passive image selection does not refill the composer.

## Gallery and generated files

### Where are generated images stored?

Current versions store generated images in your user data folder:

```text
macOS / Linux: ~/.ima2/generated
Windows: %USERPROFILE%\.ima2\generated
```

You can override that with `IMA2_GENERATED_DIR`.

### Why did old gallery images look missing after an update?

Older versions stored generated images inside the installed package folder. Recent versions moved the gallery to user data storage so package updates do not mix app code with runtime files.

Sorry for the scare. If the old global install folder was replaced during an update, the previous `generated/` folder may no longer be on disk. `ima2-gen` can recover old files only when that old folder still exists.

Run:

```bash
ima2 doctor
```

Then follow [Recover Old Generated Images](RECOVER_OLD_IMAGES.md).

### Does ima2-gen delete my old images during this migration?

No. The migration is copy-only. It does not delete or move legacy folders. If old files are not found, the likely issue is that the old global install folder is no longer present on disk.

### What does "Open folder" open?

The gallery's **Open folder** button opens the generated image folder on the machine running `ima2 serve`.

That is usually your own computer. If you are using a remote server, SSH session, VM, container, WSL, or another machine on your network, the folder opens or resolves on that server machine, not necessarily on the browser device.

### Is Card News part of the stable public release?

Not yet. Card News is still dev-only and experimental. The default published
runtime should keep it hidden unless it is explicitly enabled for development,
and public docs should not treat it as a stable feature.

## Reference images

### How many reference images can I attach?

Up to 5.

### What formats work best?

Use JPEG or PNG. The browser path does not support HEIC/HEIF directly, so convert those images before attaching them.

### What if a reference image is too large?

The app compresses large JPEG/PNG files before upload. If a file still fails, lower the resolution or convert it to JPEG/PNG and try again.

The API may report reference errors such as `REF_TOO_MANY`, `REF_TOO_LARGE`, `REF_NOT_BASE64`, or `REF_EMPTY`.

## Network and OAuth errors

### Why did the backend or OAuth proxy move to another port?

`ima2-gen` is a local app. If the preferred backend port `3333` or OAuth proxy port `10531` is already in use, the runtime can fall back to the next available port and records the actual URLs in:

```text
~/.ima2/server.json
```

Use:

```bash
ima2 doctor
```

to see the configured and actual backend/OAuth URLs.

### Windows: what if `AnySign4PC.exe` owns port `10531`?

Some Windows security software can occupy the default OAuth proxy port. Current builds track the actual fallback port, but you can also force a quieter range:

```bash
IMA2_OAUTH_PROXY_PORT=11531 ima2 serve
```

For split frontend development, point Vite at the actual backend:

```bash
VITE_IMA2_API_TARGET=http://localhost:3334 npm run ui:dev
```

### What does `failed to fetch` mean?

Usually one of these:

- the local OAuth proxy is not ready,
- the server was restarted,
- a VPN/proxy/firewall blocked the request,
- an auto-start Windows network interception tool, including a DNS/fragmentation
  bypass tool such as SecretDNS, broke OAuth or streaming image transport,
- the network dropped while Codex/ChatGPT OAuth was being used.

Try:

```bash
ima2 doctor
ima2 ping
```

Then restart `ima2 serve` if needed.

### What should I share when OAuth image generation returns no image?

Use the image probe before assuming moderation. `EMPTY_RESPONSE` means the
Responses path did not produce image data that `ima2-gen` could use; it can be
caused by OAuth capability, stream parsing, web-search/tool-choice behavior,
local proxy/network transport, unsupported options, or a real refusal.

Run this first:

```bash
ima2 doctor
ima2 doctor image-probe --json > ima2-image-probe.json
```

If `ima2 serve` is running, also capture one search-off and one normal cat
generation result:

```bash
ima2 gen "고양이" --no-web-search --json > ima2-cat-no-search.json
ima2 gen "고양이" --json > ima2-cat-current.json
```

The probe JSON is designed to be safe to attach to a public issue. It reports
diagnostic codes, event counts, tool-call summaries, and byte counts, but not
prompt text, auth tokens, credential URLs, or base64 image data.

When opening an issue, include:

- `ima2 doctor` output.
- `ima2-image-probe.json`.
- `ima2-cat-no-search.json` and `ima2-cat-current.json`, if you captured them.
- `ima2-gen` version and Windows version.
- Whether you use VPN, corporate proxy, antivirus TLS inspection, or a custom CA.
- Whether a Windows DNS/fragmentation bypass tool such as SecretDNS is running
  automatically.
- Whether `provider: "api"` works on the same machine, if you already have an API key configured.

Do not share ChatGPT cookies, OAuth token files, API keys, raw upstream
responses, prompt history, or generated base64.

How to read the result:

- Text probe fails: refresh OAuth and inspect proxy/model availability first.
- Text works but minimal non-stream image fails: likely account, OAuth backend, model, or image-tool capability.
- Non-stream image works but stream image fails: likely stream parsing or transport.
- Search-off generation works but normal generation fails: likely web-search/tool-choice interaction.
- Bytes were read but no events were parsed: likely SSE delimiter or `data:` parsing.

### What if `fetch failed` keeps happening behind a proxy or VPN?

This usually means the local OAuth proxy cannot reach the upstream service through your network path. `openai-oauth` runs as a local localhost proxy, commonly on port `10531`.

Try:

```bash
npx openai-oauth --port 10531
```

If your network requires a proxy, enable your proxy client's TUN/TURN-style mode so terminal processes can use it. On Windows, also temporarily disable auto-start DNS or fragmentation bypass tools such as SecretDNS and retry. If that is not enough, set the proxy variables in the same terminal that runs `openai-oauth` or `ima2 serve`:

```bash
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890
```

Use the host and port from your proxy client. If `ima2-gen` still fails after the local OAuth proxy is reachable, collect the exact command, OS, proxy setup, and terminal error before opening a new issue.

### What should I check on a company computer?

OAuth may require access to OpenAI and ChatGPT/Codex-related hosts. A corporate firewall, TLS inspection, VPN, or proxy can break the flow. Try a different network if login and `failed to fetch` errors keep repeating.

## CLI troubleshooting checklist

Run these in order:

```bash
ima2 doctor
ima2 status
ima2 ping
ima2 ps
npx @openai/codex login
npm install -g ima2-gen@latest
```

If you run the server on a non-default port:

```bash
IMA2_SERVER=http://localhost:3333 ima2 ping
```
