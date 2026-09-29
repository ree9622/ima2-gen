import sharp from "sharp";

// Requesting a transparent background does not guarantee one: the backend can
// fall back to an opaque render, and an RGBA file whose every alpha byte is
// 255 is still fully opaque. Decode the pixels and record what actually came
// back, so the sidecar and the UI stop labeling an opaque image as a cutout.
// (Adapted from upstream lidge-jun/ima2-gen verifyBufferAlpha, a1afb9c5.)
export async function verifyAlpha(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
    return { alphaVerified: false, alphaReason: "undetectable" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { alphaVerified: false, alphaReason: "jpeg" };
  }
  let data;
  let info;
  try {
    ({ data, info } = await sharp(buffer, { failOn: "none" }).raw().toBuffer({ resolveWithObject: true }));
  } catch {
    return { alphaVerified: false, alphaReason: "undetectable" };
  }
  if (info.channels < 4) return { alphaVerified: false, alphaReason: "no-alpha-channel" };
  // One non-opaque pixel is enough: partial alpha (glass, hair, soft edges)
  // is transparency just as much as a fully cut-out backdrop.
  for (let i = info.channels - 1; i < data.length; i += info.channels) {
    if (data[i] < 255) return { alphaVerified: true, alphaReason: null };
  }
  return { alphaVerified: false, alphaReason: "fully-opaque" };
}
