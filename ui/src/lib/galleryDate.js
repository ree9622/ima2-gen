const DAY_MS = 86_400_000;

function timestampOf(value) {
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareGalleryItemsNewestFirst(a, b) {
  const byCreatedAt = timestampOf(b.createdAt) - timestampOf(a.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return String(b.filename ?? "").localeCompare(String(a.filename ?? ""));
}

function localDayStart(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function galleryDateBucket(createdAt, now = Date.now()) {
  const timestamp = timestampOf(createdAt);
  if (!timestamp) return "이전";

  const diffDays = Math.round(
    (localDayStart(now) - localDayStart(timestamp)) / DAY_MS,
  );
  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return "이번 주";
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
