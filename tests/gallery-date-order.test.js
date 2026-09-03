import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareGalleryItemsNewestFirst,
  galleryDateBucket,
} from "../ui/src/lib/galleryDate.js";

test("gallery items are sorted newest-first before date grouping", () => {
  const newest = new Date(2026, 8, 3, 13, 0).getTime();
  const olderToday = new Date(2026, 8, 3, 9, 0).getTime();
  const yesterday = new Date(2026, 8, 2, 22, 0).getTime();

  const shuffled = [
    { filename: "yesterday.png", createdAt: yesterday },
    { filename: "older-today.png", createdAt: olderToday },
    { filename: "newest.png", createdAt: newest },
    { filename: "missing-date.png" },
  ];

  assert.deepEqual(
    shuffled.sort(compareGalleryItemsNewestFirst).map((item) => item.filename),
    ["newest.png", "older-today.png", "yesterday.png", "missing-date.png"],
  );
});

test("date buckets follow local calendar days instead of elapsed 24-hour windows", () => {
  const now = new Date(2026, 8, 3, 13, 0).getTime();
  const lateYesterday = new Date(2026, 8, 2, 23, 30).getTime();
  const twoDaysAgo = new Date(2026, 8, 1, 23, 30).getTime();

  assert.equal(galleryDateBucket(now, now), "오늘");
  assert.equal(galleryDateBucket(lateYesterday, now), "어제");
  assert.equal(galleryDateBucket(twoDaysAgo, now), "이번 주");
  assert.equal(galleryDateBucket(undefined, now), "이전");
});
