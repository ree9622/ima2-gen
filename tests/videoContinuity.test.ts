import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_VIDEO_PROMPT_GUIDANCE,
  appendVideoContinuityEntry,
  formatVideoContinuityForPlanner,
  requireActiveVideoPrompt,
  trimLineageEntries,
  type VideoContinuityEntry,
} from "../lib/videoContinuity.ts";

function entry(n: number): VideoContinuityEntry {
  return {
    id: `clip:${n}`,
    ordinal: n,
    role: n === 1 ? "start" : "ancestor",
    filename: `${n}.mp4`,
    userPrompt: `user ${n}`,
    revisedPrompt: `revised ${n}`,
    createdAt: n,
  };
}

test("video continuity retention keeps start plus latest three entries", () => {
  const trimmed = trimLineageEntries([1, 2, 3, 4, 5].map(entry));
  assert.deepEqual(trimmed.map((item) => item.filename), ["1.mp4", "3.mp4", "4.mp4", "5.mp4"]);
  assert.deepEqual(trimmed.map((item) => item.ordinal), [1, 2, 3, 4]);
});

test("appendVideoContinuityEntry adds current clip and formats planner context", () => {
  const parent = appendVideoContinuityEntry(null, {
    filename: "b.mp4",
    userPrompt: "start moving",
    revisedPrompt: "A character starts walking while rain fades in.",
    createdAt: 1,
  });
  const child = appendVideoContinuityEntry(parent, {
    filename: "c.mp4",
    userPrompt: "turn around",
    revisedPrompt: "The character turns around as music cuts out.",
    createdAt: 2,
  });
  assert.equal(child.entries.length, 2);
  assert.equal(child.entries[0].role, "start");
  assert.equal(child.entries[1].role, "current");
  const formatted = formatVideoContinuityForPlanner(child);
  assert.match(formatted, /Continuity lineage/);
  assert.match(formatted, /1\. Clip 1 \/ start/);
  assert.match(formatted, /2\. Clip 2 \/ current/);
  assert.match(formatted, /Do not restart/);
});

test("active video prompt guard only blocks blank input", () => {
  assert.equal(requireActiveVideoPrompt("  "), null);
  assert.equal(requireActiveVideoPrompt("  비가 그치고 대사가 끝난다  "), "비가 그치고 대사가 끝난다");
  assert.match(ACTIVE_VIDEO_PROMPT_GUIDANCE, /motion flow/);
  assert.match(ACTIVE_VIDEO_PROMPT_GUIDANCE, /ending frame/);
});
