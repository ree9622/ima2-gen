# Phase 1 — GPT Image Latency Probe Plan

Date: 2026-06-03

## Goal

Separate these two causes of slow GPT image responses:

1. Slow model reasoning before image generation.
2. Slow image generation/tool execution after little or no reasoning.

The user's current observation is that GPT image generation can take around 200 seconds. Phase 1 must prove where that time goes.

## Completed Probe Evidence

### Text-Only OAuth Proxy Baseline

Responses API compatible endpoint:

| Probe | Elapsed |
| --- | ---: |
| trivial direct response | 1.332s |
| complex reasoning-shaped prompt with final short output | 1.470s |

Chat Completions compatible endpoint:

| Probe | Elapsed | Output |
| --- | ---: | --- |
| trivial direct response | 2.200s | `ㅇㅇㅇ` |
| complex reasoning-shaped prompt with final short output | 2.627s | `ㅇㅇㅇ` |

Interpretation:

- The OAuth proxy itself is responsive.
- Text-only reasoning-shaped prompts are not producing 200 second delays.
- The observed 200 second latency is unlikely to be caused by normal text over-reasoning alone.

### GPT Image Batch Probe

Command shape:

```bash
node bin/ima2.js gen \
  --provider oauth \
  --model gpt-5.5 \
  --quality medium \
  --reasoning-effort medium \
  --size 1024x1024 \
  --count 3 \
  --no-web-search \
  --json \
  --timeout 700 \
  --server http://localhost:3333
```

Observed result:

| Field | Value |
| --- | --- |
| Request ID | `req_cli_gen_mpwxuhu3_hh99uu` |
| Count | 3 |
| Wall elapsed | 203.058s |
| Server elapsed | 202.9s |
| Provider | `oauth` |
| Model | `gpt-5.5` |
| Quality | `medium` |
| Web search calls | 0 |
| Reasoning tokens | 0 |

Generated originals:

```text
/Users/jun/.ima2/generated/1780423138970_aed455ea_0.png
/Users/jun/.ima2/generated/1780423139031_229875b8_1.png
/Users/jun/.ima2/generated/1780423139079_01213aa0_2.png
```

CLI copies:

```text
/Users/jun/.ima2/generated/ima2-20260603-025859-0.png
/Users/jun/.ima2/generated/ima2-20260603-025859-1.png
/Users/jun/.ima2/generated/ima2-20260603-025859-2.png
```

Interpretation:

- The slow request produced `reasoning_tokens:0`.
- Web search was disabled and no web search calls occurred.
- The delay is therefore much more likely to be inside image generation/tool execution, queueing, streaming wait, or save/finalization.

### Interrupted Probe

A second batch was started and then canceled after the user redirected the task to metadata analysis:

```bash
node bin/ima2.js cancel req_cli_gen_mpwxyuik_aanqvl --server http://localhost:3333
node bin/ima2.js ps --server http://localhost:3333 --json
```

Evidence after cancellation:

```json
{
  "jobs": []
}
```

## Missing Instrumentation

Current elapsed time is too coarse. It records total duration, but not the internal boundary where time is spent.

Phase 1 needs per-request phase timestamps:

| Timestamp | Meaning |
| --- | --- |
| `requestStartedAt` | app received generation request |
| `upstreamRequestStartedAt` | request sent to OAuth proxy/OpenAI endpoint |
| `upstreamHeadersAt` | upstream responded with headers |
| `firstResponseEventAt` | first streaming event received |
| `firstTextDeltaAt` | first model text delta received, if any |
| `firstImageCallAt` | first image generation call/event observed |
| `firstImagePartialAt` | first partial/image bytes observed, if exposed |
| `firstImageCompleteAt` | first complete image payload observed |
| `allImagesCompleteAt` | all requested images received |
| `saveStartedAt` | local save started |
| `metadataWrittenAt` | sidecar/embed completed |
| `responseSentAt` | API returned to CLI/UI |

## Test Matrix

Run each test three times after Phase 0 metadata trust is fixed:

| Case | Provider | Model | Count | Quality | Search | Expected evidence |
| --- | --- | --- | ---: | --- | --- | --- |
| Text trivial | OAuth proxy | GPT text | 1 | n/a | off | < 5s baseline |
| Text complex | OAuth proxy | GPT text | 1 | n/a | off | < 5s baseline |
| Image simple | OAuth | `gpt-5.4-mini` | 1 | low | off | per-phase timings |
| Image simple | OAuth | `gpt-5.4-mini` | 3 | low | off | batch spread |
| Image complex | OAuth | `gpt-5.5` | 1 | medium | off | per-phase timings |
| Image complex | OAuth | `gpt-5.5` | 3 | medium | off | batch spread |
| Image complex | OAuth | `gpt-5.5` | 3 | medium | on | search isolation |

## Acceptance Criteria

- The app can distinguish "thinking" time from "image generation" time in logs and metadata.
- Metadata records `reasoning_tokens`, `webSearchCalls`, and phase timestamps together.
- The UI can display a truthful phase label:
  - preparing request
  - model reasoning
  - image generation
  - saving result
- A slow request with `reasoning_tokens:0` is classified as image-generation/tool latency, not over-reasoning.

