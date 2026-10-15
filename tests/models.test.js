// Guards on the model ids and image route we send upstream (lib/models.js).
//
// Since 2026-10-15 the default image route is the Images API (gpt-image-2):
// the Codex OAuth backend dropped gpt-5.5, and the remaining chat models
// cannot drive the Responses image_generation tool through openai-oauth
// (tools are stripped → 400 or SVG text). A default that silently flips back
// to the Responses route turns every generation into ALL_ATTEMPTS_FAILED, and
// the symptom does not point at the route — hence a test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { IMAGE_MODEL, IMAGE_API_MODEL, IMAGE_ROUTE, TEXT_MODEL } from "../lib/models.js";

// fileURLToPath, not URL.pathname — the CI matrix includes Windows, where
// pathname comes back as "/C:/...".
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function modelsUnderEnv(env) {
  const cleanEnv = { ...process.env };
  for (const k of ["IMA2_IMAGE_ROUTE", "IMA2_IMAGE_API_MODEL", "IMA2_RESPONSES_MODEL", "IMA2_TEXT_MODEL"]) {
    delete cleanEnv[k];
  }
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { IMAGE_MODEL, IMAGE_API_MODEL, IMAGE_ROUTE, TEXT_MODEL } from "./lib/models.js"; console.log(JSON.stringify({ IMAGE_MODEL, IMAGE_API_MODEL, IMAGE_ROUTE, TEXT_MODEL }));',
    ],
    { env: { ...cleanEnv, ...env }, cwd: REPO_ROOT, encoding: "utf8" },
  );
  return JSON.parse(out.trim().split("\n").pop());
}

describe("model ids", () => {
  it("defaults to the Images API route with gpt-image-2", () => {
    const d = modelsUnderEnv({});
    assert.equal(d.IMAGE_ROUTE, "images");
    assert.equal(d.IMAGE_API_MODEL, "gpt-image-2");
  });

  it("never defaults the legacy orchestrator to a model the backend dropped", () => {
    const d = modelsUnderEnv({});
    assert.ok(typeof IMAGE_MODEL === "string" && IMAGE_MODEL.length > 0);
    assert.notEqual(d.IMAGE_MODEL, "gpt-5.5", "gpt-5.5 is no longer served (2026-10-15)");
  });

  it("runs the text-only helpers on the newer line by default", () => {
    assert.ok(typeof TEXT_MODEL === "string" && TEXT_MODEL.length > 0);
    assert.ok(typeof IMAGE_API_MODEL === "string" && IMAGE_API_MODEL.length > 0);
    assert.ok(IMAGE_ROUTE === "images" || IMAGE_ROUTE === "responses");
  });

  it("honours env overrides", () => {
    const overridden = modelsUnderEnv({
      IMA2_RESPONSES_MODEL: "gpt-test-image",
      IMA2_TEXT_MODEL: "gpt-test-text",
      IMA2_IMAGE_API_MODEL: "gpt-image-test",
      IMA2_IMAGE_ROUTE: "Responses",
    });
    assert.equal(overridden.IMAGE_MODEL, "gpt-test-image");
    assert.equal(overridden.TEXT_MODEL, "gpt-test-text");
    assert.equal(overridden.IMAGE_API_MODEL, "gpt-image-test");
    assert.equal(overridden.IMAGE_ROUTE, "responses");
  });

  it("treats unknown route values as the Images API", () => {
    assert.equal(modelsUnderEnv({ IMA2_IMAGE_ROUTE: "bogus" }).IMAGE_ROUTE, "images");
  });
});
