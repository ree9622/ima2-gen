// Shared SSE reader for the openai-oauth /v1/responses endpoint.
// Used by both generation and edit flows in server.js.

// A single image_gen call should never take more than this long. The
// observed worst-case (high quality, 4-up, with a heavy reference) is
// ~3 minutes. 5 min gives a comfortable margin and bounds the worst-
// case batch wait. When breached we abort the fetch + the SSE reader,
// which surfaces as a normal throw out of runResponses → the caller's
// retry loop counts it as one failed attempt rather than hanging the
// chunk loop forever (production: 2026-04-30 batch stalled on attempt
// 4 streaming, no completion event, fetch matches indefinitely).
const STREAM_HARD_TIMEOUT_MS = 5 * 60 * 1000;
// Idle timeout: if no SSE data chunk arrives for this long, we treat
// the upstream as wedged and abort. Fast-fails proxy crashes that
// keep the TCP socket open without sending anything.
const STREAM_IDLE_TIMEOUT_MS = 90 * 1000;

/**
 * POST a body to the OAuth proxy /v1/responses endpoint and collect
 * the generated image (+ usage + web_search count) from either the
 * streaming SSE response or a non-stream JSON response.
 *
 * @param {object} args
 * @param {string} args.url            - OAuth proxy base URL (no trailing slash)
 * @param {object} args.body           - JSON body to POST. `stream:true/false` is up to the caller.
 * @param {(phase: string) => void} [args.onPhase] - Called with "streaming" / "decoding" etc.
 * @param {(p: { b64: string, index: number|null, eventType: string }) => void} [args.onPartialImage]
 *   - Called for each partial image event the upstream emits (e.g. when
 *     `tools[].image_generation.partial_images` was set on the request body).
 *     The callback receives the raw base64 string, no data: prefix.
 * @returns {Promise<{ b64: string|null, usage: any, webSearchCalls: number, eventCount: number, raw?: any }>}
 */
