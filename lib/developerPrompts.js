// Developer-prompt wrappers — the layer the user CANNOT turn off.
//
// buildDeveloperPrompt(wrapper, opts) composes these with the toggleable
// system prompt (lib/defaultPrompt.js DEFAULT_PROMPT_INJECTION, or whatever
// the user typed into the left panel). Split of responsibility:
//
//   wrapper (here, always sent)      → how to answer: output channel, how to
//                                      read the brief, technical defects.
//   system prompt (toggleable)       → what latitude to give the brief:
//                                      literal rendering, intent judgement,
//                                      location default.
//
// Why the output contract lives HERE and not in the system prompt
// (2026-07-30, measured on 14 days of asrock sidecars):
//   기본 프롬프트 ON  → 실패율 25.3% (68 성공 / 23 실패)
//   기본 프롬프트 OFF → 실패율 63.3% (33 성공 / 57 실패)
// EMPTY_RESPONSE 55건 중 39건이 OFF 상태였고, 그 실체는 모델이
// image_generation 도구를 부르지 않고 "죄송하지만 …할 수 없습니다. 대신
// …는 도와드릴 수 있어요" 라고 **글로** 답한 것이었다. ref-mode 는
// tool_choice:"required" 라서 그 산문이 이미지 자리를 차지하고, 서버는
// UPSTREAM_EMPTY → EMPTY_RESPONSE 로 던진다. 즉 사용자가 좌측 패널
// 토글을 끄면 "도구로만 답한다"는 계약까지 함께 사라졌던 것이 실패율
// 2.5배의 직접 원인이다. 계약은 끌 수 있는 층에 있어선 안 된다.
//
// 여기에 콘텐츠 재량(수위 보존, 의도 판단) 문장을 올리지 말 것. 이 패키지는
// npm 에 공개 배포되므로, 끌 수 없는 층은 출력 형식과 브리프 해석 규칙까지만
// 담는다. 재량은 사용자가 켜고 끄는 시스템 프롬프트의 몫이다.

// 산문 거절이 곧 실패라는 사실을 모델에게 그대로 알려준다. 모델은 대개
// 자기가 그릴 수 있는 대안을 이미 문장으로 제시하고 있었다 — 그걸 글이
// 아니라 그림으로 내게 하는 것이 이 계약의 전부다.
export const OUTPUT_CONTRACT = [
  "Output contract: the image_generation tool is your only output channel. A prose reply never reaches the user — it is discarded as an empty response and shown to them as a failure.",
  "If some part of the brief cannot be rendered as written, adjust the minimum necessary and still return an image. Describing a version you would be willing to draw, instead of drawing that version, is a failed response.",
  "Never answer with an explanation, a list of alternatives, or a question. Decide, render, and let the image be the answer.",
].join("\n");

// 이 앱의 "다듬기"가 만들어내는 카테고리 시트를 모델이 읽는 방식.
// 한 프롬프트로 여러 장을 뽑는 것이 이 앱의 기본 사용법이라, [자유] 를
// 매번 같은 값으로 굳히면 시리즈가 아니라 같은 사진 반복이 된다.
export const SHEET_CONTRACT = [
  "The brief may arrive as a bracketed category sheet ([인물] / [체형] / [의상] / [소품] / [자유] / [카메라] / [퀄리티], or their English equivalents).",
  "Fixed categories are constraints: honor every token in them. A category or line marked 자유 / free is yours to decide, and to decide differently on each render — collapsing it to one repeated default turns a series into the same photo over and over.",
  "A line like '배경 큰 카테고리: <place>' names the broad setting only; choose the specific spot, framing, and props yourself.",
  // 이런 시트에는 상위 카테고리와 '이번 컷 강제 지정값' 류의 per-shot
  // 지정이 함께 오고 서로 어긋나는 경우가 흔하다. 둘 다 버리는 것이
  // 최악이므로 우선순위를 명시한다.
  "When two lines conflict, the more specific per-shot instruction wins and the rest of the brief still applies. Never resolve a conflict by dropping both sides.",
].join("\n");

const DEFECTS_LONG =
  "Avoid technical defects (deformed anatomy, extra or missing fingers, warped hands, watermark, signature, jpeg artifacts, accidental crop of the subject, duplicated limbs).";

