import type { ReferenceImageRef, ReferenceMetaHint } from "../types";

export type LoadedRetryReferences = {
  base64: string[];
  dataUrls: string[];
  hints: ReferenceMetaHint[];
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function loadRetryReferences(
  references: ReferenceImageRef[],
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedRetryReferences> {
  const base64: string[] = [];
  const dataUrls: string[] = [];
  const hints: ReferenceMetaHint[] = [];

  for (const reference of references) {
    const response = await fetchImpl(reference.sourceUrl);
    if (!response.ok) {
      throw new Error(`Reference image unavailable: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const encoded = arrayBufferToBase64(await blob.arrayBuffer());
    base64.push(encoded);
    dataUrls.push(`data:${blob.type || "application/octet-stream"};base64,${encoded}`);
    hints.push(
      reference.kind === "history" && reference.filename
        ? { kind: "history", filename: reference.filename }
        : { kind: "uploaded" },
    );
  }

  return { base64, dataUrls, hints };
}