export async function runResponses({ url, body, onPhase, onPartialImage }) {
  const ac = new AbortController();
  const hardTimer = setTimeout(() => {
    ac.abort(new Error(`runResponses hard timeout after ${STREAM_HARD_TIMEOUT_MS}ms`));
  }, STREAM_HARD_TIMEOUT_MS);
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      ac.abort(new Error(`runResponses idle timeout (no data ${STREAM_IDLE_TIMEOUT_MS}ms)`));
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  const cleanup = () => {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
  };

  let res;
  try {
    armIdle();
    res = await fetch(`${url}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: body?.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    cleanup();
    // Surface the timeout reason rather than the bare AbortError.
    if (ac.signal.aborted && ac.signal.reason instanceof Error) {
      throw ac.signal.reason;
    }
    throw err;
  }

  if (!res.ok) {
    cleanup();
    const text = await res.text();
    let msg;
    try { msg = JSON.parse(text).error?.message; } catch {}
    const err = new Error(msg || `OAuth proxy returned ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream");

  if (!isSSE) {
    try {
      const json = await res.json();
      let b64 = null;
      const textParts = [];
      for (const item of (json.output || [])) {
        if (item.type === "image_generation_call" && item.result) {
          b64 = item.result;
        } else if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.type === "output_text" && typeof c.text === "string") {
              textParts.push(c.text);
            }
          }
        }
      }
      return {
        b64,
        text: textParts.length ? textParts.join("") : null,
        usage: json.usage || null,
        webSearchCalls: json.tool_usage?.web_search?.num_requests || 0,
        eventCount: 0,
        raw: json,
      };
    } finally {
      cleanup();
    }
  }

  onPhase?.("streaming");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let imageB64 = null;
  let usage = null;
  let webSearchCalls = 0;
  let eventCount = 0;
  const textParts = [];
  // Reasoning summary + refusal text — both useful for diagnosing why a
  // generation failed. The classifier's own reasoning is NEVER exposed
  // (only safety_violations=[<category>] in error messages), but:
  //   • response.reasoning_summary_text.* / output_item type:"reasoning"
  //     contains the GPT-5 model's planning step before calling the image
  //     tool. Sometimes reveals which constraint the model is wrestling with.
  //   • response.refusal.* contains the model's own refusal text when it
  //     declines the request without calling the image tool.
  const reasoningParts = [];
  const refusalParts = [];
  const eventTypeCounts = {};

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    armIdle(); // got data — reset idle window
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventData = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("data: ")) eventData += line.slice(6);
      }

      if (!eventData || eventData === "[DONE]") continue;

      try {
        const data = JSON.parse(eventData);
        eventCount++;

        // Partial image preview — upstream emits multiple of these when
        // `image_generation.partial_images` is requested. Field shape varies
        // by openai-oauth proxy version, so probe several known locations.
        if (typeof data.type === "string" && data.type.includes("partial")) {
          const item = data.item || {};
          const partialB64 =
            data.partial_image ||
            data.image ||
            data.result ||
            item.partial_image ||
            item.image ||
            item.result;
          if (typeof partialB64 === "string" && partialB64.length > 0) {
            const idx =
              Number.isFinite(data.index)
                ? data.index
                : Number.isFinite(item.index)
                  ? item.index
                  : null;
            try {
              onPartialImage?.({ b64: partialB64, index: idx, eventType: data.type });
            } catch {
              // Never let a UI handler throw kill the stream.
            }
          }
        }

        if (
          data.type === "response.output_item.done" &&
          data.item?.type === "image_generation_call" &&
          data.item.result
        ) {
          imageB64 = data.item.result;
          onPhase?.("decoding");
        }
        if (
          data.type === "response.output_item.done" &&
          data.item?.type === "web_search_call"
        ) {
          webSearchCalls += 1;
        }
        if (data.type === "response.output_text.done" && typeof data.text === "string") {
          textParts.push(data.text);
        }
        if (typeof data.type === "string") {
          eventTypeCounts[data.type] = (eventTypeCounts[data.type] || 0) + 1;
        }
        // GPT-5 reasoning summary (delta + done variants).
        if (typeof data.type === "string" && data.type.startsWith("response.reasoning")) {
          const delta = data.delta || data.text || data.summary || data.content;
          if (typeof delta === "string" && delta.length > 0) reasoningParts.push(delta);
        }
        // output_item.added/done with type:"reasoning" — alternative shape
        // some Responses API versions use for the reasoning summary block.
        if (
          (data.type === "response.output_item.added" || data.type === "response.output_item.done") &&
          data.item?.type === "reasoning"
        ) {
          const item = data.item;
          // Common shapes: item.summary[].text, item.content[].text, item.text
          if (Array.isArray(item.summary)) {
            for (const s of item.summary) {
              if (typeof s?.text === "string") reasoningParts.push(s.text);
            }
          }
          if (Array.isArray(item.content)) {
            for (const c of item.content) {
              if (typeof c?.text === "string") reasoningParts.push(c.text);
            }
          }
          if (typeof item.text === "string") reasoningParts.push(item.text);
        }
        // Model-side refusal text — emitted when the model declines without
        // calling the image_generation tool. Distinct from the upstream
        // safety_violations error.
        if (typeof data.type === "string" && data.type.startsWith("response.refusal")) {
          const delta = data.delta || data.refusal || data.text;
          if (typeof delta === "string" && delta.length > 0) refusalParts.push(delta);
        }
        if (data.type === "response.completed") {
          usage = data.response?.usage || null;
          const wsNum = data.response?.tool_usage?.web_search?.num_requests;
          if (typeof wsNum === "number" && wsNum > webSearchCalls) {
            webSearchCalls = wsNum;
          }
        }
        if (data.type === "error") {
          throw new Error(data.error?.message || JSON.stringify(data));
        }
      } catch (e) {
        // JSON.parse errors on partial payloads are ignored; bubble up everything else.
        if (e.message && !e.message.startsWith("Unexpected")) throw e;
      }
    }
  }
  } catch (err) {
    // If we aborted ourselves (timeout), surface the timeout reason.
    if (ac.signal.aborted && ac.signal.reason instanceof Error) {
      throw ac.signal.reason;
    }
    throw err;
  } finally {
    cleanup();
  }

  return {
    b64: imageB64,
    text: textParts.length ? textParts.join("") : null,
    usage,
    webSearchCalls,
    eventCount,
    reasoningSummary: reasoningParts.length ? reasoningParts.join("\n").trim() : null,
    refusalText: refusalParts.length ? refusalParts.join("\n").trim() : null,
    eventTypeCounts,
  };
}
