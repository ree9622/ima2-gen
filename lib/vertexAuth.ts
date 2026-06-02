import { GoogleAuth } from "google-auth-library";

let cachedAuth: GoogleAuth | null = null;
let cachedProjectId: string | null = null;

export function initVertexAuth(serviceAccountJson: string): { projectId: string } {
  let parsed: { project_id?: string; type?: string };
  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch {
    // Never surface the raw JSON (it contains the private key) in the error.
    throw new Error("Invalid service account JSON: could not parse");
  }
  if (!parsed.project_id || parsed.type !== "service_account") {
    throw new Error("Invalid service account JSON: missing project_id or type !== service_account");
  }
  // Build the client first; only commit module state once construction succeeds,
  // so a throw can't leave isVertexInitialized() true with mismatched creds.
  const auth = new GoogleAuth({
    credentials: parsed as Record<string, unknown>,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  cachedAuth = auth;
  cachedProjectId = parsed.project_id;
  return { projectId: parsed.project_id };
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
