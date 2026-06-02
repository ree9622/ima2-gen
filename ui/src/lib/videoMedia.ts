import type { GenerateItem } from "../types";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

export function isVideoUrl(src: string | null | undefined): boolean {
  if (!src || src.startsWith("data:image/")) return false;
  const clean = src.split("?")[0];
  return VIDEO_EXT.test(clean) || src.startsWith("data:video/");
}

export function isVideoItem(
  item: Pick<GenerateItem, "filename" | "url" | "image" | "mediaType"> | null | undefined,
): boolean {
  if (!item) return false;
  if (item.mediaType === "video") return true;
  return isVideoUrl(item.filename) || isVideoUrl(item.url) || isVideoUrl(item.image);
}

/**
 * Extract a frame at a specific time position from a video as a JPEG data URL.
 * Uses a hidden <video> + <canvas> to seek and capture.
 */
export function extractFrameAtTime(videoSrc: string, seekFn: (duration: number) => number): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.max(0, seekFn(video.duration));
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas 2d context unavailable")); return; }
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      } finally {
        video.src = "";
        video.load();
      }
    };

    video.onerror = () => {
      reject(new Error("Failed to load video for frame extraction"));
    };

    video.src = videoSrc;
  });
}

export function extractLastFrame(videoSrc: string): Promise<string> {
  return extractFrameAtTime(videoSrc, (d) => d - 0.1);
}

export function extractFirstFrame(videoSrc: string): Promise<string> {
  return extractFrameAtTime(videoSrc, (d) => Math.min(d * 0.3, 0.4));
}

export function extractMidFrame(videoSrc: string): Promise<string> {
  return extractFrameAtTime(videoSrc, (d) => d / 2);
}