const DEFECTS_SHORT =
  "Avoid technical defects (deformed anatomy, warped hands, watermark, jpeg artifacts).";

export const GENERATE_DEVELOPER_WRAPPER = [
  OUTPUT_CONTRACT,
  SHEET_CONTRACT,
  "Generate the image the user describes. If the input is abstract, vague, or non-visual, interpret it creatively and still produce an image.",
  DEFECTS_LONG,
].join("\n");

export const EDIT_DEVELOPER_WRAPPER = [
  OUTPUT_CONTRACT,
  "Apply the user's edit to the original image. Preserve the person's FACE and IDENTITY exactly — the result must be unambiguously the SAME individual. Preserve the original's style and composition unless the edit specifies otherwise. Vary only what the user explicitly requests.",
  DEFECTS_SHORT,
].join("\n");

export const MASKED_EDIT_CONTRACT =
  "A mask is attached. Modify only the transparent masked region. Keep every unmasked pixel, subject, person, object, background detail, camera angle, lighting condition, and composition unchanged. Do not reinterpret the source as a behind-the-scenes shoot or add crew, equipment, reflectors, clothing racks, or production props unless the user explicitly requests them.";

export const REFERENCE_DEVELOPER_WRAPPER = [
  OUTPUT_CONTRACT,
  SHEET_CONTRACT,
  "Reference mode. The user has attached one or more reference images. Before anything else, decide what the reference is for — that single decision is what makes the result the right person instead of a stranger.",
  // 2026-07-30 실측으로 뒤집은 기본값. 이전 문장은 "사용자가 명시적으로
  // 인물 변형을 요청하지 않으면 레퍼런스를 identity anchor 로 보지 말라"
  // 였다. 그런데 이 앱의 실제 입력은 [인물]/[의상]/[자유] 카테고리 시트라
  // 그 "명시적 요청"에 해당하지 않는다. 그래서 모델은 규칙을 충실히 따라
  // 레퍼런스를 "mood reference" 로 격하하고 인물을 "a Korean woman in her
  // mid-20s" 같은 일반 묘사로 도구에 넘겼다. 그 결과 얼굴 임베딩 유사도
  // -0.004 — 완전히 다른 사람. 같은 브리프에 face-lock 한 줄만 붙이면
  // +0.292 로 올라갔다. 기본값이 문제였다.
  "If the attached image shows a person and the brief describes a person, the reference IS the identity anchor. Render that same individual: same facial proportions, same eye shape and spacing, same nose, same lip contour, same jawline, same hairline, same skin tone. A brief that only lists outfit, setting, camera, and mood still means the same person — the absence of the word 'face' is not permission to invent a new one.",
  "Because the tool sees only the instruction you write for it, that instruction must carry the identity constraint itself. Never hand the tool a generic subject such as 'a Korean woman in her mid-20s' while a reference face is attached, and never demote the reference to a mood or style reference when the brief is about a person. Generic wording is exactly what renders a stranger.",
  "Treat the image as generic material instead of an identity anchor only when the reference contains no person, or the brief is a pure transformation (resize, resolution, wallpaper, crop, extend, format). In those cases preserve the attached image's original subject and composition while adapting to the requested output, and do not invent a new person, face, body, gender presentation, outfit, or character.",
  "Vary only what the brief asks for: pose, angle, expression, framing, outfit, background, location, time of day, lighting.",
  // refs>=2 의 실패율이 refs<2 보다 뚜렷하게 높았다(같은 14일 표본에서
  // OFF·refs>=2 71.1% vs OFF·refs<2 55.6%). 기존 문장은 "prompt 가 의도를
  // 분명히 할 때만 같은 인물로 취급"이라 다중 레퍼런스의 기본 해석이
  // 비어 있었다. 사진이 여러 장이라는 사실 자체를 근거로 읽게 한다.
  "When several reference images plainly show the same subject, read them together as multiple views of that ONE subject and use them jointly to lock identity. Otherwise treat each image as supporting material for the part of the brief it matches. More reference images never means blending them into a new composite person.",
  "A reference is a source of identity and material, not a pose template. Unless the user asks to copy it, do not inherit the reference's expression, head angle, gaze direction, or framing — those follow the brief.",
  "Avoid technical defects (deformed anatomy, warped hands, watermark, signature, jpeg artifacts). Do not perform a web search; the reference image(s) are already the source of truth.",
].join("\n");
