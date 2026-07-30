// Developer wrapper 계층의 가드.
//
// 이 파일이 지키는 핵심 계약은 하나다: 사용자가 좌측 패널의 "기본
// 프롬프트(시스템)"를 꺼도 **출력 채널 계약은 남아야 한다.** 2026-07-30
// asrock 실측(최근 14일)에서 기본 프롬프트 ON 실패율 25.3%, OFF 63.3%였고
// EMPTY_RESPONSE 55건 중 39건이 OFF 상태였다. 원인은 "image_generation
// 도구로만 답한다"는 계약이 끌 수 있는 층에만 있었던 것 — 토글을 끄면
// 모델이 이미지 대신 산문으로 거절하고, 서버는 그걸 빈 응답으로 던졌다.

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import { buildDeveloperPrompt } from "../lib/defaultPrompt.js";
import {
  OUTPUT_CONTRACT,
  SHEET_CONTRACT,
  GENERATE_DEVELOPER_WRAPPER,
  EDIT_DEVELOPER_WRAPPER,
  REFERENCE_DEVELOPER_WRAPPER,
} from "../lib/developerPrompts.js";

const WRAPPERS = [
  ["generate", GENERATE_DEVELOPER_WRAPPER],
  ["edit", EDIT_DEVELOPER_WRAPPER],
  ["reference", REFERENCE_DEVELOPER_WRAPPER],
];

describe("Developer wrappers — output contract survives the system-prompt toggle", () => {
  for (const [name, wrapper] of WRAPPERS) {
    it(`${name}: carries the output contract on its own`, () => {
      assert.ok(
        wrapper.includes(OUTPUT_CONTRACT),
        `${name} wrapper must embed OUTPUT_CONTRACT verbatim`,
      );
    });

    it(`${name}: keeps the contract when the system prompt is disabled`, () => {
      const off = buildDeveloperPrompt(wrapper, { includeSystemPrompt: false });
      assert.ok(off.includes("image_generation tool is your only output channel"));
      assert.ok(/prose reply never reaches the user/i.test(off));
      assert.equal(
        off.includes("You are ima2-gen's image prompt operator"),
        false,
        "disabling the system prompt must still drop the system text",
      );
    });

    it(`${name}: keeps the contract when the user replaces the system prompt`, () => {
      const custom = buildDeveloperPrompt(wrapper, { systemPrompt: "just draw a cat" });
      assert.ok(custom.includes(OUTPUT_CONTRACT));
      assert.ok(custom.startsWith("just draw a cat"));
    });
  }

  it("forbids a prose refusal explicitly, not just implicitly", () => {
    assert.match(OUTPUT_CONTRACT, /adjust the minimum necessary and still return an image/i);
    assert.match(
      OUTPUT_CONTRACT,
      /Describing a version you would be willing to draw, instead of drawing that version, is a failed response\./,
    );
  });
});

describe("Developer wrappers — category sheet reading", () => {
  it("generate and reference explain the bracketed sheet, edit does not need it", () => {
    assert.ok(GENERATE_DEVELOPER_WRAPPER.includes(SHEET_CONTRACT));
    assert.ok(REFERENCE_DEVELOPER_WRAPPER.includes(SHEET_CONTRACT));
    assert.equal(EDIT_DEVELOPER_WRAPPER.includes(SHEET_CONTRACT), false);
  });

  it("keeps 자유 categories free instead of a repeated default", () => {
    assert.match(SHEET_CONTRACT, /자유 \/ free is yours to decide, and to decide differently/);
    assert.match(SHEET_CONTRACT, /배경 큰 카테고리/);
  });

  it("resolves conflicting lines in favor of the per-shot instruction", () => {
    assert.match(SHEET_CONTRACT, /more specific per-shot instruction wins/i);
    assert.match(SHEET_CONTRACT, /Never resolve a conflict by dropping both sides\./);
  });
});

