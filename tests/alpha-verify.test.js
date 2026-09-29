import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { verifyAlpha } from "../lib/alphaVerify.js";

function solid(channels, alpha = 255) {
  const background = channels === 4 ? { r: 10, g: 20, b: 30, alpha: alpha / 255 } : { r: 10, g: 20, b: 30 };
  return sharp({ create: { width: 4, height: 4, channels, background } });
}

test("verifyAlpha accepts a PNG with transparent pixels", async () => {
  const buf = await solid(4, 0).png().toBuffer();
  assert.deepEqual(await verifyAlpha(buf), { alphaVerified: true, alphaReason: null });
});

test("verifyAlpha rejects an RGBA PNG whose every pixel is opaque", async () => {
  const buf = await solid(4, 255).png().toBuffer();
  assert.deepEqual(await verifyAlpha(buf), { alphaVerified: false, alphaReason: "fully-opaque" });
});

test("verifyAlpha rejects an RGB PNG and JPEG", async () => {
  assert.equal((await verifyAlpha(await solid(3).png().toBuffer())).alphaReason, "no-alpha-channel");
  assert.equal((await verifyAlpha(await solid(3).jpeg().toBuffer())).alphaReason, "jpeg");
});

test("verifyAlpha accepts a transparent WebP and flags unreadable bytes", async () => {
  assert.equal((await verifyAlpha(await solid(4, 0).webp({ lossless: true }).toBuffer())).alphaVerified, true);
  assert.equal((await verifyAlpha(Buffer.from("hello"))).alphaReason, "undetectable");
});
