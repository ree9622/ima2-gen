import assert from "node:assert/strict";
import test from "node:test";
import {
  publishJobEvent,
  replayJobEvents,
  resetJobEventsForTests,
  subscribeJobEvents,
} from "../lib/eventBus.js";

test.beforeEach(() => resetJobEventsForTests());

test("event bus publishes live events and replays only the authenticated owner", () => {
  const live = [];
  const unsubscribe = subscribeJobEvents((event) => live.push(event));
  publishJobEvent("alice", "job-a", "phase", { phase: "queued" });
  publishJobEvent("bob", "job-b", "done", { filename: "b.png" });
  unsubscribe();

  assert.equal(live.length, 2);
  assert.deepEqual(replayJobEvents(0, "alice").map((event) => event.jobId), ["job-a"]);
  assert.deepEqual(replayJobEvents(0, "bob").map((event) => event.jobId), ["job-b"]);
});

test("event replay strips base64 while live delivery keeps the partial image", () => {
  const image = `data:image/png;base64,${"a".repeat(1500)}`;
  let live = null;
  const unsubscribe = subscribeJobEvents((event) => { live = event; });
  publishJobEvent("alice", "job-a", "partial", { image, index: 0 });
  unsubscribe();

  assert.equal(live.data.image, image);
  const [replayed] = replayJobEvents(0, "alice");
  assert.equal(replayed.data.image, undefined);
  assert.equal(replayed.data._imageOmitted, true);
});
