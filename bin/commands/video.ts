import { parseArgs } from "../lib/args.js";
import { resolveServer } from "../lib/client.js";
import { streamSse } from "../lib/sse.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { config } from "../../config.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const VALID_RESOLUTIONS = new Set(["480p", "720p"]);
const VALID_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "auto"]);
const VALID_MODELS = new Set(["grok-imagine-video", "grok-imagine-video-1.5-preview"]);

const SPEC = {
  flags: {
    duration:      { type: "string", default: "5" },
    resolution:    { type: "string", default: "480p" },
    "aspect-ratio": { type: "string", default: "auto" },
    model:         { type: "string" },
    topic:         { type: "string" },
    ref:           { type: "string", repeatable: true },
    out:           { short: "o", type: "string" },
    "out-dir":     { short: "d", type: "string" },
    json:          { type: "boolean" },
    timeout:       { type: "string", default: "600" },
    server:        { type: "string" },
    session:       { type: "string" },
    help:          { short: "h", type: "boolean" },
  },
};

const HELP = `
  ima2 video <prompt...> [options]
  ima2 video edit <prompt> --video <url>
  ima2 video extend <prompt> --video <url> [--duration 5]
  ima2 video frame <file> [--last] [-o output.png]
  ima2 video analyze <video-url>

  Generate, edit, extend, or analyze video via Grok.

  Subcommands:
    (default)   Generate video (T2V / I2V / Ref2V)
    edit        Edit existing video with text prompt (V2V)
    extend      Continue video from last frame
    frame       Extract a frame from video (requires ffmpeg on server)
    analyze     Analyze video with Grok 4.3 vision

  Options (generate mode):
        --duration <1..15>              Duration in seconds. Default: 5
        --resolution <480p|720p>        Default: 480p
        --aspect-ratio <ratio|auto>     1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto. Default: auto
        --model <name>                  grok-imagine-video, grok-imagine-video-1.5-preview
        --topic <text>                  Series topic for prompt chain continuity
        --ref <file>                    Attach source/reference image (repeatable, max 7)
    -o, --out <file>                    Output file path
    -d, --out-dir <dir>                 Output directory
        --json                          Print JSON result to stdout
        --timeout <sec>                 Default: 600
        --server <url>                  Override server URL
        --session <id>                  Session ID

  Modes (auto-detected from --ref count):
    0 refs  → text-to-video
    1 ref   → image-to-video
    2-7 refs → reference-to-video (max 10s duration)

  Examples:
    ima2 video "a cat playing piano"
    ima2 video "animate this" --ref photo.png --duration 10
    ima2 video edit "make it sunset" --video https://vidgen.x.ai/.../clip.mp4
    ima2 video extend "camera pulls back" --video https://vidgen.x.ai/.../clip.mp4 --duration 5
    ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png
    ima2 video analyze https://vidgen.x.ai/.../clip.mp4
`;

