# Phase 0 — 3333 Metadata Provider Mismatch

Date: 2026-06-03

## Problem

The user observed that metadata shown from the local app at `http://localhost:3333` appears to be Grok metadata even while the intended test path is GPT image generation through GPT OAuth.

This phase exists before latency work because provider attribution must be trustworthy. If the UI metadata panel is showing the wrong provider, GPT latency and GPT image QA results can be misclassified.

## Current Evidence

### User Screenshot Evidence

Source:

```text
/Users/jun/.cli-jaw-3470/uploads/1780423750197_b2e1a130_Screenshot2026-06-03at30838AM.png
```

Visible status line:

```text
202.9s · 2623 tokens · R:m · m · 1024² · 5.5
```

Interpretation:

- The status line does not display an explicit provider.
- `5.5` is the image model short label.
- `m` after `R:m` is the quality short label.
- For metadata-empty entries, the existing UI can fall back to the currently selected UI quality/size/model state, making the line look like current settings rather than source metadata.

### Server Runtime

Command:

```bash
node bin/ima2.js ping --server http://localhost:3333 --json
```

Evidence:

```json
{
  "ok": true,
  "base": "http://localhost:3333",
  "version": "2.0.1",
  "provider": "oauth",
  "runtime": {
    "oauth": {
      "actualPort": 10533,
      "status": "ready"
    },
    "grok": {
      "actualPort": 18648,
      "url": "http://127.0.0.1:18648/v1"
    }
  }
}
```

Interpretation:

- The app server default provider is `oauth`, not `grok`.
- Grok proxy is available as a runtime capability, but availability alone does not mean the active generation request used Grok.

### Latest GPT Image Batch Original Files

Command:

```bash
node bin/ima2.js ls -n 25 --server http://localhost:3333 --json
```

Representative original entries:

```json
{
  "filename": "1780423139079_01213aa0_2.png",
  "provider": "oauth",
  "model": "gpt-5.5",
  "quality": "medium",
  "size": "1024x1024",
  "reasoningEffort": "medium",
  "elapsed": 202.9,
  "requestId": "req_cli_gen_mpwxuhu3_hh99uu",
  "kind": "classic",
  "usage": {
    "output_tokens_details": {
      "reasoning_tokens": 0
    }
  },
  "webSearchCalls": 0
}
```

Interpretation:

- The latest measured GPT image originals are not Grok.
- Provider is `oauth`.
- Model is `gpt-5.5`.
- Reasoning tokens are `0`, so the 202.9 second run is not explained by long model reasoning.

### CLI Copy Files

The CLI also created user-facing copied files:

```text
/Users/jun/.ima2/generated/ima2-20260603-025859-0.png
/Users/jun/.ima2/generated/ima2-20260603-025859-1.png
/Users/jun/.ima2/generated/ima2-20260603-025859-2.png
```

Command:

```bash
node bin/ima2.js metadata /Users/jun/.ima2/generated/ima2-20260603-025859-0.png --json
```

Evidence:

```json
{
  "metadata": null,
  "source": null,
  "code": "IMAGE_METADATA_NOT_FOUND",
  "warning": "No ima2 metadata found in this image."
}
```

The history API still lists these copies with partial fallback fields:

```json
{
  "filename": "ima2-20260603-025859-0.png",
  "provider": "oauth",
  "model": null,
  "prompt": null,
  "elapsed": null,
  "requestId": null,
  "thumb": null
}
```

Interpretation:

- The copied CLI output files do not contain embedded ima2 metadata.
- They also do not have full sidecar metadata like the server-original `178042313...png` files.
- If the UI metadata panel opens one of these copy entries, it has incomplete metadata and may rely on stale panel state, nearby history data, or fallback provider labels.

## Leading Hypotheses

### H0. Actual GPT Generation Was Routed To Grok

Current status: contradicted by available evidence.

Evidence against:

- `ping` reports server provider `oauth`.
- Latest original image sidecars show `provider:"oauth"` and `model:"gpt-5.5"`.
- Active job metadata observed during generation reported `model:"gpt-5.5"` and `n:3`.

Remaining check:

