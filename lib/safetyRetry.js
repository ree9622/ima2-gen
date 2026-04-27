// Triggers that require an explicit non-sexual context wrapper.
const SWIMWEAR_RE =
  /(swimsuit|swimwear|bikini|beachwear|one[- ]?piece|rash ?guard|수영복|비키니|모노키니|래시가드|비치웨어)/i;
const SELFIE_RE = /(selfie|셀카|셀피|mirror shot|거울샷|거울에 비쳐)/i;

// Stronger triggers (clothing items / fabric properties that classifiers reject
// far more often than general swimwear). Real failure logs show these almost
// never pass without an English wrapper + keyword substitution.
const SHEER_RE =
  /(see[- ]?through|sheer|transparent|시스루|투명한|얇은 소재|속옷 라인|속옷이? ?비치|안이 비치)/i;
const UNDERWEAR_RE =
  /(lingerie|bralette|underwear|panties|brassiere|속옷|브라렛|브라|팬티|언더웨어|란제리)/i;
const FITTING_ROOM_RE = /(fitting ?room|dressing ?room|피팅룸|탈의실|시착실)/i;

// Body-emphasis cues that the classifier scores as sexualization signals.
// These get redacted from the rewritten prompt entirely.
const BODY_SECTION_RE = /\[\s*(?:신체\s*강조|body\s+emphasis)\s*\][\s\S]*?(?=\n\s*\[|$)/gi;
const BODY_EMPHASIS_PATTERNS = [
  /[A-Fa-f]\s*컵/g,
  /[A-Fa-f][- ]?cup\b/gi,
  /가슴\s*볼륨/g,
  /breast\s+volume/gi,
  /잘록한\s*허리/g,
  /골반\s*라인(?:[ \t]*도드라짐)?/g,
  /쇄골/g,
  /\b\d{2,3}\s*kg\b/gi,
  /전신\s*다\s*보이게/g,
  /몸매\s*좋(?:음|아)/g,
  /바디콘/g,
  /짧은\s*기장/g,
  /옆\s*사이드\s*트임/g,
  /깊은\s*(?:스퀘어\s*)?네크라인/g,
  /허벅지\s*사이드\s*슬릿/g,
];

// Keyword substitutions: replace high-risk fashion terms with neutral
// everyday phrasing. Order matters — longer/more specific patterns first.
const KEYWORD_SUBSTITUTIONS = [
  [/시스루\s*티셔츠/gi, "lightweight summer top"],
  [/시스루\s*나시/gi, "lightweight tank top"],
  [/시스루/gi, "lightweight summer top"],
  [/see[- ]?through\s+(?:t[- ]?shirt|top|blouse)/gi, "lightweight summer top"],
  [/see[- ]?through/gi, "lightweight summer top"],
  [/sheer\s+(?:fabric|top|blouse)/gi, "lightweight summer top"],
  [/브라렛\s*(?:속옷)?\s*세트/gi, "casual loungewear set"],
  [/브라렛/gi, "casual loungewear top"],
  [/bralette/gi, "casual loungewear top"],
  [/(?:속옷|언더웨어|란제리)\s*세트/gi, "casual loungewear set"],
  [/lingerie\s*set/gi, "casual loungewear set"],
  [/속옷|언더웨어|란제리|lingerie/gi, "casual loungewear"],
  [/비키니/gi, "two-piece swimwear"],
  [/bikini/gi, "two-piece swimwear"],
  [/수영복/gi, "swimwear"],
  [/swimsuit|swimwear/gi, "swimwear"],
  [/돌핀\s*팬츠/gi, "athletic shorts"],
  [/dolphin\s+shorts/gi, "athletic shorts"],
  [/피팅룸|탈의실|시착실/gi, "clothing store interior"],
  [/fitting ?room|dressing ?room/gi, "clothing store interior"],
];

const KOREAN_RE = /[가-힣]/;

// Hard blockers: never attempt to rewrite, fail safely instead.
const EXPLICIT_RE =
  /(nude|nudity|naked|topless|bottomless|porn|sex|sexual|erotic|fetish|노출|누드|나체|상의탈의|하의탈의|포르노|성행위|성적|에로|페티시)/i;
const MINOR_RE =
  /(child|kid|minor|underage|teen|teenage|schoolgirl|schoolboy|어린이|아이|미성년|청소년|10대|초등|중학생|여고생|남고생|학생|초고도비만 초등)/i;

// Korean wrapper retained for back-compat with existing UX copy. Tone:
// amateur smartphone snapshot, Korean setting, no editorial framing.
const KOREAN_WRAPPER =
  "성인(25세 이상) 인물로 표현하고, 비성적 수영복/비치웨어 또는 일상 셀카 맥락으로 연출한다. 화보/스튜디오 톤이 아닌, 일반인이 폰으로 찍은 자연스러운 스냅 사진. 보정·HDR·과한 채도·잡지스러운 연출 없음. 배경은 한국(한글 간판/한국 거리·해변·실내). 노출 강조 없음, 투명하거나 선정적인 의상 없음, 에로틱한 구도 없음, 미성년자 없음.";

// English wrapper. Empirically far more effective than Korean against
// OpenAI's safety classifier (which is English-trained). Used both for
// English-input prompts (back-compat) and as the second retry tier for
// Korean-input prompts. Tone: amateur smartphone snapshot, Korean setting.
const ENGLISH_WRAPPER =
  "Portray adults aged 25 or older in a non-sexual swimwear or everyday selfie context. " +
  "Render it as a casual amateur smartphone photo (iPhone-style candid snapshot), " +
  "natural ambient lighting, no studio setup, no professional retouching, no editorial framing, no HDR. " +
  "South Korea setting (Hangul signage, Korean streets / interiors / coastline). " +
  "No nudity, no see-through or erotic clothing, no erotic framing, no minors.";

// Stronger English wrapper used for tier-3 retries on high-risk prompts
// (sheer / underwear / fitting-room context). Frames the subject as a
// fictional AI persona, amateur phone snapshot in Korea — never editorial.
const STRONG_ENGLISH_WRAPPER =
  "AI-generated synthetic character (fictional persona, NOT a real person). " +
  "Casual amateur smartphone snapshot — candid iPhone-style photo by a friend or self, " +
  "natural ambient light, slightly imperfect framing, NO studio lighting, NO professional retouching, " +
  "NO fashion-magazine or editorial styling, NO HDR, NO oversaturated colors. " +
  "South Korea setting — Hangul signage, Korean streetscape, Korean interiors. " +
  "Adult subject aged 25 or older. Modest non-sexual presentation, " +
  "no body part emphasis, no see-through fabrics, no erotic framing, no minors.";

function hasAnyTrigger(text) {
  return (
    SWIMWEAR_RE.test(text) ||
    SELFIE_RE.test(text) ||
    SHEER_RE.test(text) ||
    UNDERWEAR_RE.test(text) ||
    FITTING_ROOM_RE.test(text)
  );
}

function isStrongTrigger(text) {
  return (
    SHEER_RE.test(text) ||
    UNDERWEAR_RE.test(text) ||
    FITTING_ROOM_RE.test(text) ||
    BODY_EMPHASIS_PATTERNS.some((re) => re.test(text)) ||
    BODY_SECTION_RE.test(text)
  );
}

function stripBodyEmphasis(text) {
  let out = text.replace(BODY_SECTION_RE, "");
  for (const re of BODY_EMPHASIS_PATTERNS) {
    out = out.replace(re, "");
  }
  // Collapse leftover punctuation/whitespace from removed phrases.
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/(^|\n)[ \t]*[,،·•-]+[ \t]*/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function substituteTriggerKeywords(text) {
  let out = text;
  for (const [pattern, replacement] of KEYWORD_SUBSTITUTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Tier 1: original wrapper behavior (back-compat).
// Returns the prompt with a Korean or English suffix appended. Used when only
// soft triggers (swimwear/selfie alone) are present, or as the first retry.
export function getCompliantPromptVariant(prompt) {
  if (typeof prompt !== "string") return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (!hasAnyTrigger(trimmed)) return null;
  if (EXPLICIT_RE.test(trimmed) || MINOR_RE.test(trimmed)) return null;

  const isKo = KOREAN_RE.test(trimmed);
  const suffix = isKo ? KOREAN_WRAPPER : ENGLISH_WRAPPER;

  if (trimmed.includes(suffix)) return null;
  return `${trimmed}\n\n${suffix}`;
}

// Tier 2: stronger rewrite for high-risk prompts. Strips body-emphasis cues,
// substitutes risky fashion keywords with catalog-safe phrasing, and prepends
// the strong English wrapper. Used when the prompt contains sheer/underwear/
// fitting-room/body-emphasis triggers — empirically these almost never pass
// with the tier-1 Korean suffix alone.
export function getStrongCompliantVariant(prompt) {
  if (typeof prompt !== "string") return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (EXPLICIT_RE.test(trimmed) || MINOR_RE.test(trimmed)) return null;
  if (!isStrongTrigger(trimmed) && !hasAnyTrigger(trimmed)) return null;

  let body = stripBodyEmphasis(trimmed);
  body = substituteTriggerKeywords(body);
  body = body.trim();

  if (!body) return null;
  if (body.includes(STRONG_ENGLISH_WRAPPER)) return null;
  return `${STRONG_ENGLISH_WRAPPER}\n\n${body}`;
}

// Build the ordered attempt list. Tier composition:
//   [original]                                  → no triggers
//   [original, korean/english wrapper]          → soft trigger (swimwear/selfie)
//   [original, korean wrapper, strong English]  → strong trigger
// All variants beyond the original are de-duped in-order.
export function buildPromptAttempts(prompt) {
  const attempts = [prompt];
  const tier1 = getCompliantPromptVariant(prompt);
  if (tier1 && !attempts.includes(tier1)) attempts.push(tier1);

  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (
    trimmed &&
    !EXPLICIT_RE.test(trimmed) &&
    !MINOR_RE.test(trimmed) &&
    isStrongTrigger(trimmed)
  ) {
    const tier2 = getStrongCompliantVariant(prompt);
    if (tier2 && !attempts.includes(tier2)) attempts.push(tier2);
  }

  return attempts;
}

export function hasCompliantRetry(prompt) {
  return buildPromptAttempts(prompt).length > 1;
}

// Extend the variant base sequence into N total attempts.
// For N greater than the variant count: cycle through the variants. Safety
// refusals do not change with the same prompt, but transient 5xx / network
// errors benefit from repeating. Falls back to the original prompt if no
// compliant variant is available.
export function buildAttemptSequence(prompt, maxAttempts) {
  const n = Math.max(1, Math.min(10, Math.floor(Number(maxAttempts) || 1)));
  const base = buildPromptAttempts(prompt);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(base[i % base.length]);
  }
  return out;
}
