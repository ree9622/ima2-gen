// PNG tEXt 청크 read/write — 외부 라이브러리 없이 표준 PNG 구조만 다룬다.
// 우리 fork 식 구현: ima2:* keyword 네임스페이스로 prompt/size/quality 등을
// PNG 자체에 박아서 사용자가 그 PNG를 다시 업로드하면 폼을 복원할 수 있게 한다.
// (Phase 6.2, 참조: upstream e1b72fc — 우리는 XMP 대신 PNG tEXt + 클라 파싱)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_TYPE = Buffer.from("tEXt", "ascii");
const IEND_TYPE = "IEND";

// PNG keyword 제약: 1-79 byte Latin-1, no leading/trailing/consecutive space, no NUL.
// 우리는 ima2:[a-zA-Z0-9_]+만 받는다.
const KEYWORD_RE = /^ima2:[a-zA-Z0-9_]{1,72}$/;

const MAX_VALUE_BYTES = 64 * 1024; // 64KB per field — prompts can be long but not pathological

function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

// PNG-spec CRC32 (ISO 3309 / Annex D). Computed over chunk type + data.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function pngCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildTextChunk(keyword, value) {
  const keywordBuf = Buffer.from(keyword, "latin1");
  const valueBuf = Buffer.from(value, "utf8"); // see PRD §2 — UTF-8 raw bytes
  if (valueBuf.length > MAX_VALUE_BYTES) {
    throw new Error(`tEXt value for "${keyword}" exceeds ${MAX_VALUE_BYTES} bytes`);
  }
  const data = Buffer.concat([keywordBuf, Buffer.from([0]), valueBuf]);

  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([TEXT_TYPE, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(crcInput), 0);

  return Buffer.concat([length, TEXT_TYPE, data, crc]);
}

function* iterateChunks(buf) {
  let offset = 8; // skip signature
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buf.length) {
      throw new Error(`PNG truncated at chunk ${type}`);
    }
    yield {
      type,
      offset,
      crcEnd,
      data: buf.subarray(dataStart, dataEnd),
    };
    offset = crcEnd;
    if (type === IEND_TYPE) return;
  }
}

// Insert tEXt chunks immediately before IEND. Returns a new Buffer.
// `entries` accepts both { key: value } object or [[key, value], ...] array.
// Throws if input is not a PNG, IEND not found, or any keyword is invalid.
export function writeTextChunks(pngBuffer, entries) {
  if (!isPng(pngBuffer)) {
    throw new Error("input is not a PNG");
  }
  const pairs = Array.isArray(entries) ? entries : Object.entries(entries || {});
  const validated = [];
  for (const [keyword, rawValue] of pairs) {
    if (typeof keyword !== "string" || !KEYWORD_RE.test(keyword)) {
      throw new Error(`invalid tEXt keyword: ${JSON.stringify(keyword)}`);
    }
    const value = rawValue == null ? "" : String(rawValue);
    validated.push([keyword, value]);
  }
  if (validated.length === 0) return pngBuffer;

  let iendStart = -1;
  for (const chunk of iterateChunks(pngBuffer)) {
    if (chunk.type === IEND_TYPE) {
      iendStart = chunk.offset;
      break;
    }
  }
  if (iendStart < 0) {
    throw new Error("PNG missing IEND chunk");
  }

  const head = pngBuffer.subarray(0, iendStart);
  const tail = pngBuffer.subarray(iendStart);
  const inserts = validated.map(([k, v]) => buildTextChunk(k, v));
  return Buffer.concat([head, ...inserts, tail]);
}

// Read all tEXt chunks. Returns { [keyword]: value }. Duplicate keywords:
// last write wins. Non-tEXt chunks are skipped silently. Malformed CRC is
// tolerated (we are a reader; the writer was hopefully us, but third-party
// PNGs can have quirky chunks — fail open and surface what we can).
export function readTextChunks(pngBuffer) {
  if (!isPng(pngBuffer)) {
    throw new Error("input is not a PNG");
  }
  const out = {};
  for (const chunk of iterateChunks(pngBuffer)) {
    if (chunk.type !== "tEXt") continue;
    const sep = chunk.data.indexOf(0);
    if (sep < 0) continue;
    const keyword = chunk.data.subarray(0, sep).toString("latin1");
    // Tolerate any keyword on read (third-party PNGs may have other tEXts).
    // Caller filters by ima2:* prefix as needed.
    const value = chunk.data.subarray(sep + 1).toString("utf8");
    out[keyword] = value;
  }
  return out;
}

// Convenience helper: reads only the ima2:* namespace and strips the prefix.
export function readIma2Metadata(pngBuffer) {
  const all = readTextChunks(pngBuffer);
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (KEYWORD_RE.test(key)) {
      out[key.slice("ima2:".length)] = value;
    }
  }
  return out;
}

export const IMA2_METADATA_KEYWORDS = Object.freeze([
  "ima2:version",
  "ima2:prompt",
  "ima2:revisedPrompt",
  "ima2:size",
  "ima2:quality",
  "ima2:model",
  "ima2:createdAt",
]);

export const IMA2_METADATA_VERSION = "1";
