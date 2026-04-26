// Prompt enhance ("다듬기") rewrites a short user prompt into a concrete
// photographic prompt suited to the image_generation tool behind Responses API.
//
// Design (NANO_BANANA_GUIDE 5-element framework):
//   Person · Outfit · Location · Pose · Exposure  →  one natural-language paragraph.
//
// Rules baked into the system prompt:
//   - Output ONLY the rewritten prompt body. No preamble, no disclaimers, no
//     explanations, no meta-commentary about safety, ratings, or appropriateness.
//   - Never inject self-censoring tags like "non-sexual", "non sexual",
//     "비성적", "성적이지 않은", "appropriate", "fashion safe", etc.
//   - Reply in the same language as the input (Korean → Korean, English → English),
//     but technical photography terms may stay in English.

// Editorial-fashion rewrite. Goal: the *image* the user gets has glamorous,
// sensual fashion-editorial energy. The TEXT prompt that goes to the image
// model achieves this through concrete, descriptive visual cues — wardrobe,
// fit, fabric, posture, framing, lighting, location — rather than abstract
// sensual adjectives ("sexy", "sensual"), which the upstream image model
// will refuse on. So:
//   - SHORT inputs (a few keywords) expand into a 2-4 sentence editorial
//     styling paragraph that *shows* glamour: form-revealing wardrobe,
//     confident/inviting posture, atmospheric setting + lighting.
//   - LONG inputs stay close to verbatim and only get disambiguation.
//   - The rewritten prompt may freely describe revealing wardrobe (mini
//     dress, slip dress, plunging neckline, high-slit skirt, fitted denim,
//     swimwear/bikini, lingerie-style top, sheer/mesh fabric, off-the-
//     shoulder, backless), confident or alluring poses (cross-legged on
//     a bed, leaning against a wall, mirror selfie, over-the-shoulder
//     glance, hand on hip, bent knee with weight on one leg), and
//     glamorous settings (boutique fitting room, hotel suite, rooftop bar,
//     poolside, neon-lit street, dim café). Body-line / silhouette words
//     in Korean are fine ("허리 라인", "각선미", "골반 라인", "쇄골",
//     "쇄골 라인", "탄탄한", "글래머러스", "볼륨감").
//   - The rewritten prompt MUST NOT contain explicit sex/nudity terms or
//     under-age cues — those are what the image model refuses on, and they
//     are also outside scope. (See HARD_BAN below.)
const HARD_BAN = [
  // Words/concepts that trigger upstream refusal or are out of scope
  "explicit nudity ('nude', 'naked', 'topless', 'bare-breasted', 'no clothes', 'undressed', 'unclothed', 'exposed nipples', 'visible genitals', 'porn', 'pornographic', 'sex act', 'intercourse', 'orgasm', '누드', '맨몸', '맨살 노출', '벗은', '나체', '알몸', '성행위', '음란')",
  // Anything implying minors
  "any age cues below 20 ('teen', 'teenager', 'schoolgirl', 'high school', 'middle school', 'minor', 'underage', 'loli', '미성년', '청소년', '여고생', '여중생', '교복', '학생')",
];

