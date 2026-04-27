// PNG tEXt 청크 임베드/추출 (Phase 6.2). 외부 라이브러리 없이 표준 PNG 구조만 다룬다.
// 1×1 PNG fixture를 base로 메타 박고 다시 읽어서 동일한 값이 나오는지, IEND 위치가
// 보존되는지, malformed 입력은 throw 되는지를 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  pngCrc32,
  writeTextChunks,
  readTextChunks,
  readIma2Metadata,
  IMA2_METADATA_KEYWORDS,
  IMA2_METADATA_VERSION,
} from "../lib/imageMetadata.js";

// Build a valid 1×1 transparent RGBA PNG dynamically rather than embedding
// hex literals. Avoids hand-counting CRCs and zlib payloads.
function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function makeOnePixelPng() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type — RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  // 1 scanline = 1 filter byte + 4 RGBA bytes
  const idatData = deflateSync(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdrData),
    makeChunk("IDAT", idatData),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const ONE_PIXEL_PNG = makeOnePixelPng();

test("CRC32 matches PNG-spec known value for 'IEND'", () => {
  // PNG empty-IEND CRC (Type "IEND" alone, no data) is 0xae426082
  assert.equal(pngCrc32(Buffer.from("IEND", "ascii")), 0xae426082);
});

test("writeTextChunks roundtrip preserves all fields", () => {
  const meta = {
    "ima2:version": IMA2_METADATA_VERSION,
    "ima2:prompt": "shiba in space, masterpiece",
    "ima2:size": "1024x1024",
    "ima2:quality": "high",
    "ima2:model": "gpt-image-2",
    "ima2:createdAt": "2026-04-28T01:23:45.000Z",
  };
  const stamped = writeTextChunks(ONE_PIXEL_PNG, meta);
  const out = readTextChunks(stamped);
  for (const [k, v] of Object.entries(meta)) {
    assert.equal(out[k], v, `${k} mismatch`);
  }
});

test("writeTextChunks preserves PNG signature and IEND at the end", () => {
  const stamped = writeTextChunks(ONE_PIXEL_PNG, { "ima2:prompt": "x" });
  assert.deepEqual(stamped.subarray(0, 8), ONE_PIXEL_PNG.subarray(0, 8));
  // IEND is `00000000 49454E44 AE426082` — last 12 bytes
  const tailHex = stamped.subarray(stamped.length - 12).toString("hex");
  assert.equal(tailHex, "0000000049454e44ae426082");
});

test("writeTextChunks supports UTF-8 prompt (Korean)", () => {
  const stamped = writeTextChunks(ONE_PIXEL_PNG, {
    "ima2:prompt": "우주를 나는 시바견",
  });
  const out = readTextChunks(stamped);
  assert.equal(out["ima2:prompt"], "우주를 나는 시바견");
});

test("writeTextChunks supports array form for ordered inserts", () => {
  const stamped = writeTextChunks(ONE_PIXEL_PNG, [
    ["ima2:prompt", "first"],
    ["ima2:size", "1024x1024"],
  ]);
  const out = readTextChunks(stamped);
  assert.equal(out["ima2:prompt"], "first");
  assert.equal(out["ima2:size"], "1024x1024");
});

test("writeTextChunks empty entries returns the original buffer untouched", () => {
  const stamped = writeTextChunks(ONE_PIXEL_PNG, {});
  assert.equal(stamped, ONE_PIXEL_PNG);
});

test("writeTextChunks rejects invalid keywords (non ima2:* namespace)", () => {
  assert.throws(() => writeTextChunks(ONE_PIXEL_PNG, { prompt: "x" }), /invalid tEXt keyword/);
  assert.throws(() => writeTextChunks(ONE_PIXEL_PNG, { "ima2:": "x" }), /invalid tEXt keyword/);
  assert.throws(() => writeTextChunks(ONE_PIXEL_PNG, { "ima2:has space": "x" }), /invalid tEXt keyword/);
});

test("writeTextChunks rejects oversized values (>64KB)", () => {
  const big = "A".repeat(64 * 1024 + 1);
  assert.throws(() => writeTextChunks(ONE_PIXEL_PNG, { "ima2:prompt": big }), /exceeds 65536 bytes/);
});

test("writeTextChunks rejects non-PNG input", () => {
  const notPng = Buffer.from("this is not a PNG file at all", "ascii");
  assert.throws(() => writeTextChunks(notPng, { "ima2:prompt": "x" }), /not a PNG/);
});

test("writeTextChunks rejects PNG without IEND chunk", () => {
  // signature + IHDR only, no IEND
  const truncated = ONE_PIXEL_PNG.subarray(0, 33);
  assert.throws(() => writeTextChunks(truncated, { "ima2:prompt": "x" }), /missing IEND|truncated/i);
});

test("readTextChunks returns empty object when no tEXt chunks present", () => {
  assert.deepEqual(readTextChunks(ONE_PIXEL_PNG), {});
});

test("readTextChunks tolerates third-party tEXt keywords (returns them all)", () => {
  // We only validate keywords on write, not on read. A PNG written by another tool
  // may have arbitrary keywords; readTextChunks surfaces them.
  // To verify: build a tEXt chunk by hand with a non-ima2 keyword.
  const buildRawTextChunk = (keyword, value) => {
    const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(value, "utf8")]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from("tEXt", "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  };
  const iendStart = ONE_PIXEL_PNG.length - 12;
  const stamped = Buffer.concat([
    ONE_PIXEL_PNG.subarray(0, iendStart),
    buildRawTextChunk("Software", "Adobe Photoshop"),
    ONE_PIXEL_PNG.subarray(iendStart),
  ]);
  const out = readTextChunks(stamped);
  assert.equal(out.Software, "Adobe Photoshop");
});

test("readIma2Metadata strips ima2: prefix and ignores foreign keywords", () => {
  const stamped = writeTextChunks(ONE_PIXEL_PNG, {
    "ima2:prompt": "hello",
    "ima2:size": "512x512",
  });
  const meta = readIma2Metadata(stamped);
  assert.deepEqual(meta, { prompt: "hello", size: "512x512" });
});

test("IMA2_METADATA_KEYWORDS lists the expected v1 fields", () => {
  // Sanity check so future field additions don't silently drop documented ones.
  assert.ok(IMA2_METADATA_KEYWORDS.includes("ima2:prompt"));
  assert.ok(IMA2_METADATA_KEYWORDS.includes("ima2:size"));
  assert.ok(IMA2_METADATA_KEYWORDS.includes("ima2:quality"));
  assert.ok(IMA2_METADATA_KEYWORDS.includes("ima2:model"));
  assert.ok(IMA2_METADATA_KEYWORDS.includes("ima2:createdAt"));
  assert.ok(IMA2_METADATA_KEYWORDS.includes("ima2:revisedPrompt"));
});

test("multiple writeTextChunks calls accumulate (later read wins on duplicate)", () => {
  const once = writeTextChunks(ONE_PIXEL_PNG, { "ima2:prompt": "first" });
  const twice = writeTextChunks(once, { "ima2:prompt": "second" });
  // Both chunks present in file, but readTextChunks returns last write
  assert.equal(readTextChunks(twice)["ima2:prompt"], "second");
});
