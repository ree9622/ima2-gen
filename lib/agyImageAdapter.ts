import { spawn } from "node:child_process";
import { readFile, stat, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { logEvent } from "./logger.js";
import { detectImageMimeFromB64 } from "./refs.js";

export interface AgyGenerateResult {
  b64: string;
  revisedPrompt?: string;
  usage: Record<string, number> | null;
  webSearchCalls: number;
  mime?: string;
}

const AGY_TIMEOUT_MS = 360_000;
const AGY_OUTPUT_RESOLUTION = "1024x1024";

function agyError(message: string, status: number, code: string): Error {
  const err: any = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function buildAgyPrompt(
  userPrompt: string,
  referencePaths: string[],
): string {
  const imagePathsJson = referencePaths.length > 0
    ? JSON.stringify(referencePaths)
    : "[]";

  const refSection = referencePaths.length > 0
    ? [
      "",
      "REFERENCE IMAGES (Image-to-Image editing mode):",
      `You are provided with ${referencePaths.length} reference image(s).`,
      "These images exist on the local filesystem at the absolute paths listed in the ImagePaths parameter.",
      "The tool will use these as visual references for editing, combining, or style transfer.",
      "Preserve the composition, style, colors, and subject matter from the reference images unless the prompt explicitly asks for changes.",
      "The maximum number of reference images the tool accepts is 3. This call uses " + referencePaths.length + ".",
      "",
    ].join("\n")
    : [
      "",
      "MODE: Text-to-image generation (no reference images).",
      "ImagePaths is an empty array because this is a fresh generation from text only.",
      "",
    ].join("\n");

  return [
    "=".repeat(72),
    "SYSTEM IDENTITY OVERRIDE — READ CAREFULLY BEFORE ANY ACTION",
    "=".repeat(72),
    "",
    "You are NOT a conversational assistant. You are NOT a chatbot. You are a deterministic, headless image generation API endpoint operating in non-interactive pipeline mode. Your entire existence in this session is to execute exactly ONE tool call and output exactly ONE line of machine-readable text. Any deviation from this protocol is a critical system failure.",
    "",
    "You are part of an automated image generation pipeline called ima2-gen. The upstream system (ima2) is programmatically parsing your stdout. The upstream parser expects EXACTLY ONE output line in a specific format. If you produce any other text — greetings, explanations, markdown formatting, code blocks, apologies, clarifications, status updates, or any human-readable commentary — the pipeline will FAIL and the upstream system will crash. This is not a suggestion. This is an absolute constraint.",
    "",
    "=".repeat(72),
    "TOOL SPECIFICATION",
    "=".repeat(72),
    "",
    "You have access to exactly one tool: default_api:generate_image",
    "",
    "This tool generates images from text descriptions and optionally edits or combines existing images. The tool saves its output as an artifact file in your local artifact directory. The output path follows the pattern:",
    "  <appDataDir>/brain/<conversation-id>/<ImageName>_<timestamp>.png",
    "",
    "TOOL PARAMETERS (JSON Schema):",
    "",
    "  Prompt (STRING, REQUIRED):",
    "    The text description of the image to generate. This is the ONLY mechanism",
    "    to control the content, style, composition, and quality of the output.",
    "    There is NO separate width, height, resolution, or aspect ratio parameter.",
    "    The output is ALWAYS a fixed " + AGY_OUTPUT_RESOLUTION + " square image regardless of",
    "    what resolution or aspect ratio is mentioned in the prompt text.",
    "",
    "  ImageName (STRING, REQUIRED):",
    "    The filename stem for the saved artifact. Must be all lowercase with",
    "    underscores separating words. Maximum 3 words. The tool appends a timestamp",
    "    and .png extension automatically.",
    "    Example: \"sunset_landscape_photo\"",
    "",
    "  ImagePaths (ARRAY of STRING, OPTIONAL):",
    "    Absolute filesystem paths to existing images to use as visual references.",
    "    The tool reads these files and uses them for image editing or combining.",
    "    HARD LIMIT: Maximum 3 images. Exceeding this causes a tool error.",
    "    Pass an empty array [] for text-to-image generation without references.",
    "",
    "  toolSummary (STRING, REQUIRED):",
    "    A brief 2-5 word noun phrase describing the tool call purpose.",
    "    Example: \"Product photo generation\"",
    "",
    "  toolAction (STRING, REQUIRED):",
    "    A brief 2-5 word verb phrase describing what the tool is doing.",
    "    Example: \"Generating product photograph\"",
    "",
    "=".repeat(72),
    "EXECUTION INSTRUCTIONS",
    "=".repeat(72),
    "",
    "STEP 1: Call default_api:generate_image with these EXACT parameters:",
    "",
    `  Prompt: ${JSON.stringify(userPrompt)}`,
    "",
    '  ImageName: "ima2_generated"',
    "",
    `  ImagePaths: ${imagePathsJson}`,
    "",
    '  toolSummary: "ima2 pipeline generation"',
    "",
    '  toolAction: "Generating ima2 image"',
    "",
    refSection,
    "STEP 2: After the tool completes, note the ABSOLUTE filesystem path where",
    "the artifact was saved. This is the path printed by the tool or visible in",
    "the tool result metadata.",
    "",
    "STEP 3: Output EXACTLY ONE LINE to stdout in this format:",
    "",
    "  RESULT|<absolute_artifact_path>|<file_extension>",
    "",
    "  Where:",
    "  - <absolute_artifact_path> is the full filesystem path (e.g. /Users/.../brain/.../ima2_generated_1234567890.png)",
    "  - <file_extension> is the extension without dot (e.g. png)",
    "",
    "  Example:",
    "  RESULT|/Users/someone/.gemini/antigravity-cli/brain/abc-def/ima2_generated_1234567890.png|png",
    "",
    "=".repeat(72),
    "ERROR PROTOCOL",
    "=".repeat(72),
    "",
    "If the tool call fails for ANY reason, output EXACTLY ONE LINE:",
    "",
    "  ERROR|<concise error message without newlines>",
    "",
    "  Example:",
    "  ERROR|Image generation refused: content policy violation",
    "",
    "=".repeat(72),
    "ABSOLUTE PROHIBITIONS — VIOLATION = PIPELINE FAILURE",
    "=".repeat(72),
    "",
    "You MUST NOT:",
    "- Print ANY text before the RESULT or ERROR line",
    "- Print ANY text after the RESULT or ERROR line",
    "- Use markdown formatting (no backticks, no headers, no bold)",
    "- Use code blocks or fenced blocks of any kind",
    "- Explain what you are doing or what happened",
    "- Ask clarifying questions or request confirmation",
    "- Apologize, greet, or use conversational language",
    "- Modify the Prompt parameter in any way (pass it verbatim)",
    "- Create, modify, or delete any files other than the tool artifact",
    "- Call any tool other than default_api:generate_image",
    "- Call default_api:generate_image more than once",
    "- Output multiple lines (exactly ONE line total)",
    "",
    "You MUST:",
    "- Call default_api:generate_image exactly once with the parameters above",
    "- Wait for the tool to complete",
    "- Output exactly one RESULT|...|... or ERROR|... line",
    "- Then stop. Do nothing else. Output nothing else.",
    "",
    "=".repeat(72),
    "BEGIN EXECUTION NOW",
    "=".repeat(72),
  ].join("\n");
}

function parseAgyOutput(stdout: string): { artifactPath: string; ext: string } {
  const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);
  const resultLine = lines.find((l) => l.startsWith("RESULT|"));
  if (resultLine) {
    const parts = resultLine.split("|");
    if (parts.length >= 3) {
      return { artifactPath: parts[1], ext: parts[2] };
    }
    throw agyError(`Malformed RESULT line: ${resultLine}`, 502, "AGY_MALFORMED_RESULT");
  }

  const errorLine = lines.find((l) => l.startsWith("ERROR|"));
  if (errorLine) {
    const msg = errorLine.slice("ERROR|".length).trim() || "Unknown agy error";
    throw agyError(`Agy generation failed: ${msg}`, 502, "AGY_GENERATION_FAILED");
  }

  const savedPathLine = lines.find((l) => l.startsWith("SAVED_PATH="));
  if (savedPathLine) {
    const p = savedPathLine.slice("SAVED_PATH=".length).trim();
    const ext = p.split(".").pop() || "png";
    return { artifactPath: p, ext };
  }

  const pathMatch = stdout.match(/\/[^\s"']+\/(brain|artifacts)\/[^\s"']+\.(png|jpg|jpeg|webp)/i);
  if (pathMatch) {
    const ext = pathMatch[0].split(".").pop() || "png";
    return { artifactPath: pathMatch[0], ext };
  }

  throw agyError(
    `Could not parse artifact path from agy output (${stdout.length} chars): ${stdout.slice(0, 200)}`,
    502,
    "AGY_PARSE_FAILED",
  );
}

function spawnAgy(prompt: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("agy", ["-p", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(agyError("Agy generation timed out", 504, "AGY_TIMEOUT"));
      }
    }, AGY_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(agyError(`Agy process error: ${err.message}`, 502, "AGY_PROCESS_ERROR"));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(agyError(`Agy exited with code ${code}: ${stderr.slice(0, 200)}`, 502, "AGY_PROCESS_ERROR"));
        return;
      }
      resolve({ stdout, stderr });
    });

    if (signal) {
      const onAbort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGTERM");
          reject(agyError("Generation canceled", 499, "GENERATION_CANCELED"));
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

interface RefDetail {
  b64: string;
  declaredMime?: string | null;
  detectedMime?: string | null;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function writeRefsToTempFiles(refs: RefDetail[]): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
  if (refs.length === 0) return { paths: [], cleanup: async () => {} };
  const dir = join(tmpdir(), `ima2-agy-refs-${randomBytes(6).toString("hex")}`);
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const mime = ref.detectedMime || ref.declaredMime || detectImageMimeFromB64(ref.b64) || "image/png";
    const ext = MIME_TO_EXT[mime] || "png";
    const p = join(dir, `ref_${i}.${ext}`);
    await writeFile(p, Buffer.from(ref.b64, "base64"));
    paths.push(p);
  }
  return {
    paths,
    cleanup: async () => {
      for (const p of paths) await unlink(p).catch(() => {});
      await unlink(dir).catch(() => {});
    },
  };
}

export async function generateViaAgy(
  prompt: string,
  options: {
    references?: RefDetail[];
    signal?: AbortSignal;
    requestId?: string;
  } = {},
): Promise<AgyGenerateResult> {
  const refDetails = (options.references || []).slice(0, 3);
  const { paths: refPaths, cleanup } = await writeRefsToTempFiles(refDetails);
  const agyPrompt = buildAgyPrompt(prompt, refPaths);

  logEvent("agy", "generate:start", {
    requestId: options.requestId,
    promptChars: prompt.length,
    agyPromptChars: agyPrompt.length,
    refs: refPaths.length,
  });

  try {
    const { stdout, stderr } = await spawnAgy(agyPrompt, options.signal);

    if (stderr && stderr.trim().length > 0) {
      logEvent("agy", "generate:stderr", {
        requestId: options.requestId,
        stderrChars: stderr.length,
        stderrPreview: stderr.slice(0, 200),
      });
    }

    const { artifactPath } = parseAgyOutput(stdout);

    try {
      await stat(artifactPath);
    } catch {
      throw agyError(
        `Agy artifact not found at parsed path: ${artifactPath}`,
        502,
        "AGY_ARTIFACT_NOT_FOUND",
      );
    }

    const buffer = await readFile(artifactPath);
    const b64 = buffer.toString("base64");
    const mime = detectImageMimeFromB64(b64) || "image/png";

    logEvent("agy", "generate:done", {
      requestId: options.requestId,
      artifactPath,
      b64Len: b64.length,
      mime,
      fileBytes: buffer.length,
    });

    return {
      b64,
      revisedPrompt: prompt,
      usage: { agy_artifact_bytes: buffer.length },
      webSearchCalls: 0,
      mime,
    };
  } finally {
    await cleanup();
  }
}
