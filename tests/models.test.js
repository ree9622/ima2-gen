// Guards on the model ids we send upstream (lib/models.js).
//
// The important one is the IMAGE_MODEL pin: the Codex OAuth backend
// advertises gpt-5.6-* via /v1/models and they answer plain text fine, but
// they drop the `image_generation` tool and the request then fails with
// "Tool choice 'required' must be specified with 'tools' parameter."
// Measured 2026-08-03 against the live proxy. Bumping that constant to a 5.6
// id turns every generation into UPSTREAM_EMPTY, and the symptom does not
// point at the model — hence a test rather than a comment alone.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IMAGE_MODEL, TEXT_MODEL } from "../lib/models.js";

// fileURLToPath, not URL.pathname — the CI matrix includes Windows, where
// pathname comes back as "/C:/...".
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function modelsUnderEnv(env) {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { IMAGE_MODEL, TEXT_MODEL } from "./lib/models.js"; console.log(JSON.stringify({ IMAGE_MODEL, TEXT_MODEL }));',
    ],
    { env: { ...process.env, ...env }, cwd: REPO_ROOT, encoding: "utf8" },
  );
  return JSON.parse(out.trim().split("\n").pop());
}

describe("model ids", () => {
  it("pins the image orchestrator off the 5.6 line (no image_generation tool support)", () => {
    assert.ok(typeof IMAGE_MODEL === "string" && IMAGE_MODEL.length > 0);
    assert.doesNotMatch(
      IMAGE_MODEL,
      /^gpt-5\.6/,
      "gpt-5.6-* cannot carry the image_generation tool — see lib/models.js",
    );
  });

  it("runs the text-only helpers on the newer line by default", () => {
    assert.ok(typeof TEXT_MODEL === "string" && TEXT_MODEL.length > 0);
  });

  it("honours env overrides", () => {
    const overridden = modelsUnderEnv({
      IMA2_RESPONSES_MODEL: "gpt-test-image",
      IMA2_TEXT_MODEL: "gpt-test-text",
    });
    assert.equal(overridden.IMAGE_MODEL, "gpt-test-image");
    assert.equal(overridden.TEXT_MODEL, "gpt-test-text");
  });
});