- Reproduce the exact UI click path that showed Grok to confirm the user was looking at the same files.

### H1. UI Selected A Grok Video Or Older Grok Item

Current status: plausible.

Evidence:

- The generated directory contains older Grok video sidecars such as `provider:"grok"` and `model:"grok-imagine-video-1.5-preview"`.
- The latest history list contains mixed media entries from image and video work.

Test:

- In the 3333 UI, click the exact latest GPT original image, then inspect the metadata panel.
- Click a Grok video item, then return to a metadata-empty CLI copy and verify whether the provider label clears.

### H2. Metadata Panel Does Not Clear Provider When Selected Entry Has Null Metadata

Current status: highly plausible.

Evidence:

- CLI copy entries have `model:null`, `prompt:null`, `elapsed:null`, and no embedded metadata.
- A stale provider badge would explain why a previous Grok label appears while the selected file itself has no metadata.

Test:

- Use Browser/Computer Use against `http://localhost:3333`.
- Select a known Grok item.
- Select `/generated/ima2-20260603-025859-0.png`.
- Verify whether the provider/model fields reset to unknown/OAuth/null or remain Grok.

Expected fix if confirmed:

- Treat missing metadata as an explicit empty state.
- Clear provider/model/elapsed fields on image selection before loading details.
- Show metadata source: `sidecar`, `embedded`, `history fallback`, or `missing`.

### H4. Viewer Status Line Uses Current UI Settings As Metadata Fallback

Current status: confirmed in frontend code.

Evidence:

```ts
const displayQuality = formatQualityAlias(currentImage?.quality ?? quality);
const displaySize = formatSizeAlias(currentImage?.size ?? getResolvedSize());
```

Generation response mapping also contained fallback patterns:

```ts
quality: res.quality ?? s.quality
size: res.size ?? size
model: res.model ?? s.imageModel
reasoningEffort: res.reasoningEffort ?? s.reasoningEffort
```

Impact:

- If an item has missing or incomplete metadata, the viewer can show the currently selected UI settings as if they were result metadata.
- If the user switches to Grok, a metadata-empty or incomplete item can look Grok-related even when the actual original sidecar is GPT OAuth.

Expected fix:

- Viewer status must show only `currentImage` metadata.
- Generate response mapping should not substitute current UI state when the server omits result metadata.
- Missing metadata should remain missing or explicitly display as unknown.

### H3. CLI Copy History Entries Should Not Be Duplicated Without Metadata

Current status: plausible product bug.

Evidence:

- The original files already have full metadata and thumbnails.
- The CLI copies are listed as separate history items with incomplete metadata.
- This creates two visible entries for one generation result: one authoritative, one incomplete.

Expected fix if confirmed:

Choose one of:

1. Copy sidecar metadata when creating CLI output copies.
2. Embed metadata into CLI copies.
3. Suppress imported CLI copy entries from gallery history.
4. Link copy entries to the original file metadata through `sourceFilename` or `requestId`.

## Phase 0 QA Procedure

1. Open `http://localhost:3333` in the browser automation session.
2. Locate latest files:
   - `1780423138970_aed455ea_0.png`
   - `1780423139031_229875b8_1.png`
   - `1780423139079_01213aa0_2.png`
   - `ima2-20260603-025859-0.png`
   - `ima2-20260603-025859-1.png`
   - `ima2-20260603-025859-2.png`
3. For each original file, verify the UI metadata reads:
   - Provider: GPT OAuth / OAuth
   - Model: `gpt-5.5`
   - Quality: `medium`
   - Size: `1024x1024`
   - Request ID: `req_cli_gen_mpwxuhu3_hh99uu`
4. For each CLI copy file, verify the UI does not show stale Grok fields.
5. Click a known Grok video entry, then click a CLI copy again.
6. Confirm provider/model reset behavior.
7. Inspect frontend metadata display code if stale UI state is reproduced.

## Acceptance Criteria

- A GPT OAuth original image never displays Grok metadata.
- A metadata-empty copied file does not inherit provider/model from the previously selected item.
- The UI exposes enough source context to explain metadata trust level.
- The gallery does not present duplicate generated outputs in a way that makes provider attribution ambiguous.
