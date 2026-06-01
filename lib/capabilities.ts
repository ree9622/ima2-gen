import { config as runtimeConfigDefault } from "../config.js";
import { KEY_TO_ENV, WRITABLE_CONFIG_KEYS } from "./configKeys.js";
import { DEFAULT_IMAGE_QUALITY, VALID_IMAGE_QUALITIES } from "./oauthNormalize.js";
import type { AppConfig } from "./runtimeContext.js";

type CapabilitySource = "local" | "server";

const MAX_GENERATED_IMAGES = 8;
const VALID_MODES = ["auto", "direct"] as const;
const VALID_PROVIDERS = ["auto", "oauth", "api", "grok"] as const;
const AGENT_COMMANDS = [
  "skill",
  "capabilities",
  "defaults",
  "gen",
  "video",
  "edit",
  "multimode",
  "node generate",
  "inflight ls",
  "providers",
  "oauth status",
  "grok status",
  "prompt build",
];

function toArray<T>(value: Iterable<T> | T[] | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return [...value];
  return Array.from(value);
}

export function buildIma2Capabilities({
  appConfig = runtimeConfigDefault,
  packageVersion,
  source,
  server = null,
}: {
  appConfig?: AppConfig;
  packageVersion: string;
  source: CapabilitySource;
  server?: string | null;
}) {
  return {
    ok: true,
    name: "ima2",
    source,
    server,
    version: packageVersion,
    commands: AGENT_COMMANDS,
    defaults: {
      oauth: {
        model: appConfig.imageModels.default,
        reasoningEffort: appConfig.imageModels.reasoningEffort,
      },
      api: {
        model: appConfig.apiProvider.defaultImageModel,
        reasoningEffort: appConfig.apiProvider.defaultReasoningEffort,
        size: appConfig.apiProvider.defaultSize,
        webSearchEnabled: appConfig.apiProvider.allowWebSearch,
      },
      grok: {
        model: appConfig.grokProvider.defaultImageModel,
        plannerModel: appConfig.grokProvider.plannerModel,
      },
    },
    valid: {
      imageModels: {
        supported: toArray(appConfig.imageModels.valid),
        unsupported: toArray(appConfig.imageModels.unsupported),
        grokSupported: ["grok-imagine-image", "grok-imagine-image-quality"],
      },
      videoModels: {
        supported: ["grok-imagine-video", "grok-imagine-video-1.5-preview"],
        resolutions: ["480p", "720p"],
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "auto"],
        durationRange: [1, 15],
        maxReferences: 7,
      },
      reasoningEfforts: toArray(appConfig.imageModels.validReasoningEfforts),
      quality: toArray(VALID_IMAGE_QUALITIES),
      moderation: toArray(appConfig.oauth.validModeration),
      modes: [...VALID_MODES],
      providers: [...VALID_PROVIDERS],
    },
    configKeys: {
      writable: toArray(WRITABLE_CONFIG_KEYS),
      envOverrides: { ...KEY_TO_ENV },
    },
    defaultsMeta: {
      quality: DEFAULT_IMAGE_QUALITY,
    },
    limits: {
      maxRefCount: appConfig.limits.maxRefCount,
      maxGeneratedImages: MAX_GENERATED_IMAGES,
      maxParallel: {
        value: appConfig.limits.maxParallel,
        enforced: false,
        note: "advisory client-side queue guidance only; server-side semaphore is not enforced",
      },
    },
    promptBuilder: {
      available: true,
      route: "/api/prompt-builder/chat",
      cliCommand: "ima2 prompt build",
      structuredOutput: ["intentSummary", "finalPrompt.ko", "finalPrompt.en", "notes"],
      uiOnly: false,
    },
    agentMode: {
      available: true,
      route: "/api/agent/sessions",
      allowedTools: ["ima2.get_image_context", "ima2.web_search", "ima2.generate_image"],
      finalArtifact: "image",
      uiOnly: true,
      cliCommand: null,
    },
    guidance: {
      highQuality: "Use --quality high for requests where output fidelity matters.",
      parallelGeneration: "Run multiple ima2 gen commands as separate queued jobs; no --parallel flag is required.",
      i2i: "Use --ref for reference generation, or ima2 edit <file> --prompt \"<text>\" for image edits.",
      defaults: "Use ima2 defaults set model/reasoning for persistent defaults; request flags remain per-call overrides.",
      promptBuilder: "Use ima2 prompt build --message \"...\" to refine prompt intent. Use ima2 gen / ima2 multimode to generate images. Workspace profile settings are UI-only.",
      video: "Use ima2 video \"<prompt>\" to generate video. Prompts must describe visual flow, motion, sound/no-music, dialogue/no-dialogue, and ending frame. Use ima2 video continue \"<prompt>\" --video <generated.mp4> for branch-local last-frame continuation; --topic is legacy best-effort series context.",
    },
  };
}
