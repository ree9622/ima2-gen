// Reference-image down-scaler. The server caps each ref at 7,340,032 base64
// bytes (~5.2MB decoded — see lib/refs.js MAX_REF_B64_BYTES). High-quality
// generation results from gpt-image are routinely 8-12MB raw PNG, so dropping
// "use current result as reference" or pasting a phone photo trips the cap.
//
// Strategy: shrink the longest side to maxDim and re-encode as JPEG. If the
// result is still over the byte cap, drop quality progressively. Bail out
// after a few rounds and return whatever we have — the server will reject
// it with a clear error rather than silently truncating.

const SERVER_MAX_B64 = 7 * 1024 * 1024;
const TARGET_B64 = 6 * 1024 * 1024; // leave headroom for the data: prefix

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

function b64Length(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.length - i - 1 : dataUrl.length;
}

function encodeFromCanvas(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): string {
  return canvas.toDataURL(mime, quality);
}

export async function resizeDataUrlForRef(
  dataUrl: string,
  opts: { maxDim?: number; minQuality?: number } = {},
): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  // Already small enough — skip the round-trip.
  if (b64Length(dataUrl) <= TARGET_B64) return dataUrl;

  const maxDim = opts.maxDim ?? 1536;
  const minQuality = opts.minQuality ?? 0.55;

  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return dataUrl; // fail open — caller will hit the server-side cap
  }
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return dataUrl;

  // Step down dimension and quality together until under cap or we run out
  // of headroom. Each step shrinks longest side by 20% and quality by 0.1.
  let dim = maxDim;
  let q = 0.85;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, dim / Math.max(w, h));
    const nw = Math.max(64, Math.round(w * scale));
    const nh = Math.max(64, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, nw, nh);
    const out = encodeFromCanvas(canvas, "image/jpeg", q);
    if (b64Length(out) <= TARGET_B64) return out;
    // Reduce for next attempt
    dim = Math.round(dim * 0.8);
    q = Math.max(minQuality, q - 0.1);
  }
  // Last-resort small fallback so the server doesn't outright reject it.
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = Math.round((768 * h) / w);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return encodeFromCanvas(canvas, "image/jpeg", minQuality);
}

export function isRefSizeOk(dataUrl: string): boolean {
  return b64Length(dataUrl) <= SERVER_MAX_B64;
}
