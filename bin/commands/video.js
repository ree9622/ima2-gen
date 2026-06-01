import { parseArgs } from "../lib/args.js";
import { resolveServer } from "../lib/client.js";
import { streamSse } from "../lib/sse.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { config } from "../../config.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
const VALID_RESOLUTIONS = new Set(["480p", "720p"]);
const VALID_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "auto"]);
const VALID_MODELS = new Set(["grok-imagine-video", "grok-imagine-video-1.5-preview"]);
const ACTIVE_VIDEO_PROMPT_GUIDANCE = "Active video prompt required: describe visual flow, motion flow, sound/no-music intent, dialogue/no-dialogue intent, and the desired ending frame. Pace the scene to naturally fill the selected duration with an opening composition, connected motion/emotion change, and stable ending frame.";
function parseIntegerFlag(value, fallback, label) {
    const raw = value === undefined ? String(fallback) : String(value);
    if (!/^\d+$/.test(raw))
        die(2, `${label} must be an integer`);
    return Number(raw);
}
function rejectUnknownFlags(args) {
    if (args._unknown?.length)
        die(2, `unknown option: ${args._unknown[0]}`);
}
async function readJsonResponse(res, label) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    }
    catch {
        die(1, `${label} failed: expected JSON response, got ${text.slice(0, 120) || `HTTP ${res.status}`}`);
    }
}
function parseTimeoutSeconds(seconds) {
    const sec = parseIntegerFlag(seconds, 600, "--timeout");
    if (sec < 1)
        die(2, "--timeout must be at least 1");
    return sec;
}
function timeoutSignal(seconds) {
    const sec = parseTimeoutSeconds(seconds);
    return AbortSignal.timeout(sec * 1000);
}
async function writeBuffer(path, buf) {
    await mkdir(dirname(path), { recursive: true }).catch(() => { });
    await writeFile(path, buf);
}
async function downloadReturnedVideo(serverBase, data, outPath, signal) {
    const rawUrl = typeof data.url === "string" ? data.url : "";
    const url = rawUrl.startsWith("/") ? `${serverBase}${rawUrl}` : rawUrl;
    if (!url)
        die(1, "server did not return a video url");
    const res = await fetch(url, { signal });
    if (!res.ok)
        die(1, `failed to download video: HTTP ${res.status}`);
    await writeBuffer(outPath, Buffer.from(await res.arrayBuffer()));
}
const SPEC = {
    flags: {
        duration: { type: "string", default: "5" },
        resolution: { type: "string", default: "480p" },
        "aspect-ratio": { type: "string", default: "auto" },
        model: { type: "string" },
        "planner-model": { type: "string" },
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
  ima2 video edit <prompt> --video <url|file_id|generated-file>
  ima2 video extend <prompt> --video <url|file_id|generated-file> [--duration 6]
  ima2 video continue <prompt> --video <generated-file>
  ima2 video frame <file> [--last] [-o output.png]
  ima2 video analyze <generated-file>

  Generate, edit, extend, or analyze video via Grok.

  Subcommands:
    (default)   Generate video (T2V / I2V / Ref2V)
    edit        Edit existing video with text prompt (V2V)
    extend      Continue video from last frame
    continue    Generate a new I2V clip from a generated video's last frame with lineage
    frame       Extract a frame from video (requires ffmpeg on server)
    analyze     Analyze video with Grok 4.3 vision

  Options (generate mode):
        --duration <1..15>              Duration in seconds. Default: 5. Prompt motion should naturally fill this length
        --resolution <480p|720p>        Default: 480p
        --aspect-ratio <ratio|auto>     1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, auto. Default: auto
        --model <name>                  grok-imagine-video, grok-imagine-video-1.5-preview
        --planner-model <name>          Planner model override (e.g. grok-4.3, grok-composer-2.5-fast)
        --topic <text>                  Series topic for prompt chain continuity
        --ref <file>                    Attach source/reference image (repeatable, max 7)
    -o, --out <file>                    Output file path
    -d, --out-dir <dir>                 Output directory
        --json                          Print JSON result to stdout
        --timeout <sec>                 Default: 600
        --server <url>                  Override server URL
        --session <id>                  Session ID

  Edit/extend subcommands:
        --video <value>                 HTTPS URL, xAI file_id, data URL, or generated filename
        --duration <2..10>              Extension duration only. Default: 6

  Modes (auto-detected from --ref count):
    0 refs  → text-to-video
    1 ref   → image-to-video
    2-7 refs → reference-to-video (max 10s duration)

  Examples:
    ima2 video "a cat playing piano"
    ima2 video "animate this" --ref photo.png --duration 10
    ima2 video edit "make it sunset" --video https://vidgen.x.ai/.../clip.mp4
    ima2 video extend "camera pulls back" --video https://vidgen.x.ai/.../clip.mp4 --duration 5
    ima2 video continue "she turns back as the music cuts to room tone" --video 1780226256355_50252101.mp4
    ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png
    ima2 video analyze 1780226256355_50252101.mp4
`;
export default async function videoCmd(argv) {
    const sub = argv[0];
    if (sub === "edit")
        return videoEditCmd(argv.slice(1));
    if (sub === "extend")
        return videoExtendCmd(argv.slice(1));
    if (sub === "continue")
        return videoContinueCmd(argv.slice(1));
    if (sub === "frame")
        return videoFrameCmd(argv.slice(1));
    if (sub === "analyze")
        return videoAnalyzeCmd(argv.slice(1));
    const args = parseArgs(argv, SPEC);
    rejectUnknownFlags(args);
    if (args.help) {
        out(HELP);
        return;
    }
    const prompt = args.positional.join(" ");
    if (!prompt.trim())
        die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
    const duration = parseIntegerFlag(args.duration, 5, "--duration");
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
    if (refs.length >= 2 && duration > 10)
        die(2, "--duration must be between 1 and 10 when using 2 or more --ref attachments");
    const timeoutSeconds = parseIntegerFlag(args.timeout, 600, "--timeout");
    if (timeoutSeconds < 1)
        die(2, "--timeout must be at least 1");
    const timeoutMs = timeoutSeconds * 1000;
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
    if (args["planner-model"])
        body.plannerModel = args["planner-model"];
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
                    die(1, `video error: ${ev.data.error || ev.data}${ev.data.guidance ? `\n${ev.data.guidance}` : ""}${ev.data.code ? ` (${ev.data.code})` : ""}`);
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
    const dlRes = await fetch(videoUrl, { signal: timeoutSignal(args.timeout) });
    if (!dlRes.ok)
        die(1, `failed to download video: HTTP ${dlRes.status}`);
    const videoBuf = Buffer.from(await dlRes.arrayBuffer());
    await writeBuffer(target, videoBuf);
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
async function runVideoGenerateRequest(serverBase, body, timeout, silent) {
    let doneData = null;
    let lastProgress = -1;
    for await (const ev of streamSse(`${serverBase}/api/video/generate`, {
        body: { provider: "grok", ...body },
        signal: timeoutSignal(timeout),
        headers: typeof body.requestId === "string" ? { "X-Request-Id": body.requestId } : undefined,
    })) {
        if (ev.event === "progress") {
            const pct = typeof ev.data.progress === "number" ? Math.round(ev.data.progress * 100) : null;
            if (pct !== null && pct !== lastProgress && !silent) {
                process.stdout.write(`\r  ${renderBar(pct)} ${pct}%`);
                lastProgress = pct;
            }
        }
        else if (ev.event === "done") {
            if (!silent && lastProgress >= 0)
                process.stdout.write("\n");
            doneData = ev.data;
        }
        else if (ev.event === "error") {
            if (!silent && lastProgress >= 0)
                process.stdout.write("\n");
            die(1, `video error: ${ev.data.error || ev.data}${ev.data.guidance ? `\n${ev.data.guidance}` : ""}${ev.data.code ? ` (${ev.data.code})` : ""}`);
        }
    }
    if (!doneData)
        die(1, "server did not return a video result");
    return doneData;
}
// --- Subcommands ---
async function videoEditCmd(argv) {
    const spec = { flags: { video: { type: "string" }, out: { short: "o", type: "string" }, output: { type: "string" }, json: { type: "boolean" }, timeout: { type: "string", default: "600" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
    const args = parseArgs(argv, spec);
    rejectUnknownFlags(args);
    if (args.help) {
        out(`  ima2 video edit <prompt> --video <url|file_id|generated-file>\n\n  Edit existing video with text prompt (real V2V).\n  Model: grok-imagine-video only. Input: mp4, max 8.7s.\n\n  Options:\n        --video <value>   Source video HTTPS URL, xAI file_id, data URL, or generated filename (required)\n    -o, --out <file>      Download edited video to file\n        --output <file>   Alias for --out\n        --json            Print JSON result\n        --timeout <sec>   Default: 600\n        --server <url>    Override server URL`);
        return;
    }
    const prompt = args.positional.join(" ");
    if (!prompt.trim())
        die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
    if (!args.video)
        die(2, "--video <url> is required");
    parseTimeoutSeconds(args.timeout);
    let server;
    try {
        server = await resolveServer({ serverFlag: args.server });
    }
    catch (e) {
        die(exitCodeForError(e), e.message);
        throw e;
    }
    const res = await fetch(`${server.base}/api/video/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, videoUrl: args.video }), signal: timeoutSignal(args.timeout) });
    const data = await readJsonResponse(res, "edit");
    if (!res.ok)
        die(1, `edit failed: ${data.error ?? res.status}`);
    const outPath = (args.out || args.output);
    if (outPath)
        await downloadReturnedVideo(server.base, data, outPath, timeoutSignal(args.timeout));
    if (args.json) {
        out(JSON.stringify(data, null, 2));
    }
    else {
        out(color.green("✓ ") + `Edited video: ${data.url}`);
    }
}
async function videoExtendCmd(argv) {
    const spec = { flags: { video: { type: "string" }, duration: { type: "string", default: "6" }, out: { short: "o", type: "string" }, output: { type: "string" }, json: { type: "boolean" }, timeout: { type: "string", default: "600" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
    const args = parseArgs(argv, spec);
    rejectUnknownFlags(args);
    if (args.help) {
        out(`  ima2 video extend <prompt> --video <url|file_id|generated-file> [--duration 6]\n\n  Extend video from its last frame.\n  Model: grok-imagine-video only. Extension: 2-10s.\n\n  Options:\n        --video <value>   Source video HTTPS URL, xAI file_id, data URL, or generated filename (required)\n        --duration <2-10> Extension duration (default: 6)\n    -o, --out <file>      Download extended video to file\n        --output <file>   Alias for --out\n        --json            Print JSON result\n        --timeout <sec>   Default: 600\n        --server <url>    Override server URL`);
        return;
    }
    const prompt = args.positional.join(" ");
    if (!prompt.trim())
        die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
    if (!args.video)
        die(2, "--video <url> is required");
    const duration = parseIntegerFlag(args.duration, 6, "--duration");
    if (duration < 2 || duration > 10)
        die(2, "--duration must be between 2 and 10");
    parseTimeoutSeconds(args.timeout);
    let server;
    try {
        server = await resolveServer({ serverFlag: args.server });
    }
    catch (e) {
        die(exitCodeForError(e), e.message);
        throw e;
    }
    const res = await fetch(`${server.base}/api/video/extend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, videoUrl: args.video, duration }), signal: timeoutSignal(args.timeout) });
    const data = await readJsonResponse(res, "extend");
    if (!res.ok)
        die(1, `extend failed: ${data.error ?? res.status}`);
    const outPath = (args.out || args.output);
    if (outPath)
        await downloadReturnedVideo(server.base, data, outPath, timeoutSignal(args.timeout));
    if (args.json) {
        out(JSON.stringify(data, null, 2));
    }
    else {
        out(color.green("✓ ") + `Extended video (${data.duration}s): ${data.url}`);
    }
}
async function videoContinueCmd(argv) {
    const spec = {
        flags: {
            video: { type: "string" },
            duration: { type: "string", default: "5" },
            resolution: { type: "string", default: "720p" },
            "aspect-ratio": { type: "string", default: "auto" },
            model: { type: "string" },
            "planner-model": { type: "string" },
            out: { short: "o", type: "string" },
            output: { type: "string" },
            json: { type: "boolean" },
            timeout: { type: "string", default: "600" },
            server: { type: "string" },
            help: { short: "h", type: "boolean" },
        },
    };
    const args = parseArgs(argv, spec);
    rejectUnknownFlags(args);
    if (args.help) {
        out(`  ima2 video continue <prompt> --video <generated-file>\n\n  Generate a new clip from a generated video's last frame and carry branch-local revisedPrompt lineage.\n\n  Prompt must describe visual flow, motion, sound/music/no-music, dialogue/no-dialogue, ending frame, and how the selected duration should feel naturally filled.\n\n  Options:\n        --video <file>                 Generated .mp4 filename (required)\n        --duration <1..15>             Default: 5. Prompt motion should naturally fill this length\n        --resolution <480p|720p>       Default: 720p\n        --aspect-ratio <ratio|auto>    Default: auto\n        --model <name>                 grok-imagine-video, grok-imagine-video-1.5-preview\n    -o, --out <file>                   Download continued video to file\n        --output <file>                Alias for --out\n        --json                         Print JSON result\n        --timeout <sec>                Default: 600\n        --server <url>                 Override server URL`);
        return;
    }
    const prompt = args.positional.join(" ");
    if (!prompt.trim())
        die(2, ACTIVE_VIDEO_PROMPT_GUIDANCE);
    if (!args.video)
        die(2, "--video <generated-file> is required");
    const duration = parseIntegerFlag(args.duration, 5, "--duration");
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
    parseTimeoutSeconds(args.timeout);
    let server;
    try {
        server = await resolveServer({ serverFlag: args.server });
    }
    catch (e) {
        die(exitCodeForError(e), e.message);
        throw e;
    }
    const requestId = `req_cli_video_continue_${Date.now().toString(36)}`;
    const body = {
        prompt,
        requestId,
        duration,
        resolution,
        aspectRatio,
        continueFromVideo: args.video,
    };
    if (args.model)
        body.model = args.model;
    if (args["planner-model"])
        body.plannerModel = args["planner-model"];
    const data = await runVideoGenerateRequest(server.base, body, args.timeout, Boolean(args.json));
    const outPath = (args.out || args.output);
    if (outPath)
        await downloadReturnedVideo(server.base, data, outPath, timeoutSignal(args.timeout));
    if (args.json)
        out(JSON.stringify(data, null, 2));
    else
        out(color.green("✓ ") + `Continued video: ${data.url}`);
}
async function videoFrameCmd(argv) {
    const spec = { flags: { last: { type: "boolean" }, position: { type: "string" }, out: { type: "string" }, output: { short: "o", type: "string" }, timeout: { type: "string", default: "60" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
    const args = parseArgs(argv, spec);
    rejectUnknownFlags(args);
    if (args.help) {
        out(`  ima2 video frame <generated-file> [--last] [--position <sec>] [-o output.png]\n\n  Extract a frame from a generated video file.\n\n  Options:\n        --last            Extract last frame (default)\n        --position <sec>  Extract frame at specific second\n    -o, --output <path>   Output file path\n        --out <path>      Alias for --output\n        --timeout <sec>   Default: 60\n        --server <url>    Override server URL`);
        return;
    }
    const file = args.positional[0];
    if (!file)
        die(2, "file argument required");
    if (args.last && args.position)
        die(2, "use either --last or --position, not both");
    const position = args.last ? "last" : (String(args.position || "last"));
    if (position !== "last" && !/^\d+(\.\d+)?$/.test(position))
        die(2, "--position must be a non-negative number");
    parseTimeoutSeconds(args.timeout);
    let server;
    try {
        server = await resolveServer({ serverFlag: args.server });
    }
    catch (e) {
        die(exitCodeForError(e), e.message);
        throw e;
    }
    const url = `${server.base}/api/video/frame?file=${encodeURIComponent(file)}&position=${encodeURIComponent(position)}`;
    const res = await fetch(url, { signal: timeoutSignal(args.timeout) });
    if (!res.ok) {
        const d = await readJsonResponse(res, "frame extraction");
        die(1, `frame extraction failed: ${d.error || res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const outPath = (args.output || args.out) || `frame-${basename(file).replace(/\.[^.]+$/, "")}.png`;
    await writeBuffer(outPath, buf);
    out(color.green("✓ ") + `Frame saved: ${outPath} (${buf.length} bytes)`);
}
async function videoAnalyzeCmd(argv) {
    const spec = { flags: { json: { type: "boolean" }, timeout: { type: "string", default: "180" }, server: { type: "string" }, help: { short: "h", type: "boolean" } } };
    const args = parseArgs(argv, spec);
    rejectUnknownFlags(args);
    if (args.help) {
        out(`  ima2 video analyze <generated-file>\n\n  Analyze first/last frames from a generated .mp4 with Grok 4.3 image understanding. Outputs structured recreation prompt.\n\n  Options:\n        --json            Print JSON result\n        --timeout <sec>   Default: 180\n        --server <url>    Override server URL`);
        return;
    }
    const videoUrl = args.positional[0];
    if (!videoUrl)
        die(2, "generated video filename required");
    parseTimeoutSeconds(args.timeout);
    let server;
    try {
        server = await resolveServer({ serverFlag: args.server });
    }
    catch (e) {
        die(exitCodeForError(e), e.message);
        throw e;
    }
    const res = await fetch(`${server.base}/api/video/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoUrl }), signal: timeoutSignal(args.timeout) });
    const data = await readJsonResponse(res, "analyze");
    if (!res.ok)
        die(1, `analyze failed: ${data.error || res.status}`);
    if (args.json) {
        out(JSON.stringify(data, null, 2));
    }
    else {
        out(data.analysis);
    }
}
