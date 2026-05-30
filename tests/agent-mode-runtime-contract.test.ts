import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-runtime-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { registerAgentRoutes } = await import("../routes/agent.ts");
const { isRuntimeRestartableError } = await import("../lib/agentRuntime.ts");
const db = await import("../lib/db.ts");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

async function pngB64() {
  const buffer = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: "#334455",
    },
  }).png().toBuffer();
  return buffer.toString("base64");
}

async function withApp(fn: (baseUrl: string) => Promise<void>) {
  const generatedDir = join(TEST_DIR, `generated-${Date.now()}`);
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerAgentRoutes(app, {
    apiKey: "sk-test",
    config: {
      storage: { generatedDir },
      log: { level: "silent" },
    },
    packageVersion: "test",
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as import("node:net").AddressInfo;
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createSession(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "contract agent",
      currentImage: {
        id: "img_seed",
        filename: "seed.png",
        url: "/generated/seed.png",
        prompt: "seed prompt",
      },
    }),
  });
  assert.equal(res.status, 201);
  return await res.json() as { selectedSessionId: string; manifest: string };
}

describe("Agent Mode runtime contract", () => {
  it("exposes only ima2 image-agent tools", async () => {
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/agent/tools`);
      assert.deepEqual(await res.json(), {
        tools: ["ima2.get_image_context", "ima2.web_search", "ima2.generate_image"],
      });
    });
  });

  it("keeps the image context manifest across compact/resume", async () => {
    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      assert.match(created.manifest, /img_seed/);
      await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleLocks: ["ink wash"], subjectLocks: ["main character"] }),
      });

      const compacted = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}/compact`, {
        method: "POST",
      });
      assert.equal(compacted.status, 200);

      const manifestRes = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}/manifest`);
      const manifest = await manifestRes.text();
      assert.match(manifest, /img_seed/);
      assert.match(manifest, /ink wash/);
      assert.match(manifest, /main character/);
      assert.match(manifest, /compactStatus: compacted/);
      assert.match(manifest, /ima2.generate_image/);
    });
  });

  it("generates through the allowed Responses tool bridge and stores image handles", async () => {
    const finalImage = await pngB64();
    const calls: Array<{ body: any }> = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
      calls.push({ body: JSON.parse(String(init?.body)) });
      return sseResponse([
        { type: "response.output_text.delta", delta: "Use a crisp frontal composition." },
        { type: "response.output_text.done", text: "Use a crisp frontal composition." },
        {
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: finalImage, revised_prompt: "revised agent prompt" },
        },
        { type: "response.output_item.done", item: { type: "web_search_call" } },
        { type: "response.completed", response: { usage: { total_tokens: 7 } } },
      ]);
    };

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      const res = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "make a crisp product mockup", provider: "api" }),
      });
      const body = await res.json() as any;
      const images = Object.values(body.imagesById) as Array<{ url: string; revisedPrompt?: string }>;
      const turns = body.turnsBySession[created.selectedSessionId] as Array<{ role: string; text: string; imageIds?: string[] }>;

      assert.equal(res.status, 200);
      assert.deepEqual(calls[0].body.tools.map((tool: { type: string }) => tool.type), ["web_search", "image_generation"]);
      assert.match(calls[0].body.input[1].content, /<ima2-image-context>/);
      assert.ok(images.some((image) => image.url.startsWith("/generated/")));
      assert.ok(!JSON.stringify(turns).includes(finalImage));
      assert.ok(turns.some((turn) => turn.text.includes("ima2.get_image_context")));
      const assistantImageTurn = turns.find((turn) => turn.role === "assistant" && turn.imageIds?.length);
      assert.ok(assistantImageTurn);
      const modelTextIndex = assistantImageTurn.text.indexOf("Use a crisp frontal composition.");
      const artifactTextIndex = assistantImageTurn.text.indexOf("Generated 1 image artifact.");
      assert.ok(modelTextIndex >= 0);
      assert.ok(artifactTextIndex > modelTextIndex);
    });
  });

  it("generates through Grok planned Images API when Agent provider is grok", async () => {
    const finalImage = await pngB64();
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:") && !String(url).includes("/v1/")) return originalFetch(url, init);
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/v1/responses")) {
        return Response.json({
          output: [{ type: "message", content: [{ type: "output_text", text: "Agent Grok visual brief." }] }],
        });
      }
      if (String(url).endsWith("/v1/chat/completions")) {
        return Response.json({
          choices: [{
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "generate_image",
                  arguments: JSON.stringify({ prompt: "planned agent grok prompt", model: "grok-imagine-image" }),
                },
              }],
            },
          }],
        });
      }
      return Response.json({
        data: [{ b64_json: finalImage, mime_type: "image/jpeg" }],
        usage: { cost_in_usd_ticks: 5 },
      });
    };

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      const res = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "make a Grok agent poster",
          provider: "grok",
          model: "grok-imagine-image",
          quality: "high",
          webSearchEnabled: false,
        }),
      });
      const body = await res.json() as any;
      const images = Object.values(body.imagesById) as Array<{ url: string; revisedPrompt?: string }>;
      const turns = body.turnsBySession[created.selectedSessionId] as Array<{ text: string; imageIds?: string[] }>;

      assert.equal(res.status, 200);
      assert.ok(images.some((image) => image.url.endsWith(".jpeg")));
      assert.ok(images.some((image) => image.revisedPrompt === "planned agent grok prompt"));
      assert.ok(turns.some((turn) => turn.text.includes("ima2.web_search + ima2.generate_image")));
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/responses")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/chat/completions")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/v1/images/generations")).length, 1);
      assert.equal(calls.find((call) => call.url.endsWith("/v1/images/generations"))?.body.model, "grok-imagine-image-quality");
      assert.match(calls.find((call) => call.url.endsWith("/v1/chat/completions"))?.body.messages[1].content[0].text, /English only/);
    });
  });

  it("persists selected Agent image focus and rejects cross-session image ids", async () => {
    const finalImage = await pngB64();
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
      return sseResponse([
        {
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: finalImage, revised_prompt: "generated focus target" },
        },
        { type: "response.completed", response: { usage: { total_tokens: 4 } } },
      ]);
    };

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      const generated = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "make a second image", provider: "api" }),
      });
      const generatedBody = await generated.json() as {
        currentImageId: string;
        imagesById: Record<string, { id: string }>;
        imageIdsBySession: Record<string, string[]>;
        turnsBySession: Record<string, Array<{ text: string; imageIds?: string[] }>>;
      };
      const turns = generatedBody.turnsBySession[created.selectedSessionId];

      assert.equal(generated.status, 200);
      assert.notEqual(generatedBody.currentImageId, "img_seed");
      assert.ok(generatedBody.imageIdsBySession[created.selectedSessionId].includes("img_seed"));
      assert.equal(generatedBody.imageIdsBySession[created.selectedSessionId].length, 2);
      assert.ok(turns.some((turn) => turn.text.includes("Generated 1 image artifact.")));
      assert.ok(turns.some((turn) => turn.imageIds?.includes(generatedBody.currentImageId)));

      const selected = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentImageId: "img_seed" }),
      });
      const selectedBody = await selected.json() as { currentImageId: string; manifest: string };
      assert.equal(selected.status, 200);
      assert.equal(selectedBody.currentImageId, "img_seed");
      assert.match(selectedBody.manifest, /id: img_seed/);
      assert.match(selectedBody.manifest, /seed prompt/);

      const rejected = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentImageId: "not_in_this_session" }),
      });
      const rejectedBody = await rejected.json() as { code: string };
      assert.equal(rejected.status, 404);
      assert.equal(rejectedBody.code, "AGENT_IMAGE_NOT_FOUND");
    });
  });

  it("does not treat text-only model output as success", async () => {
    let upstreamHits = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
      upstreamHits++;
      return sseResponse([
        { type: "response.output_text.delta", delta: "This is a text-only answer." },
        { type: "response.output_text.done", text: "This is a text-only answer." },
        { type: "response.completed", response: { usage: { total_tokens: 1 } } },
      ]);
    };

    await withApp(async (baseUrl) => {
      const created = await createSession(baseUrl);
      const res = await fetch(`${baseUrl}/api/agent/sessions/${created.selectedSessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "answer in text only", provider: "api" }),
      });
      const body = await res.json() as { code: string };

      assert.equal(res.status, 422);
      assert.equal(body.code, "AGENT_TEXT_ONLY_RESULT");
      assert.equal(upstreamHits, 2);
    });
  });

  it("classifies timeout, auth, and protocol wedge errors as runtime-restartable", () => {
    const timeout = Object.assign(new Error("timed out"), { code: "RESPONSES_IMAGE_TIMEOUT" });
    const auth = Object.assign(new Error("auth failed"), { code: "AUTH_CHATGPT_EXPIRED" });
    const protocol = Object.assign(new Error("protocol wedge detected"), { code: "RESPONSES_PROTOCOL_WEDGE" });
    const validation = Object.assign(new Error("prompt required"), { code: "AGENT_PROMPT_REQUIRED" });

    assert.equal(isRuntimeRestartableError(timeout), true);
    assert.equal(isRuntimeRestartableError(auth), true);
    assert.equal(isRuntimeRestartableError(protocol), true);
    assert.equal(isRuntimeRestartableError(validation), false);
  });
});
