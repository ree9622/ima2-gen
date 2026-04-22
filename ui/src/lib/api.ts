import type {
  BillingResponse,
  GenerateRequest,
  GenerateResponse,
  OAuthStatus,
} from "../types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const message =
      (data as { error?: string }).error ?? `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export function getOAuthStatus(): Promise<OAuthStatus> {
  return jsonFetch<OAuthStatus>("/api/oauth/status");
}

export function getBilling(): Promise<BillingResponse> {
  return jsonFetch<BillingResponse>("/api/billing");
}

export function postGenerate(payload: GenerateRequest): Promise<GenerateResponse> {
  return jsonFetch<GenerateResponse>("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function postEdit(payload: GenerateRequest): Promise<GenerateResponse> {
  return jsonFetch<GenerateResponse>("/api/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type HistoryItem = {
  filename: string;
  url: string;
  createdAt: number;
  prompt: string | null;
  quality: string | null;
  size: string | null;
  format: string;
  provider: string;
  usage: Record<string, unknown> | null;
  webSearchCalls: number;
};

export function getHistory(limit = 50): Promise<{ items: HistoryItem[]; total: number }> {
  return jsonFetch(`/api/history?limit=${limit}`);
}

export type NodeGenerateRequest = {
  parentNodeId: string | null;
  prompt: string;
  quality: string;
  size: string;
  format: string;
  provider?: "oauth";
};

export type NodeGenerateResponse = {
  nodeId: string;
  parentNodeId: string | null;
  image: string;
  filename: string;
  url: string;
  elapsed: number;
  usage?: { total_tokens?: number } & Record<string, unknown>;
  webSearchCalls: number;
  provider: "oauth";
};

export type NodeErrorResponse = {
  error: { code: string; message: string };
  parentNodeId: string | null;
};

export async function postNodeGenerate(payload: NodeGenerateRequest): Promise<NodeGenerateResponse> {
  const res = await fetch("/api/node/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as NodeErrorResponse;
    const msg = err?.error?.message ?? `Request failed: ${res.status}`;
    const e = new Error(msg) as Error & { code?: string };
    e.code = err?.error?.code;
    throw e;
  }
  return data as NodeGenerateResponse;
}
