# 00 — Video Provider Expansion Research

## Current State
- ima2-gen uses **Grok (xAI)** as sole video provider
- Models: grok-imagine-video, grok-imagine-video-1.5-preview
- Modes: T2V, I2V, Ref2V (up to 7 refs)
- Duration: 1-15s, Resolution: 480p/720p

---

## GPT Pro Architecture Feedback (2026-05-31)

5 follow-ups identified:

1. **Common request pipeline** — Node/Agent/CLI use different generation paths
2. **Asset ID model** — `sourceFilename` is implementation detail, need `assetId`
3. **V2V service layer** — Canvas last-frame extraction → abstract behind interface
4. **Agent intent tests** — ✅ Done (24 fixtures)
5. **Source provenance display** — Show "Using X as source" in UI/logs

---

## Runway MCP Analysis

**URL**: `https://mcp.runwayml.com/mcp`
**Auth**: OAuth (Runway account)
**Integration**: REST API available at docs.dev.runwayml.com (API key auth)

### Models (6 video):
| Model | Modes | Duration | Resolution |
|-------|-------|----------|------------|
| seedance-2 (default) | t2v, i2v, v2v | 5/10/15s | 480p/720p/1080p |
| kling-o3-pro | t2v, i2v, v2v | 5/10/15s | — |
| kling-3-pro | t2v, i2v | 5/10/15s | — |
| gen-4.5 | t2v, i2v | — | — |
| veo-3.1 | t2v, i2v | — | 720p/1080p |
| gen-4-turbo | t2v | — | — |

### Key Features:
- Real V2V (referenceVideo input) — seedance-2, kling-o3-pro
- Multi-shot video (3-5 connected scenes via Kling 3.0)
- Start/end frame targeting
- Audio generation
- 1080p support

### Integration Path:
- REST API with `RUNWAYML_API_SECRET` — standard HTTP calls
- Async: submit → poll → download
- Output URLs are ephemeral — must download immediately

---

## Higgsfield MCP Analysis

**URL**: `https://mcp.higgsfield.ai/mcp`
**Auth**: OAuth device-code (no API key)
**Integration**: CLI (`@higgsfield/cli`) or MCP client only — NO public REST API

### Models (17 video):
Veo 3.1, Veo 3, Kling 3.0, Kling 2.6, Seedance 2.0, Seedance 1.5, Wan 2.7, Wan 2.6, Minimax Hailuo, Grok Video, Cinematic Studio 3.0, Soul Cast, Marketing Studio, etc.

### Key Features:
- Multi-model aggregator (30+ models through one account)
- Up to 4K resolution, 15s duration
- Soul character training (face-faithful identity)
- Virality prediction
- Marketing video from URL

### Integration Path:
- CLI subprocess: `higgsfield generate create <model> --prompt "..." --wait --json`
- Requires `@higgsfield/cli` installed + OAuth session
- Less clean than REST API but functional

---

## Integration Recommendation

| Provider | Ease | Models | Best For |
|----------|------|--------|----------|
| **Grok (current)** | ✅ Already done | 2 | Default, SuperGrok users |
| **Runway REST API** | ✅ Easy (HTTP + API key) | 6 | Gen-4.5, real V2V, 1080p |
| **Higgsfield CLI** | ⚠️ Medium (subprocess) | 17 | Multi-model access, Veo/Kling/Seedance |

### Priority:
1. Runway REST API — proper HTTP integration, API key auth, real V2V
2. Higgsfield CLI wrapper — subprocess-based, access to 17 models
3. agbrowse CDP (Runway web) — zero credits on Explore mode (future)

---

## ima2-gen Provider Interface Design

```typescript
interface VideoProvider {
  name: string;
  submitJob(input: VideoJobInput): Promise<VideoJobHandle>;
  pollStatus(handle: VideoJobHandle): Promise<VideoJobStatus>;
  downloadResult(handle: VideoJobHandle): Promise<Buffer>;
  cancelJob?(handle: VideoJobHandle): Promise<void>;
  listModels(): Promise<VideoModelInfo[]>;
}

interface VideoJobInput {
  prompt: string;
  model?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  sourceImage?: string;      // b64 or URL
  sourceVideo?: string;      // URL (real V2V)
  referenceImages?: string[];
  startFrame?: string;
  endFrame?: string;
  generateAudio?: boolean;
}
```