export default async function videoCmd(argv: string[]) {
  const sub = argv[0];
  if (sub === "edit") return videoEditCmd(argv.slice(1));
  if (sub === "extend") return videoExtendCmd(argv.slice(1));
  if (sub === "frame") return videoFrameCmd(argv.slice(1));
  if (sub === "analyze") return videoAnalyzeCmd(argv.slice(1));

  const args = parseArgs(argv, SPEC);
  if (args.help) { out(HELP); return; }

  const prompt = args.positional.join(" ");
  if (!prompt) die(2, "prompt is required");

  const duration = parseInt(String(args.duration)) || 5;
  if (duration < 1 || duration > 15) die(2, "--duration must be between 1 and 15");

  const resolution = String(args.resolution);
  if (!VALID_RESOLUTIONS.has(resolution)) die(2, "--resolution must be one of: 480p, 720p");

  const aspectRatio = String(args["aspect-ratio"]);
  if (!VALID_ASPECT_RATIOS.has(aspectRatio)) die(2, "--aspect-ratio must be one of: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto");

  if (args.model && !VALID_MODELS.has(String(args.model))) {
    die(2, "--model must be one of: grok-imagine-video, grok-imagine-video-1.5-preview");
  }

  const refs = (Array.isArray(args.ref) ? args.ref : []) as string[];
  if (refs.length > 7) die(2, "max 7 --ref attachments for video");

  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e: unknown) { die(exitCodeForError(e), (e as Error).message); throw e; }

  const referenceImages = await Promise.all(refs.map(async (p: string) => {
    const buf = await readFile(p);
    return buf.toString("base64");
  }));

  const timeoutMs = (parseInt(String(args.timeout)) || 600) * 1000;
  const requestId = `req_cli_video_${Date.now().toString(36)}`;

  const body: Record<string, unknown> = {
    prompt,
    provider: "grok",
    duration,
    resolution,
    aspectRatio,
    requestId,
  };
  if (args.model) body.model = args.model;
  if (args.session) body.sessionId = args.session;
  if (args.topic) body.topic = args.topic;
  if (referenceImages.length === 1) {
    body.sourceImage = referenceImages[0];
  } else if (referenceImages.length > 1) {
    body.referenceImages = referenceImages;
  }

  const ac = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  const onSig = () => { ac.abort(); process.exit(130); };
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);

  const url = `${server.base}/api/video/generate`;
  let doneData: Record<string, unknown> | null = null;
  let lastProgress = -1;

  try {
    for await (const ev of streamSse(url, { body, signal: ac.signal, headers: { "X-Request-Id": requestId } })) {
      switch (ev.event) {
        case "planning":
          if (!args.json) out(color.dim("[planning] preparing video generation..."));
          break;
        case "submitted":
          if (!args.json) out(color.dim(`[submitted] xai request: ${ev.data.xaiVideoRequestId || "..."}`));
          break;
        case "progress": {
          const pct = typeof ev.data.progress === "number" ? Math.round(ev.data.progress * 100) : null;
          if (pct !== null && pct !== lastProgress && !args.json) {
            const bar = renderBar(pct);
            process.stdout.write(`\r  ${bar} ${pct}%`);
            lastProgress = pct;
          }
          break;
        }
        case "done":
          if (!args.json && lastProgress >= 0) process.stdout.write("\n");
          doneData = ev.data;
          break;
        case "error":
          if (!args.json && lastProgress >= 0) process.stdout.write("\n");
          die(1, `video error: ${ev.data.error || ev.data}${ev.data.code ? ` (${ev.data.code})` : ""}`);
      }
    }
  } catch (e: unknown) {
    if ((e as Error).name === "AbortError" && !timedOut) return;
    if (!args.json && lastProgress >= 0) process.stdout.write("\n");
    die(exitCodeForError(e), (e as Error).message);
  } finally {
    clearTimeout(timeoutTimer);
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }

  if (!doneData?.filename) die(1, "server did not return a video filename");

  // Determine output path
  const filename = String(doneData.filename);
  const explicitOut = args.out ? String(args.out) : null;
  const outDir = args["out-dir"] ? String(args["out-dir"]) : null;
  let target: string;
  if (explicitOut) {
    target = explicitOut;
  } else if (outDir) {
    target = join(outDir, filename);
  } else {
    target = join(config.storage.generatedDir, filename);
  }

  // Download the video file from server
  const videoUrl = `${server.base}${doneData.url || `/generated/${encodeURIComponent(filename)}`}`;
  const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(30_000) });
  if (!dlRes.ok) die(1, `failed to download video: HTTP ${dlRes.status}`);
  const videoBuf = Buffer.from(await dlRes.arrayBuffer());
  await mkdir(dirname(target), { recursive: true }).catch(() => {});
  await writeFile(target, videoBuf);

  if (args.json) {
    json({
      ok: true,
      requestId: doneData.requestId,
      path: target,
      filename,
      elapsed: doneData.elapsed,
      video: doneData.video,
      revisedPrompt: doneData.revisedPrompt,
    });
  } else {
    out(color.green("✓ ") + target);
    if (doneData.elapsed) out(color.dim(`elapsed ${doneData.elapsed}s`));
    if (doneData.revisedPrompt) out(color.dim(`revised: ${String(doneData.revisedPrompt).slice(0, 80)}`));
  }
}

function renderBar(pct: number): string {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  return color.green("█".repeat(filled)) + color.dim("░".repeat(width - filled));
}

// --- Subcommands ---