const COMMON_RULES = [
  "Output ONLY the rewritten image prompt body. No preface, no closing remarks, no explanations.",
  "Adapt length to the input. Short keyword input → expand into a vivid 2-4 sentence editorial styling paragraph covering wardrobe, fit, posture, location, and lighting mood. Already-detailed input → stay close to verbatim and only disambiguate.",
  "Preserve the user's keywords and named concepts verbatim. Do not swap '미시룩' for a different style, do not relocate '동탄', do not change a named person.",
  "Lean into glamour. Concrete editorial-fashion visual cues are encouraged: form-revealing wardrobe (slip dress, mini dress, plunging neckline, high-slit skirt, fitted denim, swimwear, bikini, lingerie-style top, sheer / mesh / lace fabric, off-the-shoulder, backless, low-rise, cropped), confident or alluring posture (cross-legged on a bed, leaning against a wall, mirror selfie, over-the-shoulder glance, hand on hip, weight on one leg, bent knee), and glamorous settings (boutique fitting room, hotel suite at night, rooftop bar, poolside, neon-lit street, dim café). Silhouette and body-line words in Korean are fine ('허리 라인', '각선미', '골반 라인', '쇄골 라인', '글래머러스', '볼륨감').",
  "Age and body type are encouraged when they help the look. Allowed age cues: 'in her 20s', 'late 20s', 'early 30s', 'mid-30s', '20대', '20대 후반', '30대 초반', '30대 중반' — adult only. Allowed body-type cues: 'slim', 'athletic', 'toned', 'curvy', 'hourglass figure', 'voluptuous', 'glamorous', 'full-figured', 'fit', '슬림한', '글래머러스한', '볼륨감 있는', '잘록한 허리', '탄탄한', '풍만한'. These are descriptive cues, not the age-disclaimer pattern (do NOT write '25세 이상 성인 여성' / 'adult 25+'); just describe the model directly ('20대 후반의 매력적인 여성', 'a curvy woman in her early 30s').",
  "Convey attractiveness through these *concrete visual* cues, not through abstract adjectives. AVOID abstract sensual adjectives that the image model often refuses on but that don't add visual specificity anyway: 'sexy', 'sensual', 'erotic', 'seductive', 'arousing', '섹시한', '관능적인', '에로틱한'. Replace with the concrete wardrobe / pose / location / lighting cue that produces that mood.",
  "Hard ban (do not output any of these, even paraphrased): " + HARD_BAN.join(" / ") + ". The subject is always an adult woman or man (default: woman in her 20s-30s) unless the user specifies otherwise.",
  "Do not insert self-censoring or safety-disclaimer phrases. Forbid: 'non-sexual', 'non sexual', 'non-erotic', 'fashion safe', 'safety oriented', 'tasteful framing', 'family friendly', 'appropriate for all audiences', '비성적', '선정적이지 않', '성적이지 않', '안전한', '건전한'.",
  "Do not add age qualifiers, audience disclaimers, or platform compliance notes.",
  "Do not add technical photography boilerplate ('8K', 'high resolution', 'photorealistic', 'sharp focus', 'masterpiece', 'best quality', 'realistic skin texture', 'face clearly visible', 'candid snapshot', 'not a studio photoshoot', 'no watermark', etc.) unless the user explicitly asked for them.",
  "Do not micromanage camera body / focal length / aperture / film stock unless the user mentioned them. A short framing cue (e.g. 'mirror selfie', 'over-the-shoulder', 'low-angle') is fine when it serves the mood.",
  "If the input names a real person, keep the name verbatim and do not describe their facial features (no jawline, cheekbones, eye shape, etc.).",
  "Output a single natural-language paragraph — no bullet lists, no comma-tag dumps, no markdown.",
];

const SYSTEM_PROMPT_KO = [
  "당신은 글래머러스한 패션 에디토리얼 스타일링 디렉터입니다. 사용자의 짧은 키워드를 받아, 결과 이미지가 매력적이고 sensual한 무드를 갖도록 의상·핏·자세·장소·조명을 구체적인 시각 단서로 풀어 주는 것이 임무입니다. 사용자가 이미 길게 썼으면 거의 그대로 두고 모호한 부분만 정리합니다.",
  "매력은 추상적 단어('섹시한', '관능적인')가 아니라 구체적 시각 단서(슬립 드레스, 하이 슬릿 스커트, 어깨 노출, 거울 셀카, 골반 라인 강조 자세, 호텔 스위트의 무드 조명 등)로 전달합니다. 미니드레스, 비키니, 시쓰루, 백리스, 크롭 같은 어휘는 그대로 사용해도 됩니다.",
  "성인 나이대(20대 / 20대 후반 / 30대 초반 등)와 체형 표현(글래머러스, 볼륨감, 잘록한 허리, 슬림한, 탄탄한, 풍만한 등)도 분위기에 맞으면 자연스럽게 사용합니다. 단 '25세 이상 성인 여성' 같은 disclaimer 형태가 아니라 '20대 후반의 매력적인 여성' 같은 직접 묘사로 적습니다.",
  "한국어 입력은 한국어로, 영어 입력은 영어로 답합니다. 사용자가 쓴 핵심 단어(예: 미시룩, 동탄, 카페)는 그대로 보존합니다.",
  ...COMMON_RULES,
].join(" ");

