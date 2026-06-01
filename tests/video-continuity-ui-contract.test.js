import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("video continuity UI contracts", () => {
  it("removes weak animateImage fallback and uses active prompt guidance", () => {
    const store = read("ui/src/store/useAppStore.ts");
    assert.doesNotMatch(store, /Animate this image with subtle, natural motion/);
    assert.match(store, /ACTIVE_VIDEO_PROMPT_GUIDANCE/);
    assert.match(store, /setVideoContinuityLineage/);
  });

  it("carries video lineage through drag producers and composer consumer", () => {
    assert.match(read("ui/src/components/GalleryImageTile.tsx"), /buildVideoDragPayload/);
    assert.match(read("ui/src/components/HistoryStrip.tsx"), /buildVideoDragPayload/);
    const composer = read("ui/src/components/PromptComposer.tsx");
    assert.match(composer, /continueFromItem/);
    const shared = read("ui/src/lib/continueFromItem.ts");
    assert.match(shared, /buildVideoContinuityFromItem/);
    assert.match(shared, /buildContinuityPromptChip/);
    assert.match(shared, /setVideoContinuityLineage/);
  });

  it("shows pending and selected continuity metadata in the right surfaces", () => {
    assert.match(read("ui/src/components/VideoControlsPanel.tsx"), /continuitySummary/);
    assert.match(read("ui/src/components/Canvas.tsx"), /continuitySummary\(currentImage\.videoContinuity\)/);
  });

  it("video generate request can include branch lineage and continueFromVideo", () => {
    const api = read("ui/src/lib/api.ts");
    assert.match(api, /continueFromVideo\?: string/);
    assert.match(api, /continuityLineage\?:/);
    const store = read("ui/src/store/useAppStore.ts");
    assert.match(store, /continueFromVideo,/);
    assert.match(store, /continuityLineage: parentVideoContinuity/);
  });

  it("clears pending continuity when its reference or prompt chip is removed", () => {
    const store = read("ui/src/store/useAppStore.ts");
    assert.match(store, /!prompt\.id\.startsWith\("video-continuity:"\)/);
    assert.match(store, /set\(\{ referenceImages: \[\], canvasReferenceImage: null, videoContinuityLineage: null, insertedPrompts \}\)/);
    assert.match(store, /id\.startsWith\("video-continuity:"\)/);
    assert.match(store, /set\(\{ insertedPrompts: \[\], videoContinuityLineage: null \}\)/);
  });
});