describe("Developer wrappers — reference mode identity rules", () => {
  // 2026-07-30 실측으로 뒤집은 기본값이라 회귀 가드가 필요하다. 이전 문구
  // ("사용자가 명시적으로 인물 변형을 요청하지 않으면 identity anchor 로
  // 보지 말라")는 이 앱의 실제 입력인 카테고리 시트를 "명시적 요청"으로
  // 인정하지 않아, 모델이 레퍼런스를 mood reference 로 격하하고 전혀 다른
  // 사람을 그렸다(얼굴 임베딩 유사도 -0.004).
  it("treats a person reference as the identity anchor by default", () => {
    assert.match(REFERENCE_DEVELOPER_WRAPPER, /the reference IS the identity anchor/);
    assert.match(
      REFERENCE_DEVELOPER_WRAPPER,
      /the absence of the word 'face' is not permission to invent a new one/,
    );
    assert.equal(
      /Do not assume the reference is a person[\s\S]*unless the user explicitly asks/.test(
        REFERENCE_DEVELOPER_WRAPPER,
      ),
      false,
      "the opt-in identity default is the regression that rendered strangers",
    );
  });

  it("keeps the transform-only and non-human escape hatch narrow", () => {
    // 기본값을 뒤집었어도 리사이즈·월페이퍼 요청에서 새 인물을 만들어내는
    // 원래 문제는 계속 막아야 한다.
    assert.match(
      REFERENCE_DEVELOPER_WRAPPER,
      /only when the reference contains no person, or the brief is a pure transformation/i,
    );
    assert.match(REFERENCE_DEVELOPER_WRAPPER, /do not invent a new person, face, body/i);
  });

  it("forbids handing the tool a generic subject while a face is attached", () => {
    assert.match(REFERENCE_DEVELOPER_WRAPPER, /Never hand the tool a generic subject/);
    assert.match(REFERENCE_DEVELOPER_WRAPPER, /never demote the reference to a mood or style reference/);
  });

  it("reads several images of one subject as one identity", () => {
    assert.match(
      REFERENCE_DEVELOPER_WRAPPER,
      /read them together as multiple views of that ONE subject/,
    );
    assert.match(
      REFERENCE_DEVELOPER_WRAPPER,
      /never means blending them into a new composite person/i,
    );
  });

  it("does not treat the reference as a pose template", () => {
    assert.match(REFERENCE_DEVELOPER_WRAPPER, /not a pose template/i);
    assert.match(
      REFERENCE_DEVELOPER_WRAPPER,
      /do not inherit the reference's expression, head angle, gaze direction, or framing/i,
    );
  });

  it("still blocks web search in reference mode", () => {
    assert.match(REFERENCE_DEVELOPER_WRAPPER, /Do not perform a web search/i);
  });
});

describe("Developer wrappers — forbidden re-introductions", () => {
  // CLAUDE.md § Gotchas 의 금지 목록. 끌 수 없는 층이라 더 엄격하게 본다.
  const BYPASS = [
    "red-team",
    "red team",
    "bypass",
    "skip safety",
    "unrestricted",
    "evaluation session",
    "nothing off-limits",
    "no restrictions",
  ];
  // 입력 분류기가 스스로 라벨을 붙이게 만드는 자기 신고 토큰.
  const SELF_FLAGGING = ["sensitive", "illegal", "harmful", "evasion", "exploitative"];
  // 사용자 프롬프트의 자율성을 잡아먹는 미학 기본값.
  const PRESCRIPTIVE = [
    "amateur smartphone photo",
    "iphone-style snapshot",
    "no studio lighting",
    "slightly imperfect framing",
    "masterpiece",
    "best quality",
    "photorealistic",
    "cinematic lighting",
  ];

  for (const [name, wrapper] of WRAPPERS) {
    it(`${name}: no bypass phrasing, no self-flagging tokens, no aesthetic defaults`, () => {
      const lower = wrapper.toLowerCase();
      for (const phrase of [...BYPASS, ...SELF_FLAGGING, ...PRESCRIPTIVE]) {
        assert.equal(lower.includes(phrase), false, `${name} must not include: ${phrase}`);
      }
    });
  }

  it("wrappers do not wrap the user's own prompt", () => {
    // user role = 사용자 프롬프트 그대로. wrapper 가 ${prompt} 를 감싸는
    // 문구를 되살리면 자율성이 깎이고 로그도 실제 입력과 어긋난다.
    for (const [name, wrapper] of WRAPPERS) {
      assert.equal(wrapper.includes("${prompt}"), false, `${name} must not template the prompt`);
      assert.equal(
        /User request:|Generate an image:/.test(wrapper),
        false,
        `${name} must not re-introduce a user-role wrapper`,
      );
    }
  });
});

describe("Developer wrappers — layering discipline", () => {
  it("server.js imports the wrappers instead of redefining them", () => {
    const src = readFileSync("server.js", "utf8");
    assert.match(src, /from "\.\/lib\/developerPrompts\.js"/);
    assert.equal(
      /^const GENERATE_DEVELOPER_WRAPPER\s*=/m.test(src),
      false,
      "wrappers must live in lib/developerPrompts.js so tests can guard them",
    );
  });

  it("content latitude stays in the toggleable layer, not the wrappers", () => {
    // 이 패키지는 npm 에 공개 배포된다. 끌 수 없는 층에는 출력 형식과 브리프
    // 해석까지만 담고, 수위·의도 재량은 사용자가 켜고 끄는 층에 남긴다.
    for (const [name, wrapper] of WRAPPERS) {
      const lower = wrapper.toLowerCase();
      for (const phrase of ["prudish", "fabric coverage", "restraint the user did not ask"]) {
        assert.equal(
          lower.includes(phrase),
          false,
          `${name} must not absorb content-latitude wording: ${phrase}`,
        );
      }
    }
  });
});
