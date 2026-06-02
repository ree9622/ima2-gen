import { config } from "../../config.js";
import { backfillThumbnails } from "../../lib/thumbBackfill.js";
import { invalidateHistoryIndex } from "../../lib/historyIndex.js";

export async function backfillThumbs() {
  const dir = config.storage.generatedDir;
  console.log(`[thumbs] Scanning ${dir} (recursive) for missing thumbnails...`);

  let r;
  try {
    r = await backfillThumbnails(dir);
  } catch (e) {
    console.error("[thumbs] Backfill failed:", e instanceof Error ? e.message : e);
    return;
  }

  if (r.created > 0) invalidateHistoryIndex();
  console.log(`[thumbs] Done: ${r.created} created, ${r.skipped} skipped (already exist), ${r.failed} failed out of ${r.total} media files.`);
}
