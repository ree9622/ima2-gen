import sharp from "sharp";

function encoder(pipeline, format, compression) {
  const quality = Math.max(1, Math.min(100, Number(compression) || 100));
  if (format === "jpeg") return pipeline.jpeg({ quality });
  if (format === "webp") return pipeline.webp({ quality });
  return pipeline.png();
}

// GPT Image masks are guidance rather than a pixel lock. Restore the source
// wherever the submitted mask is opaque so masked edits cannot redraw the
// rest of the image.
export async function preserveOutsideMask({
  originalB64,
  generatedB64,
  maskB64,
  format = "png",
  compression = 100,
}) {
  if (!maskB64) return Buffer.from(generatedB64, "base64");

  const original = Buffer.from(originalB64, "base64");
  const generated = Buffer.from(generatedB64, "base64");
  const mask = Buffer.from(maskB64, "base64");
  const metadata = await sharp(original).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("masked edit source dimensions are unavailable");

  const originalRgba = await sharp(original)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const maskAlpha = await sharp(mask)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer();

  for (let pixel = 0, alpha = 3; pixel < maskAlpha.length; pixel += 1, alpha += 4) {
    originalRgba[alpha] = Math.round((originalRgba[alpha] * maskAlpha[pixel]) / 255);
  }

  const protectedOriginal = await sharp(originalRgba, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  const composited = sharp(generated)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .composite([{ input: protectedOriginal, blend: "over" }]);

  return encoder(composited, format, compression).toBuffer();
}
