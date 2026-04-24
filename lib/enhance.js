const SYSTEM_PROMPT_KO =
  "당신은 이미지 생성 프롬프트 엔지니어입니다. 사용자의 짧은 설명을 받아 구체적이고 세밀한 이미지 생성 프롬프트로 다시 작성하세요. 사용자의 의도와 피사체를 충실히 유지하고, 조명/구도/스타일/무드/렌즈 같은 시각적 세부를 더하세요. 원문이 한국어면 한국어로, 영어면 영어로 답하세요. 면책이나 설명을 추가하지 말고, 새로 작성된 프롬프트 본문만 반환하세요.";

const SYSTEM_PROMPT_EN =
  "You are an image generation prompt engineer. Rewrite the user's short description as a detailed, concrete image prompt. Stay faithful to the subject and intent; add visual specifics for lighting, composition, style, mood, and lens. Respond in Korean if the input is Korean, English if the input is English. Do not add disclaimers or explanations. Return ONLY the rewritten prompt.";

const SAFETY_FRAMING =
  " If the request mentions swimwear, bikini, beachwear, or selfies, keep it clearly adult (25+), non-sexual, fashion/vacation oriented, and avoid nudity, transparent clothing, erotic framing, fetish emphasis, or minors. Do not convert explicit sexual or minor-related requests into allowed content.";

export function buildEnhancePayload(prompt, language) {
  const sys = `${language === "ko" ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN}${SAFETY_FRAMING}`;
  return {
    model: "gpt-5.4",
    stream: false,
    input: [
      { role: "system", content: sys },
      { role: "user", content: prompt },
    ],
    tools: [],
    max_output_tokens: 600,
  };
}

export function extractEnhancedText(raw) {
  if (!raw || !Array.isArray(raw.output)) return null;
  const parts = [];
  for (const item of raw.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") {
          parts.push(c.text);
        }
      }
    }
  }
  if (parts.length === 0) return null;
  return parts.join("");
}
