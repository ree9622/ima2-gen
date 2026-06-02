import { GoogleAuth } from "google-auth-library";

let cachedAuth: GoogleAuth | null = null;
let cachedProjectId: string | null = null;

export function initVertexAuth(serviceAccountJson: string): { projectId: string } {
  const parsed = JSON.parse(serviceAccountJson);
  if (!parsed.project_id || parsed.type !== "service_account") {
    throw new Error("Invalid service account JSON: missing project_id or type !== service_account");
  }
  cachedProjectId = parsed.project_id as string;
  cachedAuth = new GoogleAuth({
    credentials: parsed,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return { projectId: cachedProjectId };
}

export async function getVertexAccessToken(): Promise<string> {
  if (!cachedAuth) throw new Error("Vertex AI not initialized — call initVertexAuth first");
  const client = await cachedAuth.getClient();
  const tokenRes = await client.getAccessToken();
  if (!tokenRes.token) throw new Error("Failed to obtain Vertex AI access token");
  return tokenRes.token;
}

export function getVertexProjectId(): string | null {
  return cachedProjectId;
}

export function isVertexInitialized(): boolean {
  return cachedAuth !== null && cachedProjectId !== null;
}

export function clearVertexAuth(): void {
  cachedAuth = null;
  cachedProjectId = null;
}
