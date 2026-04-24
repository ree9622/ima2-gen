const SWIMWEAR_RE =
  /(swimsuit|swimwear|bikini|beachwear|one[- ]?piece|rash ?guard|수영복|비키니|모노키니|래시가드|비치웨어)/i;
const SELFIE_RE = /(selfie|셀카|셀피|mirror shot|거울샷)/i;
const KOREAN_RE = /[가-힣]/;

const EXPLICIT_RE =
  /(nude|nudity|naked|topless|bottomless|porn|sex|sexual|erotic|fetish|lingerie|underwear|see[- ]?through|transparent|노출|누드|나체|상의탈의|하의탈의|포르노|성행위|성적|에로|페티시|속옷|란제리|시스루|투명)/i;
const MINOR_RE =
  /(child|kid|minor|underage|teen|teenage|schoolgirl|schoolboy|어린이|아이|미성년|청소년|10대|학생|여고생|남고생|중학생|초등학생)/i;

export function getCompliantPromptVariant(prompt) {
  if (typeof prompt !== "string") return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (!SWIMWEAR_RE.test(trimmed) && !SELFIE_RE.test(trimmed)) return null;
  if (EXPLICIT_RE.test(trimmed) || MINOR_RE.test(trimmed)) return null;

  const isKo = KOREAN_RE.test(trimmed);
  const suffix = isKo
    ? "성인(25세 이상) 인물로 표현하고, 비성적 수영복/비치웨어 패션 또는 휴가 셀카 맥락으로 연출한다. 자연스러운 포즈, 밝은 해변 또는 수영장 분위기, 노출 강조 없음, 투명하거나 선정적인 의상 없음, 에로틱한 구도 없음, 미성년자 없음."
    : "Portray adults aged 25 or older in a non-sexual swimwear, beachwear fashion, or vacation selfie context. Use natural posing, bright beach or pool atmosphere, no nudity, no see-through or erotic clothing, no erotic framing, and no minors.";

  if (trimmed.includes(suffix)) return null;
  return `${trimmed}\n\n${suffix}`;
}

export function buildPromptAttempts(prompt) {
  const attempts = [prompt];
  const compliant = getCompliantPromptVariant(prompt);
  if (compliant && compliant !== prompt) attempts.push(compliant);
  return attempts;
}

export function hasCompliantRetry(prompt) {
  return buildPromptAttempts(prompt).length > 1;
}
