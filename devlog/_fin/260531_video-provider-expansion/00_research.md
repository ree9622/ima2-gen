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

**모델은 Grok만 사용.** Runway/Higgsfield는 설계 참고용.

참고할 설계 패턴:
1. Tool schema 구조 (discrete duration, startFrame/endFrame 분리, generateAudio)
2. Async 워크플로우 (submit → poll → download, server-side blocking)
3. 워크플로우 체이닝 (image→video, series, multi-shot)
4. MCP 서버로 노출하는 방식

**ima2의 방향**: ima2 자체를 MCP 서버로 만들어서 다른 agent가 호출 가능하게.
- `ima2 mcp serve` → stdio/HTTP transport
- Tools: `ima2_generate_video`, `ima2_generate_image`, `ima2_get_task`
- 모델: Grok only (grok-imagine-video, grok-imagine-image)

---

## ima2-gen Provider Interface Design

```typescript
// ima2 as MCP Client — connects to remote MCP servers
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

// Provider registry
const PROVIDERS = {
  grok: { type: "internal" },  // existing adapter
  runway: { url: "https://mcp.runwayml.com/mcp", tool: "generate_video", auth: "RUNWAYML_API_SECRET" },
  higgsfield: { url: "https://mcp.higgsfield.ai/mcp", tool: "generate_create", auth: "oauth-device-code" },
};

// CLI usage:
// ima2 video "prompt" --provider runway --model seedance-2 --duration 10
// ima2 video "prompt" --provider higgsfield --model kling3_0
// ima2 video "prompt"  (default: grok)

// Workflow chaining (MCP tool sequences):
// 1. Image→Video: generate_image → generate_video(startFrame=imageUrl)
// 2. Multi-shot: generate_multishot_video(shots=[...])
// 3. Marketing: generate_product_marketing_video(productUrl=...)
// 4. Real V2V: generate_video(referenceVideo=videoUrl)
```

## Runway MCP Exact Tool Schema

```json
{
  "name": "generate_video",
  "params": {
    "promptText": "string (required)",
    "model": "seedance-2 | kling-o3-pro | kling-3-pro | gen-4.5 | veo-3.1 | gen-4-turbo",
    "duration": "5 | 10 | 15",
    "ratio": "1280:720 | 720:1280 | 960:960 | ...",
    "resolution": "480p | 720p | 1080p",
    "startFrame": "{ url }",
    "endFrame": "{ url }",
    "referenceVideo": "{ url, durationSeconds? }",
    "referenceImages": "[{ url, tag? }]",
    "generateAudio": "boolean"
  }
}
```

## Higgsfield MCP/CLI Schema

```bash
higgsfield generate create <model> \
  --prompt "..." --duration 5 --aspect_ratio 16:9 \
  --resolution 1080p --mode pro --start-image ./img.png \
  --wait --json
# Returns: { id, status, result_url, model, created_at, completed_at }
```

## MCP Ecosystem (Video/Media Servers)

| Server | Approach | Models |
|--------|----------|--------|
| Runway MCP (official) | REST API wrapper | Gen-4.5, Seedance-2, Kling, Veo |
| Higgsfield MCP | Multi-model aggregator | 17 models (Veo, Kling, Seedance, Wan, Hailuo, Grok) |
| PiAPI MCP | Paid proxy | Midjourney, Flux, Kling, Luma, Suno |
| kie-ai MCP | Unified API | Runway Aleph + Suno + Midjourney + Recraft |
| agbrowse (planned) | CDP browser automation | All web UIs (zero credits) |
