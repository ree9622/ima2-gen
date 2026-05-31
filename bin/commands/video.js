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
        duration: { type: "string", default: "5" },
        resolution: { type: "string", default: "480p" },
        "aspect-ratio": { type: "string", default: "auto" },
        model: { type: "string" },
        topic: { type: "string" },
        ref: { type: "string", repeatable: true },
        out: { short: "o", type: "string" },
        "out-dir": { short: "d", type: "string" },
        json: { type: "boolean" },
        timeout: { type: "string", default: "600" },
        server: { type: "string" },
        session: { type: "string" },
        help: { short: "h", type: "boolean" },
    },
};
const HELP = `
  ima2 video <prompt...> [options]

  Generate a video via the Grok video provider (SSE streaming).

  Options:
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
    ima2 video "cinematic" --resolution 720p --aspect-ratio 16:9 -o out.mp4
`;
export default async function videoCmd(argv) {
    const args = parseArgs(argv, SPEC);
    if (args.help) {
        out(HELP);
        return;
    }
    const prompt = args.positional.join(" ");
    if (!prompt)
        die(2, "prompt is required");
    const duration = parseInt(String(args.duration)) || 5;
    if (duration < 1 || duration > 15)
        die(2, "--duration must be between 1 and 15");
    const resolution = String(args.resolution);
    if (!VALID_RESOLUTIONS.has(resolution))
        die(2, "--resolution must be one of: 480p, 720p");
    const aspectRatio = String(args["aspect-ratio"]);
    if (!VALID_ASPECT_RATIOS.has(aspectRatio))
        die(2, "--aspect-ratio must be one of: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto");
    if (args.model && !VALID_MODELS.has(String(args.model))) {
        die(2, "--model must be one of: grok-imagine-video, grok-imagine-video-1.5-preview");
    }
    const refs = (Array.isArray(args.ref) ? args.ref : []);
    if (refs.length > 7)
        die(2, "max 7 --ref attachments for video");
    let server;
    try {
        server = await resolveServer({ serverFlag: args.server });
    }
    catch (e) {
        die(exitCodeForError(e), e.message);
        throw e;
    }
    const referenceImages = await Promise.all(refs.map(async (p) => {
        const buf = await readFile(p);
        return buf.toString("base64");
    }));
    const timeoutMs = (parseInt(String(args.timeout)) || 600) * 1000;
    const requestId = `req_cli_video_${Date.now().toString(36)}`;
    const body = {
        prompt,
        provider: "grok",
        duration,
        resolution,
        aspectRatio,
        requestId,
    };
    if (args.model)
        body.model = args.model;
    if (args.session)
        body.sessionId = args.session;
    if (args.topic)
        body.topic = args.topic;
    if (referenceImages.length === 1) {
        body.sourceImage = referenceImages[0];
    }
    else if (referenceImages.length > 1) {
        body.referenceImages = referenceImages;
    }
    const ac = new AbortController();
    let timedOut = false;
    const timeoutTimer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const onSig = () => { ac.abort(); process.exit(130); };
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
    const url = `${server.base}/api/video/generate`;
    let doneData = null;
    let lastProgress = -1;
    try {
        for await (const ev of streamSse(url, { body, signal: ac.signal, headers: { "X-Request-Id": requestId } })) {
            switch (ev.event) {
                case "planning":
                    if (!args.json)
                        out(color.dim("[planning] preparing video generation..."));
                    break;
                case "submitted":
                    if (!args.json)
                        out(color.dim(`[submitted] xai request: ${ev.data.xaiVideoRequestId || "..."}`));
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
                    if (!args.json && lastProgress >= 0)
                        process.stdout.write("\n");
                    doneData = ev.data;
                    break;
                case "error":
                    if (!args.json && lastProgress >= 0)
                        process.stdout.write("\n");
                    die(1, `video error: ${ev.data.error || ev.data}${ev.data.code ? ` (${ev.data.code})` : ""}`);
            }
        }
    }
    catch (e) {
        if (e.name === "AbortError" && !timedOut)
            return;
        if (!args.json && lastProgress >= 0)
            process.stdout.write("\n");
        die(exitCodeForError(e), e.message);
    }
    finally {
        clearTimeout(timeoutTimer);
        process.off("SIGINT", onSig);
        process.off("SIGTERM", onSig);
    }
    if (!doneData?.filename)
        die(1, "server did not return a video filename");
    // Determine output path
    const filename = String(doneData.filename);
    const explicitOut = args.out ? String(args.out) : null;
    const outDir = args["out-dir"] ? String(args["out-dir"]) : null;
    let target;
    if (explicitOut) {
        target = explicitOut;
    }
    else if (outDir) {
        target = join(outDir, filename);
    }
    else {
        target = join(config.storage.generatedDir, filename);
    }
    // Download the video file from server
    const videoUrl = `${server.base}${doneData.url || `/generated/${encodeURIComponent(filename)}`}`;
    const dlRes = await fetch(videoUrl, { signal: AbortSignal.timeout(30_000) });
    if (!dlRes.ok)
        die(1, `failed to download video: HTTP ${dlRes.status}`);
    const videoBuf = Buffer.from(await dlRes.arrayBuffer());
    await mkdir(dirname(target), { recursive: true }).catch(() => { });
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
    }
    else {
        out(color.green("✓ ") + target);
        if (doneData.elapsed)
            out(color.dim(`elapsed ${doneData.elapsed}s`));
        if (doneData.revisedPrompt)
            out(color.dim(`revised: ${String(doneData.revisedPrompt).slice(0, 80)}`));
    }
}
function renderBar(pct) {
    const width = 20;
    const filled = Math.round((pct / 100) * width);
    return color.green("█".repeat(filled)) + color.dim("░".repeat(width - filled));
}
