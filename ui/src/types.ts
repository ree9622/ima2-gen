export type UIMode = "classic" | "node";
export type Provider = "oauth" | "api";
export type Quality = "low" | "medium" | "high";
export type Format = "png" | "jpeg" | "webp";
export type Moderation = "low" | "auto";
export type Count = 1 | 2 | 4;

export type SizePreset =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "1360x1024"
  | "1024x1360"
  | "1824x1024"
  | "1024x1824"
  | "2048x2048"
  | "2048x1152"
  | "1152x2048"
  | "3824x2160"
  | "2160x3824"
  | "auto"
  | "custom";

export type GenerateItem = {
  image: string;
  url?: string;
  filename?: string;
  prompt?: string;
  originalPrompt?: string;
  elapsed?: number;
  provider?: string;
  quality?: string;
  size?: string;
  moderation?: string;
  usage?: { total_tokens?: number } & Record<string, unknown>;
  thumb?: string;
  createdAt?: number;
  favorite?: boolean;
};

export type GenerateSingleResponse = {
  image: string;
  elapsed: number;
  filename: string;
  usage?: GenerateItem["usage"];
  provider: string;
  quality?: string;
  size?: string;
  moderation?: string;
};

export type GenerateMultiResponse = {
  images: Array<{ image: string; filename: string }>;
  elapsed: number;
  count: number;
  usage?: GenerateItem["usage"];
  provider: string;
  quality?: string;
  size?: string;
  moderation?: string;
};

export type GenerateResponse = GenerateSingleResponse | GenerateMultiResponse;

export function isMultiResponse(r: GenerateResponse): r is GenerateMultiResponse {
  return Array.isArray((r as GenerateMultiResponse).images);
}

export type GenerateRequest = {
  prompt: string;
  quality: Quality;
  size: string;
  format: Format;
  moderation: Moderation;
  provider: Provider;
  n: number;
  image?: string;
  references?: string[];
  requestId?: string;
  maxAttempts?: number;
  // Pre-enhance original (only set when EnhanceModal applied a rewrite).
  // Server stores it in the sidecar so history can show what the user typed
  // before the model expanded it.
  originalPrompt?: string;
};

export type AttemptLog = {
  attempt: number;
  promptUsed: string;
  compliantVariant: boolean;
  ok: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  durationMs: number;
  startedAt: number;
};

export type GenerationLogItem = {
  id: string;
  status: "success" | "failed";
  createdAt: number;
  endpoint: "generate" | "edit" | "node";
  prompt: string | null;
  originalPrompt?: string | null;
  quality: string | null;
  size: string | null;
  format: string | null;
  moderation: string | null;
  maxAttempts: number | null;
  attempts: AttemptLog[];
  referenceCount: number;
  filename: string | null;
  url: string | null;
  sessionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type OAuthStatus = {
  status: "ready" | "auth_required" | "offline" | "starting";
  models?: string[];
};

export type BillingResponse = {
  credits?: { total_granted?: number; total_used?: number };
  costs?: { data?: Array<{ results: Array<{ amount?: { value?: number } }> }> };
  oauth?: boolean;
  apiKeyValid?: boolean;
  apiKeySource?: "none" | "env" | "config";
};
