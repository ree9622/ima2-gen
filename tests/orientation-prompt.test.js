import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOrientationDirective,
  buildOrientationDirective,
} from "../lib/orientationPrompt.js";

test("orientation directive is omitted for auto or missing sizes", () => {
  assert.equal(buildOrientationDirective("auto"), "");
  assert.equal(buildOrientationDirective(""), "");
  assert.equal(buildOrientationDirective(null), "");
  assert.equal(applyOrientationDirective("고양이", "auto"), "고양이");
});

test("orientation directive reinforces landscape, portrait, and square sizes", () => {
  assert.match(buildOrientationDirective("1536x1024"), /WIDE horizontal LANDSCAPE/);
  assert.match(buildOrientationDirective("1024x1536"), /TALL vertical PORTRAIT/);
  assert.match(buildOrientationDirective("1024x1024"), /SQUARE 1:1/);
});

test("orientation directive preserves the original prompt verbatim after the prefix", () => {
  const prompt = "첫 줄\n둘째 줄";
  const result = applyOrientationDirective(prompt, "1824x1024");
  assert.match(result, /^You MUST generate this image at exactly 1824x1024 resolution/);
  assert.ok(result.endsWith(prompt));
});