async function videoEditCmd(argv: string[]) {
  const spec = { flags: { video: { type: "string" }, json: { type: "boolean" }, timeout: { type: "string", default: "600" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  if (args.help) { out(`  ima2 video edit <prompt> --video <url>\n\n  Edit existing video with text prompt (real V2V).\n  Model: grok-imagine-video only. Input: mp4, max 8.7s.\n\n  Options:\n        --video <url>     Source video HTTPS URL (required)\n        --json            Print JSON result\n        --timeout <sec>   Default: 600\n        --server <url>    Override server URL`); return; }
  const prompt = args.positional.join(" ");
  if (!prompt) die(2, "prompt is required");
  if (!args.video) die(2, "--video <url> is required");
  let server;
  try { server = await resolveServer({ serverFlag: args.server }); } catch (e: unknown) { die(exitCodeForError(e), (e as Error).message); throw e; }
  const res = await fetch(`${server.base}/api/video/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, videoUrl: args.video }) });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) die(1, `edit failed: ${data.error ?? res.status}`);
  if (args.json) { out(JSON.stringify(data, null, 2)); } else { out(color.green("✓ ") + `Edited video: ${data.url}`); }
}

async function videoExtendCmd(argv: string[]) {
  const spec = { flags: { video: { type: "string" }, duration: { type: "string", default: "6" }, json: { type: "boolean" }, timeout: { type: "string", default: "600" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  if (args.help) { out(`  ima2 video extend <prompt> --video <url> [--duration 5]\n\n  Extend video from its last frame.\n  Model: grok-imagine-video only. Extension: 2-10s.\n\n  Options:\n        --video <url>     Source video HTTPS URL (required)\n        --duration <2-10> Extension duration (default: 6)\n        --json            Print JSON result\n        --server <url>    Override server URL`); return; }
  const prompt = args.positional.join(" ");
  if (!prompt) die(2, "prompt is required");
  if (!args.video) die(2, "--video <url> is required");
  let server;
  try { server = await resolveServer({ serverFlag: args.server }); } catch (e: unknown) { die(exitCodeForError(e), (e as Error).message); throw e; }
  const duration = parseInt(String(args.duration)) || 6;
  const res = await fetch(`${server.base}/api/video/extend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, videoUrl: args.video, duration }) });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) die(1, `extend failed: ${data.error ?? res.status}`);
  if (args.json) { out(JSON.stringify(data, null, 2)); } else { out(color.green("✓ ") + `Extended video (${data.duration}s): ${data.url}`); }
}

async function videoFrameCmd(argv: string[]) {
  const spec = { flags: { last: { type: "boolean" }, position: { type: "string" }, output: { short: "o", type: "string" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  if (args.help) { out(`  ima2 video frame <file> [--last] [--position <sec>] [-o output.png]\n\n  Extract a frame from a video file.\n\n  Options:\n        --last            Extract last frame (default)\n        --position <sec>  Extract frame at specific second\n    -o, --output <path>   Output file path\n        --server <url>    Override server URL`); return; }
  const file = args.positional[0];
  if (!file) die(2, "file argument required");
  let server;
  try { server = await resolveServer({ serverFlag: args.server }); } catch (e: unknown) { die(exitCodeForError(e), (e as Error).message); throw e; }
  const position = args.last ? "last" : (String(args.position || "last"));
  const url = `${server.base}/api/video/frame?file=${encodeURIComponent(file)}&position=${encodeURIComponent(position)}`;
  const res = await fetch(url);
  if (!res.ok) { const d = await res.json().catch(() => ({})); die(1, `frame extraction failed: ${(d as any).error || res.status}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = (args.output as string) || `frame-${file.replace(/\.[^.]+$/, "")}.png`;
  await writeFile(outPath, buf);
  out(color.green("✓ ") + `Frame saved: ${outPath} (${buf.length} bytes)`);
}

async function videoAnalyzeCmd(argv: string[]) {
  const spec = { flags: { json: { type: "boolean" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
  const args = parseArgs(argv, spec);
  if (args.help) { out(`  ima2 video analyze <video-url-or-file>\n\n  Analyze video with Grok 4.3 vision. Outputs structured recreation prompt.\n\n  Options:\n        --json            Print JSON result\n        --server <url>    Override server URL`); return; }
  const videoUrl = args.positional[0];
  if (!videoUrl) die(2, "video URL or filename required");
  let server;
  try { server = await resolveServer({ serverFlag: args.server }); } catch (e: unknown) { die(exitCodeForError(e), (e as Error).message); throw e; }
  const res = await fetch(`${server.base}/api/video/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoUrl }) });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) die(1, `analyze failed: ${(data as any).error || res.status}`);
  if (args.json) { out(JSON.stringify(data, null, 2)); } else { out((data as any).analysis); }
}
