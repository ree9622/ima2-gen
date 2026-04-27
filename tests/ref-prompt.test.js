import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boostRefPrompt, shouldBoostRefPrompt } from "../lib/refPrompt.js";

describe("reference-mode prompt boosting", () => {
  it("appends Korean face-lock cue to short Korean prompts", () => {
    const out = boostRefPrompt("다른 자세");
    assert.match(out, /다른 자세/);
    assert.match(out, /얼굴은 레퍼런스 이미지와 100% 동일/);
    assert.match(out, /다시 그리거나 스타일라이즈하지 말 것/);
  });

  it("appends English face-lock cue to short English prompts", () => {
    const out = boostRefPrompt("different pose");
    assert.match(out, /different pose/);
    assert.match(out, /Keep the face IDENTICAL/);
    assert.match(out, /Do not redraw or stylize/);
  });

  it("boosts variation commands even when not short", () => {
    const longButVariation =
      "송도 트리플스트리트 자라 매장 앞에서 커피 들고 인스타그램용 셀카, 비키니로 변경, 자연스러운 자세로";
    assert.equal(shouldBoostRefPrompt(longButVariation), true);
    const out = boostRefPrompt(longButVariation);
    assert.match(out, /얼굴은 레퍼런스/);
  });

  it("does not boost long descriptive prompts that already lock the face", () => {
    const explicit =
      "한국 카페에서 커피 들고 셀카, 얼굴은 동일하게 유지, 같은 사람, 다른 자세";
    assert.equal(shouldBoostRefPrompt(explicit), false);
    assert.equal(boostRefPrompt(explicit), explicit);
  });

  it("does not boost long non-variation prompts (no signal)", () => {
    const long =
      "한국 강남역 사거리에서 정면을 보고 서 있는 모습. 점심 시간 분위기, 행인 약간 보임, 전반적으로 자연스러운 일상 사진 느낌";
    // long + no variation hint + no face-lock — caller wants the user prompt verbatim.
    assert.equal(shouldBoostRefPrompt(long), false);
  });

  it("handles edit-style commands ('비키니로 변경', '카페에서')", () => {
    assert.match(boostRefPrompt("비키니로 변경"), /얼굴은 레퍼런스/);
    assert.match(boostRefPrompt("카페에서"), /얼굴은 레퍼런스/);
    assert.match(boostRefPrompt("change outfit to casual jeans"), /Keep the face IDENTICAL/);
  });

  it("returns the prompt unchanged for empty/non-string input", () => {
    assert.equal(boostRefPrompt(""), "");
    assert.equal(boostRefPrompt(null), null);
    assert.equal(boostRefPrompt(undefined), undefined);
  });
});
