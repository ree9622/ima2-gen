// S3-backed mirror/offload for generated/ assets.
//
// Optional and gated by IMA2_S3_BUCKET: when unset, every function is a no-op
// (s3Enabled() === false) and the server behaves exactly as before. When set,
// generated images are mirrored to S3 so local disk can be pruned while history
// and serving keep working — server.js proxies S3 on a local cache miss.
//
// Key convention: the S3 key is the path of the asset *relative to* generated/,
// always with POSIX separators. e.g. local generated/1782_ab_0.png        -> key "1782_ab_0.png"
//                                   local generated/.thumbs/x.thumb.webp   -> key ".thumbs/x.thumb.webp"
// Sidecar JSON is mirrored for disaster recovery but is NEVER offloaded from
// local disk (history + ACL read it locally).

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.IMA2_S3_BUCKET || "";
const REGION = process.env.IMA2_S3_REGION || process.env.AWS_REGION || "ap-northeast-2";

let _client = null;
function client() {
  if (!_client) _client = new S3Client({ region: REGION });
  return _client;
}

export function s3Enabled() {
  return BUCKET.length > 0;
}

export function s3Bucket() {
  return BUCKET;
}

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};

export function contentTypeFor(key) {
  const i = key.lastIndexOf(".");
  if (i < 0) return "application/octet-stream";
  return CONTENT_TYPES[key.slice(i).toLowerCase()] || "application/octet-stream";
}

function is404(err) {
  const code = err?.$metadata?.httpStatusCode;
  return code === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey";
}

// Upload a buffer/stream. Returns true on success, false if S3 disabled.
export async function s3Put(key, body, contentType) {
  if (!s3Enabled()) return false;
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || contentTypeFor(key),
    }),
  );
  return true;
}

// Returns { size, contentType } if present, null if missing, throws on real errors.
export async function s3Head(key) {
  if (!s3Enabled()) return null;
  try {
    const r = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: r.ContentLength, contentType: r.ContentType };
  } catch (err) {
    if (is404(err)) return null;
    throw err;
  }
}

// Returns { body, contentType, size } stream if present, null if missing.
export async function s3GetStream(key) {
  if (!s3Enabled()) return null;
  try {
    const r = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return { body: r.Body, contentType: r.ContentType, size: r.ContentLength };
  } catch (err) {
    if (is404(err)) return null;
    throw err;
  }
}

// Fire-and-forget mirror used on the generate/edit hot path. Never throws:
// a mirror failure must not break image generation (local copy still exists).
export function s3MirrorAsync(key, body, contentType) {
  if (!s3Enabled()) return;
  s3Put(key, body, contentType).catch((err) => {
    console.warn("[s3] mirror failed:", key, err?.message || err);
  });
}
