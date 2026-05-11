# Upstream idea reimplementation log

Last updated: 2026-05-11

This fork does not copy or cherry-pick code from `lidge-jun/ima2-gen` for the
2026-05 feature catch-up. The upstream repository is used only as a behavior and
product-reference source. Changes are reimplemented in this fork's server, UI,
store, and CLI structure.

## Source checked

- Upstream repository: `https://github.com/lidge-jun/ima2-gen`
- Latest release checked: `v1.1.10`, published 2026-05-05 UTC
- Post-release upstream commits checked through `f385860 docs(cli): archive issue 61 parity plan`

## Reimplemented features

| Area | Our commit | Upstream idea | What changed here |
|------|------------|---------------|-------------------|
| Gallery | `2cf2c56 feat(gallery): load older history pages` | Scaled history loading, older favorites/cancel gallery work, page-key navigation | Gallery opens with a bounded first page, then loads older history through cursor pagination. Store state tracks cursor, total count, and loading. Loaded rows are deduped. Lightbox accepts PageUp/PageDown and vertical arrows. |
| Toasts | `3afcd24 feat(ui): stack toast notifications` | Bottom-right stacked toasts | Store keeps a capped toast log. UI renders a dismissible bottom-right stack with auto-expiry while preserving the previous single-toast compatibility field. |
| Prompt policy | `5c91b50 feat(prompt): judge intent from explicit context` | Prompt safety intent policy | Default system prompt now tells the model to judge intent from explicit prompt/reference context instead of inferring unsafe intent from appearance, clothing, body type, camera angle, or styling alone. |
| Cancellation | `d7fe5b2 feat(generate): abort canceled inflight jobs` | In-flight cancel contract | `DELETE /api/inflight/:requestId` now aborts active generation controllers. Cancel propagates through queued throttle waits, prompt rewrite calls, retry sleeps, generate/edit/node OAuth requests, and returns `GENERATION_CANCELED`/HTTP 499 for canceled API work. |
| CLI parity | `eb1322e feat(cli): align generation options` | Classic generation parity options | `ima2 gen` supports `--format`, `--moderation`, and `--max-attempts`; `ima2 edit` supports `--moderation` and `--max-attempts`. Both send a stable `requestId`. Default output extension follows requested format. |
| CLI recovery | `0ffef43 feat(cli): recover outputs after timeout` | Output recovery after client timeout | When `ima2 gen` or `ima2 edit` hits a client-side timeout, the CLI polls `/api/generation-log` for the same `requestId`, downloads completed image URLs, and saves them locally. Timeout exit code is used only if recovery also fails. |

## User-visible behavior

### Gallery

- The first gallery load is intentionally bounded for large histories.
- When the user scrolls near the end or presses the load-more control, older
  pages are fetched and merged into the store without duplicates.
- Date grouping can use server `total`/cursor information. Filtered or session
  grouping views continue to use the loaded item set.

### Toasts

- Multiple errors no longer overwrite each other.
- Toasts can be dismissed one by one.
- The stack is capped to prevent unbounded UI growth.

### Cancellation

- Canceling an in-flight job is now a real abort signal, not just a UI state
  transition.
- Classic generate, edit, node generate, safety rewrite, network retry sleeps,
  and queued OAuth slot waits all check the same cancellation path.
- Canceled requests are represented as `GENERATION_CANCELED` with HTTP 499.

### CLI

Examples:

```bash
ima2 gen "studio product shot" --format webp --moderation low --max-attempts 7 -o shot.webp
ima2 gen "four editorial variants" -n 4 --format jpeg -d out/
ima2 edit input.png --prompt "turn it into a catalog image" --moderation low --max-attempts 5 -o edited.png
```

If a command times out locally after the server accepted the request, keep the
server running. The CLI will use the request id to look for a completed output
and save it if available.

## Verification

The batch was verified on the asrock deployment checkout with Node
`/home/ko/.nvm/versions/node/v24.15.0/bin` in `PATH`.

```bash
npm test
npm run build
sudo systemctl restart ima2-gen.service
curl -sS -o /tmp/ima2-main.out -w "main:%{http_code}\n" https://images.samlab.click/
curl -sS -o /tmp/ima2-health.out -w "health:%{http_code}\n" https://images.samlab.click/api/health
```

Observed result: 384 tests passed, production build completed, service active,
main page HTTP 200, health endpoint HTTP 200.

## Remaining upstream candidates

| Candidate | Upstream commit | Status | Reason |
|-----------|-----------------|--------|--------|
| Multimode incremental sequence outputs | `343292c` | Next meaningful candidate | Larger backend/store/UI stream behavior change; should be implemented with dedicated multimode contracts. |
| Settings row readability | `70cd4d5` | Small candidate | Mobile CSS readability improvement; lower impact than CLI/cancel/gallery work. |
| Windows gallery folder path | `fb31dbb` | Low priority / likely skip | Mostly local desktop convenience, low value for the deployed web app. |
