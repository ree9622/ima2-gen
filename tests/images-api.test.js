// Contract tests for lib/imagesApi.js against a fake fetch. The request
// shapes mirror what openai-oauth 2.0.0 accepts (see the module header); the
// live proxy was probed on 2026-10-15 with the same shapes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  runImagesApi,
  composeImagesPrompt,
  normalizeImagesParams,
  stripToolOnlyGuidance,
} from "../lib/imagesApi.js";

const PNG_B64 = (await sharp({
  create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
}).png().toBuffer()).toString("base64");

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body } = await responder(url, init);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-codex-account": "acct-1" },
    });
  };
  fn.calls = calls;
  return fn;
}

const OK_BODY = {
  created: 1,
  background: "opaque",
  output_format: "png",
  quality: "low",
  size: "1254x1254",
  data: [{ b64_json: PNG_B64, generation_id: "gen_1" }],
  usage: { input_tokens: 17, output_tokens: 515, total_tokens: 532 },
};

describe("runImagesApi", () => {
  it("posts JSON to /v1/images/generations without proxy-rejected params", async () => {
    const f = fakeFetch(() => ({ body: OK_BODY }));
    const r = await runImagesApi({
      url: "http://proxy",
      model: "gpt-image-2",
      prompt: "apple",
      quality: "low",
      size: "1024x1536",
      background: "auto",
      outputFormat: "png",
      fetchImpl: f,
    });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, "http://proxy/v1/images/generations");
    const sent = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(Object.keys(sent).sort(), ["background", "model", "n", "prompt", "quality", "size"]);
    for (const k of ["moderation", "output_format", "output_compression", "partial_images", "stream"]) {
      assert.equal(sent[k], undefined, `${k} must not be sent`);
    }
    assert.equal(r.b64, PNG_B64);
    assert.equal(r.generationId, "gen_1");
    assert.equal(r.codexAccount, "acct-1");
    assert.equal(r.effectiveImage.model, "gpt-image-2");
    assert.equal(r.effectiveImage.size, "1254x1254");
    assert.deepEqual(r.usage, OK_BODY.usage);
  });

  it("sends references as multipart image[] to /v1/images/edits", async () => {
    const f = fakeFetch(() => ({ body: OK_BODY }));
    await runImagesApi({
      url: "http://proxy",
      model: "gpt-image-2",
      prompt: "logo on mug",
      quality: "medium",
      size: "1456x1024",
      references: [PNG_B64, PNG_B64],
      fetchImpl: f,
    });
    assert.equal(f.calls[0].url, "http://proxy/v1/images/edits");
    const fd = f.calls[0].init.body;
    assert.ok(fd instanceof FormData);
    assert.equal(fd.getAll("image[]").length, 2);
    assert.equal(fd.get("model"), "gpt-image-2");
    assert.equal(fd.get("prompt"), "logo on mug");
    assert.equal(fd.get("quality"), "medium");
    assert.equal(fd.get("mask"), null);
    assert.equal(fd.get("moderation"), null);
    const file = fd.getAll("image[]")[0];
    assert.equal(file.type, "image/png");
  });

  it("rejects more than 5 references before calling upstream", async () => {
    const f = fakeFetch(() => ({ body: OK_BODY }));
    await assert.rejects(
      runImagesApi({ url: "http://p", model: "m", prompt: "x", references: Array(6).fill(PNG_B64), fetchImpl: f }),
      (e) => e.code === "REF_TOO_MANY" && e.status === 400,
    );
    assert.equal(f.calls.length, 0);
  });

  it("transcodes PNG to the requested jpeg/webp so extension matches bytes", async () => {
    const f = fakeFetch(() => ({ body: OK_BODY }));
    const r = await runImagesApi({
      url: "http://p", model: "m", prompt: "x", outputFormat: "webp", compression: 80, fetchImpl: f,
    });
    const head = Buffer.from(r.b64, "base64");
    assert.equal(head.toString("ascii", 8, 12), "WEBP");
    assert.equal(r.effectiveImage.outputFormat, "webp");
    assert.equal(r.effectiveImage.transcoded, true);
    const j = await runImagesApi({ url: "http://p", model: "m", prompt: "x", outputFormat: "jpeg", fetchImpl: f });
    const jb = Buffer.from(j.b64, "base64");
    assert.equal(jb[0], 0xff);
    assert.equal(jb[1], 0xd8);
  });

  it("throws upstream errors with status and message (safety classification input)", async () => {
    const f = fakeFetch(() => ({
      status: 400,
      body: { error: { message: "Your request was rejected by the safety system. safety_violations=[sexual]", code: "moderation_blocked" } },
    }));
    await assert.rejects(
      runImagesApi({ url: "http://p", model: "m", prompt: "x", fetchImpl: f }),
      (e) => e.status === 400 && /safety_violations=\[sexual\]/.test(e.message) && e.upstreamCode === "moderation_blocked",
    );
  });

  it("returns b64:null when upstream answers without image data", async () => {
    const f = fakeFetch(() => ({ body: { ...OK_BODY, data: [] } }));
    const r = await runImagesApi({ url: "http://p", model: "m", prompt: "x", fetchImpl: f });
    assert.equal(r.b64, null);
  });

  it("honours an already-aborted signal", async () => {
    const f = fakeFetch(() => ({ body: OK_BODY }));
    const ac = new AbortController();
    ac.abort("user canceled");
    await assert.rejects(runImagesApi({ url: "http://p", model: "m", prompt: "x", signal: ac.signal, fetchImpl: f }));
    assert.equal(f.calls.length, 0);
  });
});

describe("prompt + param helpers", () => {
  it("drops values the proxy would reject", () => {
    assert.deepEqual(normalizeImagesParams({ quality: "ultra", size: "big", background: "none" }), {
      quality: undefined, size: undefined, background: undefined,
    });
    assert.deepEqual(normalizeImagesParams({ quality: "HIGH", size: "1824x1024", background: "transparent" }), {
      quality: "high", size: "1824x1024", background: "transparent",
    });
  });

  it("strips tool-only lines but keeps rendering guidance", () => {
    const out = stripToolOnlyGuidance(
      "Output contract: the image_generation tool is your only output channel.\nAvoid technical defects.\nDo not perform a web search; refs are truth.",
    );
    assert.equal(out, "Avoid technical defects.");
  });

  it("keeps the user prompt first and intact", () => {
    const p = composeImagesPrompt({ userPrompt: "USER BRIEF", wrapper: "Avoid defects.", systemPrompt: "Be literal." });
    assert.ok(p.startsWith("USER BRIEF"));
    assert.match(p, /Be literal\./);
    assert.match(p, /Avoid defects\./);
    assert.equal(composeImagesPrompt({ userPrompt: "only" }), "only");
  });
});
