// URL helpers for /generated/.thumbs/<rel>.{thumb|web}.webp derivatives.
// Server-side derivePreviews emits these alongside every saved image.
//
// Returns null when input isn't an owned /generated/* asset (refs, external
// data: URLs, missing) so callers can fall back to the original.

const PREFIX = "/generated/";
const THUMBS_PREFIX = "/generated/.thumbs/";
const REFS_PREFIX = "/generated/.refs/";

function buildVariant(url: string | null | undefined, suffix: string): string | null {
  if (!url) return null;
  if (!url.startsWith(PREFIX)) return null;
  if (url.startsWith(THUMBS_PREFIX) || url.startsWith(REFS_PREFIX)) return null;
  const rest = url.slice(PREFIX.length);
  return `${THUMBS_PREFIX}${rest}${suffix}`;
}

export function thumbVariant(url: string | null | undefined): string | null {
  return buildVariant(url, ".thumb.webp");
}

export function webVariant(url: string | null | undefined): string | null {
  return buildVariant(url, ".web.webp");
}

import type { SyntheticEvent } from "react";

// onError handler that swaps to the original URL on first failure.
// Usage: <img src={thumb ?? original} onError={fallbackTo(original)} />
export function fallbackTo(original: string | null | undefined) {
  return (e: SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    if (el.dataset.fallback === "1" || !original) return;
    el.dataset.fallback = "1";
    el.src = original;
  };
}
