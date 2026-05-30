import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listHistoryRows } from "../lib/historyList.ts";

test("history rows include .mp4 video artifacts with mediaType video", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-history-video-"));
  try {
    await writeFile(join(dir, "clip.mp4"), Buffer.from("FAKE-MP4"));
    await writeFile(
      join(dir, "clip.mp4.json"),
      JSON.stringify({
        kind: "video",
        mediaType: "video",
        userPrompt: "animate this",
        provider: "grok",
        model: "grok-imagine-video",
        video: { duration: 1, resolution: "480p", aspectRatio: "auto", xaiVideoRequestId: "vid-1" },
        createdAt: 1000,
      }),
    );

    const rows = await listHistoryRows(dir);
    const row = rows.find((r) => r.filename === "clip.mp4");
    assert.ok(row, "expected clip.mp4 in history rows");
    assert.equal(row.mediaType, "video");
    assert.equal(row.video.resolution, "480p");
    assert.equal(row.video.xaiVideoRequestId, "vid-1");
    assert.equal(row.provider, "grok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("history rows default mediaType image for png", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-history-video-"));
  try {
    await writeFile(join(dir, "pic.png"), Buffer.from("FAKE-PNG"));
    const rows = await listHistoryRows(dir);
    const row = rows.find((r) => r.filename === "pic.png");
    assert.ok(row);
    assert.equal(row.mediaType, "image");
    assert.equal(row.video, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
