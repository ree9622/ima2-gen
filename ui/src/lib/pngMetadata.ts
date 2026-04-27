// Browser-side PNG tEXt chunk reader. Mirrors lib/imageMetadata.js (server)
// but uses Uint8Array + TextDecoder so the user's uploaded file stays in the
// browser — no server round-trip needed for restore (Phase 6.2).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

const utf8Decoder = new TextDecoder("utf-8");
const latin1Decoder = new TextDecoder("latin1");

export type PngTextChunks = Record<string, string>;

export function readPngTextChunksFromBytes(bytes: Uint8Array): PngTextChunks {
  if (!isPngBytes(bytes)) {
    throw new Error("not a PNG");
  }
  const out: PngTextChunks = {};
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUInt32BE(bytes, offset);
    const type = asciiSlice(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break; // truncated; bail gracefully
    if (type === "tEXt") {
      const data = bytes.subarray(dataStart, dataEnd);
      let sep = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) {
          sep = i;
          break;
        }
      }
      if (sep >= 0) {
        const keyword = latin1Decoder.decode(data.subarray(0, sep));
        const value = utf8Decoder.decode(data.subarray(sep + 1));
        out[keyword] = value;
      }
    }
    offset = dataEnd + 4; // skip CRC
    if (type === "IEND") break;
  }
  return out;
}

export async function readPngMetadata(file: File): Promise<PngTextChunks> {
  const buf = await file.arrayBuffer();
  return readPngTextChunksFromBytes(new Uint8Array(buf));
}

// Restored fields object — only the ima2:* namespace, prefix stripped.
export type Ima2Metadata = {
  version?: string;
  prompt?: string;
  revisedPrompt?: string;
  size?: string;
  quality?: string;
  model?: string;
  createdAt?: string;
};

const IMA2_KEY_RE = /^ima2:([a-zA-Z0-9_]+)$/;

export function pickIma2Metadata(chunks: PngTextChunks): Ima2Metadata {
  const out: Ima2Metadata = {};
  for (const [key, value] of Object.entries(chunks)) {
    const m = key.match(IMA2_KEY_RE);
    if (!m) continue;
    (out as Record<string, string>)[m[1]] = value;
  }
  return out;
}

export async function readIma2MetadataFromFile(file: File): Promise<Ima2Metadata> {
  return pickIma2Metadata(await readPngMetadata(file));
}
