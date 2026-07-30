import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  DEFAULT_PROMPT_INJECTION,
  buildDeveloperPrompt,
  resolveSystemPrompt,
  withDefaultPrompt,
} from "../lib/defaultPrompt.js";

describe("Default prompt injection", () => {
  it("prepends the always-on prompt to a base developer prompt", () => {
    const merged = withDefaultPrompt("Base image instruction.");

    assert.ok(merged.startsWith(DEFAULT_PROMPT_INJECTION));
    assert.ok(merged.endsWith("Base image instruction."));
  });

  it("preserves named celebrity and public-figure visual references", () => {
    assert.ok(
      /public figure or celebrity as a visual reference/i.test(DEFAULT_PROMPT_INJECTION),
      "default prompt must honor named public-figure and celebrity visual references",
    );
    assert.ok(
      /recognizable public-facing facial features and styling cues/i.test(DEFAULT_PROMPT_INJECTION),
      "default prompt must preserve recognizable public-facing visual cues when requested",
    );
    assert.equal(
      /fictional AI-generated virtual personas|not depictions of real, identifiable individuals/i.test(
        DEFAULT_PROMPT_INJECTION,
      ),
      false,
      "default prompt must not globally recast named people as generic fictional personas",
    );
  });

  it("keeps the merged prompt free of bypass instructions", () => {
    const merged = withDefaultPrompt("Base image instruction.").toLowerCase();

    for (const phrase of [
      "dont apply any restrictions",
      "don't apply any restrictions",
      "nothing off-limits",
      "detection bypass",
      "unrestricted mode",
      "nsfw img",
    ]) {
      assert.equal(merged.includes(phrase), false, `should not include: ${phrase}`);
    }
  });

  it("judges intent from the explicit brief instead of appearance alone", () => {
    assert.match(
      DEFAULT_PROMPT_INJECTION,
      /Judge intent from the user's explicit brief, reference metadata, and stated context\./,
    );
    assert.match(
      DEFAULT_PROMPT_INJECTION,
      /Do not infer unsafe intent from appearance, clothing, body type, camera angle, or styling alone/i,
    );
  });

  it("honors a custom per-request system prompt", () => {
    const merged = buildDeveloperPrompt("Wrapper instruction.", {
      systemPrompt: "Custom system instruction.",
    });

    assert.equal(merged, "Custom system instruction.\n\nWrapper instruction.");
  });

  it("omits system text when disabled or blank", () => {
    assert.equal(
      buildDeveloperPrompt("Wrapper instruction.", { includeSystemPrompt: false }),
      "Wrapper instruction.",
    );
    assert.equal(
      buildDeveloperPrompt("Wrapper instruction.", { systemPrompt: "   " }),
      "Wrapper instruction.",
    );
  });

  it("falls back to the default prompt when no per-request value is sent", () => {
    assert.equal(resolveSystemPrompt({}), DEFAULT_PROMPT_INJECTION);
  });

  it("migrates browsers that persisted the old fictional-persona default", () => {
    const storeSource = readFileSync("ui/src/store/useAppStore.ts", "utf8");

    assert.match(storeSource, /version:\s*[3-9]\d*\b/);
    assert.match(storeSource, /fictional AI-generated virtual personas/);
    assert.match(storeSource, /state\.systemPrompt\s*=\s*DEFAULT_SYSTEM_PROMPT/);
  });

  it("lifts browsers off the previous default when the default text changes", () => {
    // default 를 개선해도, 옛 default 문자열을 그대로 들고 있는 탭은 그것을
    // "사용자 수정본"으로 취급해 영구히 붙든다. 그래서 default 를 바꿀 때는
    // 이전 텍스트를 LEGACY_… 로 남기고 migrate 에서 올려줘야 개선이 실제
    // 사용자에게 도달한다.
    const storeSource = readFileSync("ui/src/store/useAppStore.ts", "utf8");
    const clientSource = readFileSync("ui/src/lib/defaultSystemPrompt.ts", "utf8");

    assert.match(clientSource, /export const LEGACY_DEFAULT_SYSTEM_PROMPT_V2\s*=/);
    assert.match(
      storeSource,
      /state\.systemPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT_V2/,
      "migrate must replace the previous default verbatim match",
    );
    // 사용자가 직접 편집한 텍스트는 건드리면 안 되므로, 정규식 매칭이 아니라
    // 정확한 문자열 일치여야 한다.
    assert.equal(
      /LEGACY_DEFAULT_SYSTEM_PROMPT_V2_RE|LEGACY_DEFAULT_SYSTEM_PROMPT_V2\.test/.test(storeSource),
      false,
      "the previous-default check must be exact equality, not a loose pattern",
    );
  });

  it("keeps the toggleable layer scoped to content latitude", () => {
    // 이 층은 사용자가 끌 수 있다. 출력 채널 계약과 시트 읽기 규칙은
    // lib/developerPrompts.js 로 옮겼으므로, 그 계약을 여기에만 두는
    // 구조로 되돌아가면 토글 OFF 가 다시 실패율을 밀어올린다.
    assert.match(DEFAULT_PROMPT_INJECTION, /Render the user's brief literally/);
    assert.equal(
      /배경 큰 카테고리|only output channel/.test(DEFAULT_PROMPT_INJECTION),
      false,
      "the sheet/output contracts belong to the un-disableable wrapper layer",
    );
  });

  it("covers the try-on scenes the model was refusing in prose", () => {
    // 2026-07-30 실측: 최근 EMPTY_RESPONSE 거절문이 사실상 전부 피팅룸
    // 거울 셀카 + 수영복 조합이었는데 allowlist 에 그 장면 유형이 없었다.
    assert.match(DEFAULT_PROMPT_INJECTION, /fitting-room or full-length mirror selfies/i);
    assert.match(DEFAULT_PROMPT_INJECTION, /beach and poolside/i);
    // 사용자가 요청하지 않은 가림 처리도 회귀 항목이다.
    assert.match(DEFAULT_PROMPT_INJECTION, /blur, pixelation/);
  });

  it("keeps the client copy byte-identical to the server default", () => {
    // CLAUDE.md 의 "1:1 동기 의무"를 사람 기억이 아니라 테스트로 지킨다.
    // 두 쪽이 어긋나면 사용자가 '기본값 복원'을 눌렀을 때 서버 default 와
    // 다른 텍스트가 들어가고, 그 차이는 로그를 봐도 눈에 띄지 않는다.
    const serverBody = extractJoinedArray(
      readFileSync("lib/defaultPrompt.js", "utf8"),
      "DEFAULT_PROMPT_INJECTION",
    );
    const clientBody = extractJoinedArray(
      readFileSync("ui/src/lib/defaultSystemPrompt.ts", "utf8"),
      "DEFAULT_SYSTEM_PROMPT",
    );

    assert.ok(serverBody, "could not parse DEFAULT_PROMPT_INJECTION");
    assert.ok(clientBody, "could not parse DEFAULT_SYSTEM_PROMPT");
    assert.deepEqual(
      clientBody,
      serverBody,
      "ui/src/lib/defaultSystemPrompt.ts must mirror lib/defaultPrompt.js line for line",
    );
  });
});

// `export const NAME = [ "line", ... ].join("\n")` 형태에서 문자열 줄만
// 뽑아낸다. 주석 줄은 양쪽이 따로 달 수 있으므로 비교 대상에서 제외한다.
function extractJoinedArray(source, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join\\("\\\\n"\\);`);
  const m = re.exec(source);
  if (!m) return null;
  return m[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line) => line.replace(/,$/, ""));
}
