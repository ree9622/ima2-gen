// Reference-image lineage resolution.
//
// Each generated image stores in its sidecar a `references` array describing
// which images were used as visual references when it was created. Two cases:
//
//   - kind: "history"  — the user attached an existing generated/<file> as
//                        a reference (e.g. via "현재 결과 사용"). We verify
//                        by re-hashing and skip saving a duplicate copy.
//
//   - kind: "uploaded" — the user attached an image we have never seen
//                        (drag-drop / file picker). We persist it to
//                        generated/.refs/<hash>.png so the Lightbox can
//                        display the thumbnail on later sessions even if
//                        the original file is gone.
//
// The client may send a `referenceMeta` array as a hint (parallel to
// `references`) saying "this one came from history file X". We always
// re-hash and verify so a malicious or stale hint cannot misattribute.

import { createHash } from "crypto";
import { writeFile, mkdir, stat, readFile } from "fs/promises";
import { join } from "path";

const HASH_ALGO = "sha256";

export function hashRefBase64(b64) {
  return createHash(HASH_ALGO).update(Buffer.from(b64, "base64")).digest("hex");
}

// Best-effort PNG/JPEG sniff so the persisted ref file has a sensible ext.
// Falls back to .png if signature is unrecognized.
function detectExt(buf) {
  if (!buf || buf.length < 4) return "png";
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpg";
  }
  // WEBP: "RIFF....WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "webp";
  }
  return "png";
}

// Resolves each reference base64 into a lineage record. Returns
// Array<{ kind, hash, filename?, sourceUrl }> in input order.
//
// Side effects: persists previously-unseen uploads to
// <generatedDir>/.refs/<hash>.<ext> (idempotent — skips if already saved).
export async function resolveRefLineage(refB64s, { generatedDir, hint = [] } = {}) {
  if (!Array.isArray(refB64s) || refB64s.length === 0) return [];
  await mkdir(join(generatedDir, ".refs"), { recursive: true });

  const out = [];
  for (let i = 0; i < refB64s.length; i++) {
    const b64 = refB64s[i];
    const buf = Buffer.from(b64, "base64");
    const hash = createHash(HASH_ALGO).update(buf).digest("hex");
    const hintMeta = hint[i] || {};

    // Try to attribute to an existing history file when the client claims so.
    if (hintMeta.kind === "history" && typeof hintMeta.filename === "string") {
      // Defense in depth: only allow plain filenames, no path traversal.
      if (/^[\w.\-]+$/.test(hintMeta.filename)) {
        try {
          const orig = await readFile(join(generatedDir, hintMeta.filename));
          const origHash = createHash(HASH_ALGO).update(orig).digest("hex");
          if (origHash === hash) {
            out.push({
              kind: "history",
              hash,
              filename: hintMeta.filename,
              sourceUrl: `/generated/${encodeURIComponent(hintMeta.filename)}`,
            });
            continue;
          }
        } catch {
          // missing / unreadable — fall through to uploaded persistence
        }
      }
    }

    // Fresh upload (or history-claimed ref whose hash didn't match).
    const ext = detectExt(buf);
    const refRel = `.refs/${hash}.${ext}`;
    const refAbs = join(generatedDir, refRel);
    try {
      await stat(refAbs);
      // already saved — dedup; nothing to write.
    } catch {
      await writeFile(refAbs, buf);
    }
    out.push({
      kind: "uploaded",
      hash,
      sourceUrl: `/generated/${refRel}`,
    });
  }
  return out;
}
