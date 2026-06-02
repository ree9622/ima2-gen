import type { RouteRuntimeContext } from "./runtimeContext.js";

const DEFAULT_GROK_PROXY_HOST = "127.0.0.1";
const DEFAULT_GROK_PROXY_PORT = 18645;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

export function getGrokProxyBaseUrl(ctx: RouteRuntimeContext = {}): string {
  const grokCfg = (ctx.config as any)?.grokProvider || {};
  const explicitUrl = (ctx as { grokUrl?: string }).grokUrl;
  if (explicitUrl) return normalizeBaseUrl(explicitUrl);

  const host = grokCfg.proxyHost || DEFAULT_GROK_PROXY_HOST;
  const port = (ctx as { grokActualPort?: number }).grokActualPort || grokCfg.proxyPort || DEFAULT_GROK_PROXY_PORT;
  return `http://${host}:${port}`;
}

export function getGrokProxyUrl(ctx: RouteRuntimeContext = {}, path = "/v1"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getGrokProxyBaseUrl(ctx)}${normalizedPath}`;
}

export function getGrokDirectBaseUrl(): string {
  return "https://api.x.ai";
}