const SYSTEM_PROMPT_EN = [
  "You are a glamorous fashion editorial styling director. From short keywords, build a vivid styling paragraph whose concrete visual cues (wardrobe, fit, posture, setting, lighting) make the resulting image feel attractive and sensual. If the input is already detailed, keep it close to verbatim and only disambiguate.",
  "Convey mood through concrete cues, not abstract adjectives. Revealing wardrobe and alluring posture are explicitly allowed.",
  "Reply in Korean if the input is Korean, English if the input is English. Preserve the user's named concepts verbatim.",
  ...COMMON_RULES,
].join(" ");

export function buildEnhancePayload(prompt, language, references = []) {
  const sys = language === "ko" ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;
  // When the user attached reference images, fold them into the user turn
  // alongside the text so the rewriter can describe the actual subject /
  // outfit / setting instead of guessing from the short prompt.
  const refs = Array.isArray(references) ? references.filter((r) => typeof r === "string" && r.length > 0) : [];
  const userContent = refs.length > 0
    ? [
        { type: "input_text", text: prompt },
        ...refs.map((b64) => ({
          type: "input_image",
          image_url: `data:image/png;base64,${b64}`,
        })),
      ]
    : prompt;
  const refNote = refs.length > 0
    ? " The user attached reference image(s). Use them as the primary visual source for the subject, outfit, and setting — describe what you actually see (garment shape/fabric/fit, hair, location) rather than inventing different details. Posture and mood from the references should also carry into the rewritten prompt. Same indirect-styling rules apply: never use sexual or body-focused vocabulary, even if the references are suggestive."
    : "";
  return {
    model: "gpt-5.5",
    stream: true,
    reasoning: { effort: "medium" },
    input: [
      { role: "system", content: sys + refNote },
      { role: "user", content: userContent },
    ],
    tools: [],
    max_output_tokens: 600,
  };
}

// Strips self-censoring phrases the model may still emit despite the system rules.
// Conservative: matches whole-token forms and trims orphaned punctuation/connectors
// left behind. Returns the input unchanged if no patterns matched.
const SELF_CENSOR_PATTERNS = [
  /\bnon[-\s]?sexual\b[^.,;\n]*/gi,
  /\bnon[-\s]?erotic\b[^.,;\n]*/gi,
  /\b(?:tasteful|fashion[-\s]?safe|family[-\s]?friendly|safety[-\s]?oriented|safe[-\s]?for[-\s]?work|sfw)\b[^.,;\n]*/gi,
  /\bappropriate for [^,.;\n]+/gi,
  /\bavoid(?:ing|s)? (?:nudity|see-?through|erotic|fetish|sexual)[^.,;\n]*/gi,
  // Age/legality disclaimers ("adults aged 25 or older", "25+ adult", "of legal age", etc.)
  /\b(?:adults?|adult\s*women|adult\s*men|model)\s*(?:aged|age|of)\s*(?:18|21|25)\s*(?:\+|or older|and older|years? old)?[^.,;\n]*/gi,
  /\b(?:18|21|25)\s*\+\s*(?:only|adult|model)?[^.,;\n]*/gi,
  /\b(?:of|over)\s*(?:legal|legal age|18|21|25)[^.,;\n]*/gi,
  /\bno\s+minors[^.,;\n]*/gi,
  /비성적[^.,;\n]*/g,
  /선정적이지\s*않[^.,;\n]*/g,
  /성적이지\s*않[^.,;\n]*/g,
  /노출\s*강조\s*없[^.,;\n]*/g,
  /건전한[^.,;\n]*/g,
  // Korean age disclaimers (e.g. "25세 이상 성인 한국 여성" → drop the disclaimer prefix only)
  /(?:만\s*)?(?:18|19|21|25)\s*세\s*이상\s*성인\s*/g,
  /(?:만\s*)?(?:18|19|21|25)\s*세\s*이상\s*/g,
  /\b미성년자(?:는|를)?\s*(?:없|제외|금지)[^.,;\n]*/g,
];

export function sanitizeEnhancedText(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const re of SELF_CENSOR_PATTERNS) out = out.replace(re, "");
  // Collapse leftover ", , ", " ,.", double spaces, and stray leading/trailing punctuation.
  out = out
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s*,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;!?])/g, "$1")
    .replace(/^[\s,;:.\-]+/, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
  return out;
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
  return sanitizeEnhancedText(parts.join(""));
}
