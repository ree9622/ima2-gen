# Phase 3 — GPT Image Improvement Plan

Date: 2026-06-03

## Objective

Improve GPT image generation in `ima2-gen` by fixing metadata trust first, then adding latency observability, clearer batch semantics, and workflow features inspired by the Codex/ChatGPT image tool surfaces.

## Phase 0: Metadata Provider Attribution

Problem:

- The user saw Grok metadata while testing GPT image generation on `http://localhost:3333`.

Current evidence:

- Latest server-original GPT image entries show `provider:"oauth"` and `model:"gpt-5.5"`.
- CLI output copies have missing embedded metadata and incomplete history metadata.

Work:

- Reproduce the UI metadata panel behavior.
- Clear provider/model fields when selected item metadata is missing.
- Show metadata source in the panel.
- Decide whether CLI copies should copy sidecars, embed metadata, or be hidden from gallery history.

Exit criteria:

- GPT OAuth images cannot display Grok metadata.
- Metadata-empty files cannot inherit stale fields from a previous selection.

## Phase 1: Latency Instrumentation

Problem:

- Current metadata only records total elapsed time.
- The user needs to know whether delay is over-reasoning or image generation.

Work:

- Add phase timestamps around upstream request, streaming events, image generation calls, save, metadata write, and response send.
- Persist these timings into sidecar metadata.
- Add UI display for phase timings.
- Add CLI JSON output fields for phase timings.

Exit criteria:

- A slow run can be classified as model reasoning, image generation, queueing/upstream wait, or local save overhead.
- Existing evidence with `reasoning_tokens:0` and `elapsed:202.9` is recognized as image-generation/tool latency, not reasoning latency.

## Phase 2: Metadata Hardening

Problem:

- Server originals have good metadata.
- CLI copied files can appear as separate history items without full metadata.

Work:

- Preserve metadata when CLI copies images.
- Add a `metadataSource` field:
  - `sidecar`
  - `embedded`
  - `copied-sidecar`
  - `history-fallback`
  - `missing`
- Add a `sourceFilename` or `sourceRequestId` when output copies point back to originals.
- Ensure gallery de-duplicates or visually groups originals and copies from the same request.

Exit criteria:

- History and metadata modal agree on provider/model/request ID.
- Duplicate copy/original entries do not confuse provider attribution.

## Phase 3: GPT Prompt And Routing Improvements

Problem:

- GPT image requests can become slow or semantically ambiguous.
- Sequence and count modes must remain distinct.

Work:

- Keep Direct mode faithful to the user prompt.
- In Auto mode, add structured prompt sections only when useful.
- Add explicit batch prompt policy:
  - Count fanout: same prompt, repeated.
  - Sequence: distinct stage prompts.
- For image-only requests, avoid web search unless explicitly enabled.
- Prefer the narrowest image-generation tool route when supported by the upstream API.
- Persist prompt-mode decisions in metadata.

Exit criteria:

- Count without Sequence generates repeated same-prompt variations.
- Sequence generates separate stage prompts and never collapses all stages into one prompt.
- The prompt mode is auditable from metadata.

## Phase 4: Tool-Surface-Inspired UX

Work:

- Add reference image role labels:
  - edit target
  - style reference
  - composition reference
  - subject reference
  - background reference
- Add transparent-background intent:
  - native if supported
  - local chroma-key workflow if not
- Add style-transfer intent:
  - maps to prompt/reference role behavior, not a fake hidden parameter.
- Add batch count UX copy that makes same-prompt fanout explicit.

Exit criteria:

- UI controls describe user intent without pretending hidden ChatGPT/Codex tools are directly available.
- Metadata records actual implementation path.

## Phase 5: Verification And Regression Coverage

Work:

- Add contract tests for metadata provider/model/source fields.
- Add tests for sequence vs count behavior.
- Add tests for missing metadata UI state reset.
- Add CLI tests for copied output metadata preservation.
- Add manual/Browser QA script for 3333 gallery metadata display.

Exit criteria:

- `npm run typecheck` passes.
- `npm run typecheck:tests` passes.
- Relevant behavior tests pass.
- Browser QA proves the UI panel does not show stale Grok metadata on GPT images.

