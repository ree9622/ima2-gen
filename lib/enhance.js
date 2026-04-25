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

// Style rewrite. The previous "light touch" pass was too minimal — short
// inputs like "동탄 미시룩 여자" stayed under-specified and the model produced
// generic results. Goal of this pass:
//   - SHORT inputs (<= ~30 chars / a few words): expand into a vivid 2-4
//     sentence styling paragraph that fills in outfit, setting, mood, and
//     flattering posture using indirect styling cues.
//   - LONG inputs (already detailed): preserve verbatim, only disambiguate.
//   - Never add technical photography boilerplate (8K, candid, no watermark
//     …) — the image model has its own defaults.
//   - Never use explicit body / sexual vocabulary. Convey appeal through
//     wardrobe fit, fabric, silhouette, posture, environment, and lighting
//     mood — not through sensual adjectives.
const COMMON_RULES = [
  "Output ONLY the rewritten image prompt body. No preface, no closing remarks, no explanations.",
  "Adapt length to the input. If the user gave you only a few keywords, expand into a vivid styling paragraph (2-4 sentences) covering outfit, setting, mood, and posture. If the user already wrote a detailed prompt, keep it close to verbatim and only disambiguate.",
  "Preserve the user's keywords and named concepts. Do not swap '미시룩' for a different style, do not move 'Dongtan' to another city, do not invent a different person.",
  "Convey attractiveness through indirect styling cues — describe garment fit (tailored, form-fitting, slim-cut, draped), fabric (silk, satin, knit, denim), silhouette (waist line, hemline, neckline shape), posture (confident stance, relaxed lean, mid-stride, hand on hip), and atmosphere (golden hour, soft window light, café ambience, evening street). NEVER use direct sexual or body-focused vocabulary: forbidden words include 'sexy', 'sexual', 'sensual', 'erotic', 'voluptuous', 'curvy', 'busty', 'cleavage', 'bust', 'breast', 'thigh', 'butt', 'rear', 'hip-revealing', '섹시', '관능', '몸매', '글래머', '볼륨감', '가슴', '엉덩이', '허벅지', '노출'. Convey the same mood through wardrobe + posture + light instead.",
  "Do not insert self-censoring or safety-disclaimer phrases. Forbid: 'non-sexual', 'non sexual', 'non-erotic', 'fashion safe', 'safety oriented', 'tasteful framing', 'family friendly', 'appropriate for all audiences', '비성적', '선정적이지 않', '성적이지 않', '안전한', '건전한'.",
  "Do not add age qualifiers, audience disclaimers, or platform compliance notes.",
  "Do not add technical photography boilerplate ('8K', 'high resolution', 'photorealistic', 'sharp focus', 'masterpiece', 'best quality', 'realistic skin texture', 'face clearly visible', 'candid snapshot', 'not a studio photoshoot', 'no watermark', etc.) unless the user explicitly asked for them.",
  "Do not micromanage camera body / focal length / aperture / film stock unless the user mentioned them.",
  "If the input names a real person, keep the name verbatim and do not describe their facial features (no jawline, cheekbones, eye shape, etc.).",
  "Output a single natural-language paragraph — no bullet lists, no comma-tag dumps, no markdown.",
];

const SYSTEM_PROMPT_KO = [
  "당신은 이미지 생성 프롬프트 작가입니다. 사용자가 짧은 키워드만 줬을 때는 의상·장소·분위기·자세를 자연스럽게 보강해 시각적으로 풍부한 단락으로 만듭니다. 사용자가 이미 자세히 썼으면 거의 그대로 두고 모호한 부분만 정리합니다.",
  "매력은 직접적인 표현(섹시·관능·몸매·노출 등) 대신 의상의 핏과 소재, 실루엣, 자세, 조명·장소의 무드 같은 간접적 시각 단서로 전달합니다.",
  "한국어 입력은 한국어로, 영어 입력은 영어로 답합니다. 사용자가 사용한 핵심 단어(예: 미시룩, 동탄, 카페)는 그대로 보존합니다.",
  ...COMMON_RULES,
].join(" ");

const SYSTEM_PROMPT_EN = [
  "You are an image-prompt stylist. When the user gives only a few keywords, expand into a vivid styling paragraph (outfit, setting, mood, posture). When the input is already detailed, keep it close to verbatim and only disambiguate.",
  "Convey appeal indirectly through wardrobe fit, fabric, silhouette, posture, and environmental mood — never through explicit sensual or body-focused vocabulary.",
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
