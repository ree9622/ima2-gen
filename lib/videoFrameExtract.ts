import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_LOCAL_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_FRAME_POSITION_SECONDS = 60 * 60;
const FFMPEG_TIMEOUT_MS = 30_000;

function routeError(message: string, status = 400): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export async function safeGeneratedFilePath(generatedDir: string, file: string, options: { requireMp4?: boolean } = {}): Promise<string> {
  const base = resolve(generatedDir);
  const target = file.startsWith("/") ? resolve(file) : resolve(base, file);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw routeError("invalid file path", 400);
  }
  let baseReal: string;
  let targetReal: string;
  try {
    baseReal = await realpath(base);
    targetReal = await realpath(target);
  } catch {
    throw routeError("video file not found", 404);
  }
  if (targetReal !== baseReal && !targetReal.startsWith(`${baseReal}${sep}`)) {
    throw routeError("invalid file path", 400);
  }
  if (options.requireMp4 && extname(targetReal).toLowerCase() !== ".mp4") {
    throw routeError("generated video input must be an .mp4 file", 400);
  }
  return targetReal;
}

export async function assertLocalMp4(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) throw routeError("generated video input must be a file", 400);
  if (info.size <= 0) throw routeError("generated video input is empty", 400);
  if (info.size > MAX_LOCAL_VIDEO_BYTES) throw routeError("generated video input exceeds the 100MB limit", 400);
  const fh = await open(path, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await fh.read(header, 0, header.length, 0);
    if (bytesRead < 12 || header.subarray(4, 8).toString("ascii") !== "ftyp") {
      throw routeError("generated video input must be an MP4 container", 400);
    }
  } finally {
    await fh.close();
  }
}

export async function extractVideoFrame(input: string, output: string, position: string): Promise<void> {
  const options = { timeout: FFMPEG_TIMEOUT_MS, killSignal: "SIGKILL" as const, maxBuffer: 1024 * 1024 };
  if (position === "last") {
    await execFileAsync("ffmpeg", ["-y", "-sseof", "-3", "-i", input, "-update", "1", "-q:v", "1", output], options);
    return;
  }
  const sec = Number(position);
  if (!Number.isFinite(sec) || sec < 0) throw new Error("position must be a non-negative number or 'last'");
  if (sec > MAX_FRAME_POSITION_SECONDS) throw new Error("position exceeds the maximum supported seek time");
  await execFileAsync("ffmpeg", ["-y", "-ss", String(sec), "-i", input, "-vframes", "1", output], options);
}

export async function extractGeneratedVideoFrameB64(generatedDir: string, filename: string, position = "last"): Promise<string> {
  const inputPath = await safeGeneratedFilePath(generatedDir, filename, { requireMp4: true });
  await assertLocalMp4(inputPath);
  const tmpOut = join(generatedDir, `frame_tmp_${randomBytes(4).toString("hex")}.png`);
  try {
    await extractVideoFrame(inputPath, tmpOut, position);
    return (await readFile(tmpOut)).toString("base64");
  } finally {
    await unlink(tmpOut).catch(() => {});
  }
}
