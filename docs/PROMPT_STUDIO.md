# Prompt Studio Manual

Prompt Studio is the Classic workspace profile for repeated image iteration. It
keeps the image viewer in the center, recent generations on the side, and the
composer plus generation controls close to the current image.

Use this page when you are not sure what a Prompt Studio control does or when
you want a reproducible way to report a workspace issue.

## Feature Map

| Area | What it does | Notes |
|---|---|---|
| Composer | Holds the prompt for the next request. | Selecting an existing image is view-only. It should not overwrite the composer. |
| Multimode | Starts several separate image requests from the current prompt. | Each slot is a candidate output, not a collage panel or a guaranteed scene sequence. |
| 1:1 Direct | Sends the prompt through with less rewriting by the app. | Use it for exact wording, strict prompt experiments, or provider-side prompt syntax. |
| Model quick menu | Changes the image model and reasoning effort from the sidebar header. | The full Settings workspace remains the detailed configuration page. |
| Recent generations | Shows the visible Prompt Studio history domain. | Arrow keys move inside the same visible recent domain instead of hidden older rows. |
| Gallery | Browses saved local images, All/Favorites tabs, and folders. | Favorite toggles should preserve the gallery viewport you were browsing. |
| Prompt library | Imports saved prompt text into the composer intentionally. | Library insert/continue actions are explicit prompt imports; passive image selection is not. |

## Multimode Prompting

Multimode repeats one generation request shape across several candidate slots.
It is useful when you want alternatives, not when you need one combined
multi-panel image.

For related candidates, put the shared subject first and the variation rule
second:

```text
Same character design in every image: a silver-haired courier in a red raincoat.
Make 4 alternatives that vary only camera angle, lighting, and background street.
Keep face, outfit, age, and color palette consistent.
```

For unrelated candidates, say so directly:

```text
Create 4 unrelated sticker ideas for a local image generation app.
Each image should use a different mascot, color palette, and composition.
```

If you need a true two-panel comic, contact sheet, before/after comparison, or
collage, ask for that in a single normal image request instead of relying on
multimode slots:

```text
Create one 2-panel comparison image. Left panel: rough sketch UI. Right panel:
polished Prompt Studio UI. Add small labels inside each panel.
```

## Direct Mode

Use **1:1 Direct** when the exact prompt text matters. It is helpful for:

- comparing prompt wording changes,
- preserving a structured prompt template,
- using provider-specific instruction style,
- avoiding app-side phrasing changes during troubleshooting.

Direct mode can be used together with Multimode. In that case, each multimode
slot receives the same direct prompt request shape.

## Reasoning Effort

Reasoning effort controls how much planning the selected model may spend before
or during generation. Start with the default for everyday work. Raise it when
the prompt has many constraints, references, or composition requirements.

The sidebar model label opens quick settings for both model and reasoning. The
Settings workspace still shows the full model configuration and explanatory
copy.

## Gallery And Prompt Safety

Prompt Studio separates browsing from composing:

- Passive image selection is view-only.
- Clicking a history or gallery image focuses the image for viewing.
- Favorite on/off changes the saved image metadata and should not jump your
  gallery browsing position.
- The All and Favorites tabs are browsing filters. Switching between them does
  not intentionally import a prompt.
- Prompt Library insert, "continue from this image", and explicit reuse actions
  are the actions that intentionally change the composer.

Before generating, glance at the composer if you were using explicit prompt
import actions. Passive image selection should leave your draft alone.

## Issue #75 Closeout Notes

The v1.1.13 Prompt Studio fixes tightened these user-visible contracts:

- concurrent multimode completions keep their slot/request identity,
- keyboard navigation follows the visible recent history domain,
- the gallery button remains reachable beside recent history,
- long prompts no longer starve the default image viewer,
- Direct and Multimode states can be seen at the same time,
- gallery favorite toggles and tab changes preserve the browsing viewport,
- passive image selection does not refill the composer.

## Reporting A Prompt Studio Problem

When opening an issue, include:

- `ima2-gen` version and operating system,
- browser and viewport size if layout is involved,
- workspace profile, mode toggles, model, reasoning effort, and image count,
- numbered steps from a fresh `ima2 serve` session,
- whether the problem happens in All, Favorites, or recent history,
- safe screenshots or screen recordings if they do not reveal private prompts.

Do not share ChatGPT cookies, OAuth token files, API keys, raw upstream
responses, private prompt history, or generated base64 data.
