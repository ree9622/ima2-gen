# Research: AGY Windows Cross-Platform Issues

Date: 2026-06-03

## Problem

Community report: AGY image generation succeeds on Windows (artifact file exists) but ima2-gen UI shows failure. Image is not registered in gallery.

Root cause: Node child_process pipe on Windows may include `\r` in stdout, and AGY may output Windows-style paths (`C:\Users\...`) that the RESULT line parser doesn't handle.

## Patched Issues

### 1. Carriage Return in stdout (`\r`)

Windows child processes output `\r\n` line endings. The parser was splitting on `\n` only, leaving `\r` at the end of lines.

```ts
// BEFORE — \r remains in line content
const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);

// AFTER — strip \r globally first
const lines = stdout.replace(/\r/g, "").trim().split("\n").filter((l) => l.trim().length > 0);
```

Impact: `"RESULT|C:\path\to\file.png|png\r"` → `parts[2]` was `"png\r"` not `"png"`. Also added `.trim()` to each parsed part.

### 2. Windows Drive Letter in Path Regex

The fallback path regex only matched Unix-style paths starting with `/`.

```ts
// BEFORE — Unix only
/\/[^\s"']+\/(brain|artifacts)\/[^\s"']+\.(png|jpg|jpeg|webp)/i

// AFTER — optional drive letter + .gemini directory
/(?:[A-Za-z]:)?\/[^\s"']+\/(brain|artifacts|\.gemini)\/[^\s"']+\.(png|jpg|jpeg|webp)/i
```

Impact: `C:/Users/user/.gemini/artifacts/img.png` now matches. Also added `.gemini` to directory patterns since Gemini CLI stores artifacts there.

### 3. Artifact Cleanup on Failure

Added `cleanupAgyArtifact()` that removes the artifact file and its parent directory (if empty) after successful read. On failure, ref temp files are still cleaned via the existing `cleanup()` in `finally`.

## Cross-Platform Handling Inventory

| Component | macOS/Linux | Windows | File |
|---|---|---|---|
| AGY spawn | `spawn("agy", ...)` | Same + `USERPROFILE`/`TEMP` env | `lib/agyImageAdapter.ts` |
| Binary resolution | `"name"` | `"name.cmd"` via `resolveBin()` | `bin/lib/platform.ts:33` |
| Shell routing | `shell: false` | `shell: isWin` (for .cmd) | `bin/lib/platform.ts:40` |
| Path separator | `/` | `\` → normalize to `/` for comparison | Multiple files |
| Line endings | `\n` | `\r\n` → strip `\r` | `lib/agyImageAdapter.ts:54` |
| Signal handling | `SIGKILL` | `SIGTERM` (SIGKILL not supported) | `lib/videoThumb.ts:29` |
| Process tree kill | `process.kill(pid)` | `taskkill /T /F /PID` | `bin/lib/platform.ts:116` |
| Browser open | `open` | `cmd /c start` | `bin/lib/platform.ts:57` |
| WSL detection | N/A | Check `/proc/version` for "microsoft" | `bin/lib/platform.ts:13` |

## Existing Cross-Platform Tests

File: `tests/open-directory.test.ts`

- Platform command selection (darwin/win32/linux)
- Windows immediate success behavior
- `windowsHide`/`detached` flags
- Windows paths with spaces
- Windows paths with non-ASCII (Korean)

## PowerShell Execution Policy

Community report: `npm.ps1` blocked by execution policy.

This is NOT an ima2-gen bug. It's a Windows PowerShell default setting. Solution:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Or use CMD instead of PowerShell. Already documented in:
- `README.md` (install scripts)
- `docs/FAQ.md` (Windows troubleshooting)

## References

- Community report: AGY pipe failure on Windows (갤로그 2026-06-03)
- Community report: Failed generation residual folders (갤로그 2026-06-03)
- Community report: PowerShell execution policy (갤로그 2026-06-03)
