import { parseArgs } from "../lib/args.js";
import { resolveServer, request, recoverGeneratedImages, isTimeoutError } from "../lib/client.js";
import { fileToDataUri, dataUriToFile, defaultOutName } from "../lib/files.js";
import { out, err, die, color, json, exitCodeForError } from "../lib/output.js";
import { randomBytes } from "node:crypto";

function newRequestId() {
  return `cli_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

const SPEC = {
  flags: {
    prompt:  { short: "p", type: "string" },
    quality: { short: "q", type: "string", default: "low" },
    size:    { short: "s", type: "string", default: "1024x1024" },
    moderation: { type: "string", default: "low" },
    "max-attempts": { type: "string", default: "7" },
    out:     { short: "o", type: "string" },
    json:    {              type: "boolean" },
    timeout: {              type: "string", default: "180" },
    server:  {              type: "string" },
    help:    { short: "h", type: "boolean" },
  },
};

const HELP = `
  ima2 edit <file> --prompt "<text>" [options]

  Edit an existing image (inpainting-style).

  Options:
    -p, --prompt <text>        Edit instruction (required)
    -q, --quality <low|medium|high|auto>
    -s, --size <WxH>
        --moderation <auto|low>
        --max-attempts <1..10>
    -o, --out <file>
        --json
`;

export default async function editCmd(argv) {
  const args = parseArgs(argv, SPEC);
  if (args.help) { out(HELP); return; }
  const input = args.positional[0];
  if (!input) die(2, "input image path required");
  if (!args.prompt) die(2, "--prompt is required");

  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), e.message); }

  const imageDataUri = await fileToDataUri(input);
  const imageB64 = imageDataUri.split(",")[1];

  const timeoutMs = (parseInt(args.timeout) || 180) * 1000;
  const maxAttempts = Math.max(1, Math.min(10, parseInt(args["max-attempts"]) || 7));
  const requestId = newRequestId();
  let resp;
  try {
    resp = await request(server.base, "/api/edit", {
      method: "POST",
      body: {
        requestId,
        prompt: args.prompt,
        image: imageB64,
        quality: args.quality,
        size: args.size,
        moderation: args.moderation,
        maxAttempts,
      },
      timeoutMs,
    });
  } catch (e) {
    if (isTimeoutError(e)) {
      try {
        const recovered = await recoverGeneratedImages(server.base, requestId);
        const first = recovered.images[0];
        resp = { image: first?.image, filename: first?.filename, requestId, elapsed: null, recovered: true };
        if (!args.json) err(color.dim(`request timed out; recovered output for ${requestId}`));
      } catch (recoverErr) {
        if (args.json) json({ ok: false, error: e.message, code: e.code, status: e.status, recoverError: recoverErr.message, recoverCode: recoverErr.code });
        die(exitCodeForError(e), `${e.message}; recovery failed: ${recoverErr.message}`);
      }
    } else {
      if (args.json) json({ ok: false, error: e.message, code: e.code, status: e.status });
      die(exitCodeForError(e), e.message);
    }
  }

  const image = resp.image;
  if (!image) die(1, "server returned no image");
  const target = args.out || defaultOutName(0, 1);
  await dataUriToFile(image, target);

  if (args.json) {
    json({ ok: true, path: target, requestId: resp.requestId, elapsed: resp.elapsed, recovered: resp.recovered === true });
  } else {
    out(color.green("✓ ") + target);
    if (resp.elapsed) out(color.dim(`elapsed ${resp.elapsed}s`));
  }
}
