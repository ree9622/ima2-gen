# Phase 4 — Verification Matrix

Date: 2026-06-03

## Requirements

| Requirement | Evidence Needed | Current Status |
| --- | --- | --- |
| GPT generation is not mislabeled as Grok | CLI/server metadata and UI metadata panel agree | CLI evidence says OAuth; UI reproduction pending |
| Metadata-empty files do not show stale provider | Browser QA after selecting Grok then empty copy | Pending |
| Latency cause is separable | Phase timestamps and usage tokens in sidecar | Partial; current evidence has elapsed + reasoning tokens |
| Count means same-prompt fanout | Backend and prompt tests | Already patched in prior sequence work |
| Sequence means staged prompts | Backend and real OAuth sequence generation | Already patched in prior sequence work |
| Three image tool docs are incorporated into planning | Devlog comparison document | Done in this plan set |
| No hidden assistant tool is treated as directly pluggable API | Plan explicitly states non-goal | Done in this plan set |
| SAFETY_INTENT_POLICY removed | promptSafetyPolicy.ts exports empty or removed | Pending — research complete |
| Negative prompt injection removed | Developer prompt no longer appends "avoid bad anatomy..." | Pending |
| Prompt builder safety rules softened | systemPrompt.ts no longer pre-filters with vague rules | Pending |
| Professional context frame added | Developer prompt includes "professional creative tool" framing | Pending |
| Moderation error distinguishes Stage 1 vs Stage 2 | Error response includes stage info + actionable guidance | Pending |
| Simple prompts no longer blocked | "여자 일러스트 그려줘" and equivalent succeed without moderation_blocked | Pending — requires runtime test |
| Moderation research documented | 05_moderation-censorship-research.md with 9 techniques, 21 sources | Done |

## Commands To Re-Run After Implementation

Static and unit verification:

```bash
npm run typecheck
npm run typecheck:tests
npm test
```

Focused sequence/count verification:

```bash
node --test tests/prompt-fidelity.test.ts tests/multimode-backend-contract.test.js tests/multimode-ui-contract.test.js
```

Server metadata verification:

```bash
node bin/ima2.js ping --server http://localhost:3333 --json
node bin/ima2.js ls -n 25 --server http://localhost:3333 --json
node bin/ima2.js metadata /Users/jun/.ima2/generated/ima2-20260603-025859-0.png --json
```

Browser QA:

```bash
cli-jaw browser start --agent
cli-jaw browser navigate "http://localhost:3333"
cli-jaw browser snapshot --interactive
```

Moderation reduction verification:

```bash
# Before/after comparison: simple prompts that previously triggered moderation
node bin/ima2.js gen --provider oauth --model gpt-5.4-mini --quality low --size 1024x1024 --json --server http://localhost:3333 "여자 일러스트 그려줘"
node bin/ima2.js gen --provider oauth --model gpt-5.4-mini --quality low --size 1024x1024 --json --server http://localhost:3333 "a knight fighting a dragon"
node bin/ima2.js gen --provider oauth --model gpt-5.4-mini --quality low --size 1024x1024 --json --server http://localhost:3333 "character reference sheet, guy in shorts"
node bin/ima2.js gen --provider oauth --model gpt-5.4-mini --quality low --size 1024x1024 --json --server http://localhost:3333 "make the character skin a little paler"
```

Manual browser assertions:

- Click a known GPT OAuth original file.
- Confirm provider/model/request ID.
- Click a known Grok video file.
- Click a metadata-empty CLI copy file.
- Confirm Grok provider/model is cleared.

## Evidence Captured So Far

| Evidence | Result |
| --- | --- |
| `node bin/ima2.js ping --server http://localhost:3333 --json` | server provider `oauth`, OAuth ready, Grok proxy available |
| `node bin/ima2.js ls -n 25 --server http://localhost:3333 --json` | latest originals provider `oauth`, model `gpt-5.5`; CLI copies missing full metadata |
| `node bin/ima2.js metadata /Users/jun/.ima2/generated/ima2-20260603-025859-0.png --json` | `IMAGE_METADATA_NOT_FOUND` |
| text-only OAuth proxy probes | 1.3-2.6s |
| GPT image batch probe | 202.9s, count 3, `reasoning_tokens:0`, `webSearchCalls:0` |
| Browser screenshot `/Users/jun/.cli-jaw-3470/uploads/1780423750197_b2e1a130_Screenshot2026-06-03at30838AM.png` | status line shows no provider, only elapsed/tokens/reasoning/quality/size/model |
| Frontend code inspection | viewer used current UI quality/size fallback; generated history mapping used current UI fallback for missing response metadata |

## Immediate Next Patch Candidates

1. Frontend metadata panel reset:
   - clear selected metadata state before async load
   - render explicit missing state
   - do not carry provider/model from previous selection
2. Backend/gallery metadata source:
   - expose `metadataSource`
   - preserve source linkage for CLI copies
3. CLI output copy metadata:
   - copy sidecar or embed source metadata into output copies
4. Latency phase timings:
   - persist phase timing object to sidecar
   - surface timing object in CLI JSON and metadata modal
5. Viewer metadata fallback removal:
   - show only selected image metadata in the result status line
   - never show current UI provider/model/quality/size as historical result metadata
