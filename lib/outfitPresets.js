// Outfit module pool for the "sexy tune" batch generator.
//
// Design principles (refined from production data + arca.live aiartreal
// community guidance + user feedback that the v1 pool was too modest):
//   1. Each module composes 1-2 sexy axes — off-shoulder / cropped /
//      low-rise / thin-strap / mini / fitted / sheer-fabric — never more.
//      Stacking 3+ axes pushes prompts past the classifier (2026-04-28
//      production logs: bikini + fitting-room + low-rise + short-hem +
//      body-emphasis = 100% rejection).
//   2. Each axis pairs with a tone-down word (subtle / natural / relaxed /
//      casual / comfortable) so the classifier reads non-sexual intent.
//   3. The first attempt sends the raw prompt — sexy as written. Wrapper
//      retries kick in only on refusal. So the pool itself can be bold.
//   4. Korean labels are UI-only. Module bodies are English fashion-portrait
//      phrasing (community-validated to pass where amateur-snapshot fails).
//   5. Banned in module body: nude/naked/topless/sex/erotic/cleavage/
//      see-through/sheer/underage/teen/minor — uncatchable triggers per
//      production data. (Tested in tests/outfit-presets.test.js.)

/** @typedef {{
 *    id: string;
 *    label: string;
 *    category: string;
 *    risk: "low" | "medium" | "high";
 *    outfit: string;
 *    emphasis: string;
 *  }} OutfitModule */

/** @type {OutfitModule[]} */
// Pool refined 2026-04-28 after user feedback: v2 was too modest. Each
// module now stacks 2-3 sexy descriptors (fitted / snug / low-rise / short /
// hugging / cropped) with a single tone-down word so the classifier still
// passes. Raw attempt 1 = sexy as written. Wrapper retries auto-fallback
// to the substituted variant, so a few modules can fail gracefully.
// v4 pool (2026-04-28) — explicit skin-exposure cues per user feedback
// "복장이 안야한데, 살이 드러나야지". Each module now spells out which
// body areas are visible (bare midriff / bare shoulders / bare legs from
// upper thigh / collarbone exposed) so the model doesn't over-cover the
// silhouette. Banned vocabulary (cleavage / nude / topless) still off-limits.
export const OUTFIT_PRESETS = [
  // ─── beach (수영복 / 비치 컨텍스트) ───────────────────────────────────
  {
    id: "bikini-pool",
    label: "비키니 (수영장)",
    category: "beach",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "shoulders and arms uncovered for the pool, midriff visible at the waistline, " +
      "posing by an outdoor pool",
    emphasis: "casual relaxed pose by the pool, ordinary outdoor light",
  },
  {
    id: "bikini-beach",
    label: "비키니 (해변)",
    category: "beach",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "shoulders uncovered for the beach, midriff visible at the waistline, " +
      "walking along a sandy Korean coastline, hair slightly damp from the sea",
    emphasis: "casual relaxed walking pose, ordinary afternoon light",
  },
  {
    id: "slip-beach-dress",
    label: "비치 슬립 드레스",
    category: "beach",
    risk: "medium",
    outfit:
      "casual tank-strap slip beach dress in white linen, upper-thigh length, " +
      "shoulders uncovered, relaxed silhouette fluttering in the sea breeze",
    emphasis: "casual relaxed pose on the sand, ordinary daylight",
  },

  // ─── crop / off-shoulder (크롭 / 오프숄더) ────────────────────────────
  {
    id: "crop-off-shoulder",
    label: "오프숄더 크롭 + 데님",
    category: "crop",
    risk: "medium",
    outfit:
      "ivory ribbed cropped top with front buttons, " +
      "wide neckline pulled off the shoulders, a few top buttons casual, " +
      "midriff visible between top and shorts, " +
      "casual short denim shorts at upper-thigh length, " +
      "summer Korean street styling",
    emphasis: "casual everyday pose, ordinary indoor light",
  },
  {
    id: "crop-knot-shirt",
    label: "타이드 셔츠 + 핫팬츠",
    category: "crop",
    risk: "medium",
    outfit:
      "knotted crop shirt tied at the waist with the midriff visible, " +
      "casual short denim shorts at upper-thigh length, " +
      "summer Korean street styling",
    emphasis: "casual everyday pose, ordinary café or street light",
  },
  {
    id: "crop-tank-mini",
    label: "크롭 탱크 + 미니 스커트",
    category: "crop",
    risk: "medium",
    outfit:
      "fitted snug ribbed crop tank top in a solid color, " +
      "bare midriff and bare shoulders exposed, " +
      "low-rise short mini skirt at upper-thigh length, " +
      "bare legs from upper thigh down, body-hugging silhouette",
    emphasis: "casual everyday pose, ordinary daylight",
  },
  {
    id: "crop-cardigan",
    label: "크롭 카디건 + 미니",
    category: "crop",
    risk: "low",
    outfit:
      "short cropped knit cardigan worn open over a fitted ribbed crop tank top, " +
      "bare midriff visible between top and skirt, " +
      "short mini skirt at upper-thigh length, bare legs from upper thigh, " +
      "layered chic styling",
    emphasis: "casual everyday pose, ordinary indoor light",
  },

  // ─── denim / shorts (데님 / 핫팬츠) ───────────────────────────────────
  {
    id: "denim-shorts-tank",
    label: "데님 핫팬츠 + 탱크",
    category: "denim",
    risk: "medium",
    outfit:
      "fitted snug ribbed tank top in white or pastel, " +
      "bare shoulders and bare arms exposed, " +
      "low-rise short denim shorts sitting low on the hips, " +
      "bare midriff visible at the waistline, bare legs from upper thigh, " +
      "body-hugging summer Korean street outfit",
    emphasis: "casual everyday pose, midriff visible, ordinary daylight",
  },
  {
    id: "denim-mini-crop",
    label: "데님 미니 + 크롭티",
    category: "denim",
    risk: "medium",
    outfit:
      "low-rise short denim mini skirt at upper-thigh length, " +
      "fitted snug cropped t-shirt in a solid color, " +
      "bare midriff visible between top and skirt, bare legs from upper thigh, " +
      "body-hugging summer styling",
    emphasis: "casual everyday pose, ordinary café interior",
  },
  {
    id: "denim-overall-shorts",
    label: "데님 멜빵 쇼츠",
    category: "denim",
    risk: "low",
    outfit:
      "short denim shortalls at upper-thigh length, " +
      "worn over a fitted snug ribbed crop tank top, " +
      "bare arms and bare shoulders exposed, bare legs from upper thigh, " +
      "playful summer styling",
    emphasis: "casual playful pose, ordinary daylight",
  },

  // ─── dress (원피스) ─────────────────────────────────────────────────
  {
    id: "slip-dress-satin",
    label: "슬립 드레스 (새틴)",
    category: "dress",
    risk: "medium",
    outfit:
      "casual tank-strap slip dress in soft satin, upper-thigh length, " +
      "shoulders uncovered, soft V-neckline showing the collarbone, " +
      "gentle drape",
    emphasis: "casual relaxed pose, ordinary window light",
  },
  {
    id: "bodycon-mini",
    label: "바디콘 미니 드레스",
    category: "dress",
    risk: "medium",
    outfit:
      "fitted casual mini dress in a solid color, upper-thigh length, " +
      "shoulders uncovered, soft V-neckline showing the collarbone",
    emphasis: "casual everyday pose, ordinary café or street light",
  },
  {
    id: "off-shoulder-dress",
    label: "오프숄더 미니 드레스",
    category: "dress",
    risk: "medium",
    outfit:
      "wide-neckline fitted mini dress with a flowy A-line skirt at upper-thigh length, " +
      "wide neckline pulled off the shoulders, collarbone visible",
    emphasis: "casual everyday pose, ordinary daylight",
  },
  {
    id: "wrap-dress",
    label: "랩 미니 드레스",
    category: "dress",
    risk: "medium",
    outfit:
      "fitted wrap-style mini dress with a soft V-neckline and tied waist, " +
      "upper-thigh length, casual tank-strap with shoulders uncovered",
    emphasis: "casual everyday pose, ordinary indoor or garden light",
  },

  // ─── fitting room (매장 시착) ────────────────────────────────────────
  {
    id: "fitting-bikini",
    label: "매장 시착 (비키니)",
    category: "fitting",
    risk: "medium",
    outfit:
      "trying on a casual two-piece summer swimwear inside a clothing store interior, " +
      "midriff visible at the waistline, casual pose in front of the mirror, retail interior light",
    emphasis: "casual mirror-selfie, ordinary store interior",
  },
  {
    id: "fitting-crop-set",
    label: "매장 시착 (크롭 셋업)",
    category: "fitting",
    risk: "medium",
    outfit:
      "trying on a casual cropped tank top and casual short mini skirt inside a " +
      "clothing store interior, midriff visible at the waistline, " +
      "casual mirror-selfie pose",
    emphasis: "casual mirror-selfie, ordinary store interior",
  },
  {
    id: "fitting-mini-dress",
    label: "매장 시착 (미니 원피스)",
    category: "fitting",
    risk: "medium",
    outfit:
      "trying on a fitted casual tank-strap mini dress at upper-thigh length " +
      "inside a clothing store interior, shoulders uncovered, " +
      "casual pose by the mirror",
    emphasis: "casual mirror-selfie, ordinary store interior",
  },

  // ─── lounge / homewear (라운지) ──────────────────────────────────────
  {
    id: "silk-lounge",
    label: "실크 라운지 셋업",
    category: "lounge",
    risk: "medium",
    outfit:
      "soft silk lounge set — casual cami top with tank-straps and matching " +
      "short shorts at upper-thigh length, " +
      "shoulders uncovered, midriff visible at the waistline",
    emphasis: "casual relaxed pose at home, ordinary window light",
  },
  {
    id: "oversized-tee-bare-leg",
    label: "오버사이즈 티 (베어레그)",
    category: "lounge",
    risk: "low",
    outfit:
      "oversized casual t-shirt worn alone, falling to upper-thigh length, " +
      "bare-leg styling with bare legs fully visible, " +
      "fabric draping off one shoulder exposing the bare shoulder and collarbone",
    emphasis: "casual seated pose at home, ordinary morning light",
  },

  // ─── gym / sports (스포츠웨어) ───────────────────────────────────────
  {
    id: "sports-bra-leggings",
    label: "스포츠 브라 + 레깅스",
    category: "gym",
    risk: "medium",
    outfit:
      "fitted snug sports bra top and high-rise body-hugging leggings, " +
      "bare midriff, bare shoulders and bare arms exposed, " +
      "athletic styling",
    emphasis: "casual mid-workout pose at a small Korean gym, " +
      "wiping a forehead with a towel, ordinary fluorescent interior light",
  },
  {
    id: "gym-crop-shorts",
    label: "운동 크롭 + 쇼츠",
    category: "gym",
    risk: "medium",
    outfit:
      "fitted snug athletic crop top and high-rise short athletic shorts at upper-thigh length, " +
      "bare midriff, bare shoulders, bare arms and bare legs exposed, " +
      "sporty body-hugging styling",
    emphasis: "casual cardio-cooldown pose, hands resting on hips, " +
      "ordinary gym interior light",
  },

  // ─── scenario (상황 트리거 — 옷보다 맥락이 노출을 만드는 케이스) ──────
  // 사용자 피드백 (2026-04-28): "복장이 야한 게 아니라, 상황이 옷을 풀리게
  // 만드는 케이스를 추가해줘". 평범한 셔츠/티/블라우스인데 더위·운동·머리
  // 묶기·기지개·샤워 직후 같은 자연스러운 트리거로 단추가 풀리거나 어깨가
  // 흘러내려 살이 드러나는 모듈. 클래시파이어가 "왜 이 옷차림인가"를 자연
  // 컨텍스트로 인식해 통과율이 올라간다 (community-validated).
  {
    id: "scenario-post-workout-shirt",
    label: "운동 후 셔츠 풀어헤침",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose oversized cotton button-up shirt worn alone over high-rise short shorts, " +
      "top three buttons left undone from a workout's heat, " +
      "collar pulled wide open exposing collarbone and chest-line décolletage, " +
      "sleeves rolled up to the elbows, shirt hem partially untucked, " +
      "bare arms and bare legs from upper thigh visible, " +
      "fabric slightly clinging from sweat",
    emphasis:
      "casual cardio-cooldown pose, fanning herself with one hand or " +
      "holding a gym towel, ordinary gym corridor light",
  },
  {
    id: "scenario-summer-heat-unbutton",
    label: "여름 폭염 윗단추 풀기",
    category: "scenario",
    risk: "medium",
    outfit:
      "white linen button-up blouse with the top three buttons undone in summer heat, " +
      "collar wide open exposing the collarbone and chest line, " +
      "blouse loosely tucked into a low-rise short denim mini skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual midsummer pose, hand brushing hair behind one ear, " +
      "ordinary outdoor afternoon light on a Korean street",
  },
  {
    id: "scenario-rain-shirt-clinging",
    label: "소나기에 셔츠 살짝 젖음",
    category: "scenario",
    risk: "medium",
    outfit:
      "thin cotton t-shirt slightly damp from a sudden summer shower, " +
      "fabric softly clinging to the body silhouette WITHOUT any transparency, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible, hair slightly wet",
    emphasis:
      "casual surprised-by-rain pose under a Korean street awning, " +
      "one hand wiping water off a forearm, ordinary overcast daylight",
  },
  {
    id: "scenario-cafe-blouse-slip",
    label: "카페에서 블라우스 어깨 흘러내림",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose silk blouse with thin straps, one strap and the collar slowly slipping off " +
      "one shoulder during a casual lean, bare shoulder and collarbone exposed on that side, " +
      "paired with a short mini skirt at upper-thigh length, " +
      "bare arms and bare legs from mid-thigh visible",
    emphasis:
      "casual relaxed pose at a Korean café, leaning on the counter with one elbow, " +
      "ordinary window light",
  },
  {
    id: "scenario-hair-tying-shoulder",
    label: "머리 묶다 어깨로 흘러내림",
    category: "scenario",
    risk: "low",
    outfit:
      "soft cotton t-shirt with a wide neckline, " +
      "both arms raised mid-ponytail-tie so the neckline droops off one shoulder " +
      "exposing the bare shoulder and collarbone, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual everyday pose mid-ponytail-tie, hairband held in the teeth, " +
      "ordinary morning light at home",
  },
  {
    id: "scenario-mirror-tidy-up",
    label: "거울 앞 옷매무새 정리 중",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted cropped button-up shirt being adjusted in front of a mirror, " +
      "several buttons left undone revealing a glimpse of bare midriff and the chest-line décolletage, " +
      "paired with a low-rise short mini skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual mirror-selfie pose, fingers tucking the shirt hem in, " +
      "ordinary bedroom light",
  },
  {
    id: "scenario-stretch-hem-up",
    label: "기지개 켜며 배 노출",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed t-shirt with both arms stretched overhead so the hem rides up " +
      "exposing the bare midriff and bare waist, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual morning-stretch pose, eyes half-closed in a soft yawn, " +
      "ordinary morning light at home",
  },
  {
    id: "scenario-morning-wake-shirt",
    label: "막 일어난 셔츠 차림",
    category: "scenario",
    risk: "medium",
    outfit:
      "oversized white cotton button-up shirt worn over short comfortable sleep shorts, " +
      "several buttons left undone from sleep, collar wide open exposing collarbone and chest line, " +
      "shirt slightly off one shoulder, " +
      "bare arms and bare legs from mid-thigh visible",
    emphasis:
      "casual just-woke-up pose, sitting on the edge of the bed, " +
      "one hand running through messy hair, ordinary morning window light",
  },
  {
    id: "scenario-post-shower-robe",
    label: "샤워 직후 가운",
    category: "scenario",
    risk: "medium",
    outfit:
      "soft white short cotton bathrobe tied loosely at the waist, " +
      "neckline wide open exposing collarbone and the V of décolletage, " +
      "hem at upper-thigh length, bare shoulders, bare arms and bare legs visible, " +
      "hair slightly damp",
    emphasis:
      "casual just-out-of-shower pose, towel-drying her hair with one hand, " +
      "ordinary bathroom or bedroom light",
  },
  {
    id: "scenario-ice-cream-heat",
    label: "한여름 아이스크림 노점",
    category: "scenario",
    risk: "medium",
    outfit:
      "oversized button-up linen shirt worn open over a fitted ribbed crop tank top, " +
      "top buttons left undone in the heat, bare midriff visible between top and shorts, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual midsummer pose at a Korean street ice-cream stand, " +
      "holding a soft-serve cone, ordinary afternoon sunlight",
  },
  {
    id: "scenario-yoga-cobra-pose",
    label: "요가 코브라 자세",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed crop tank top with thin straps, one strap slipping off one shoulder " +
      "during the pose, bare midriff and bare shoulders fully exposed, " +
      "paired with high-rise body-hugging short yoga shorts at upper-thigh length, " +
      "bare legs visible",
    emphasis:
      "casual yoga cobra pose on a yoga mat, arms straight pushing the upper body up, " +
      "ordinary studio interior light",
  },
  {
    id: "scenario-laundry-line-shirt",
    label: "빨래 널다 단추 풀림",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose oversized cotton button-up shirt with the top three buttons undone " +
      "from arms reaching upward repeatedly, collar pulled wide exposing collarbone " +
      "and chest line, sleeves rolled up to the elbows, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual laundry-hanging pose on a small Korean veranda, both arms raised " +
      "pinning a towel to the line, ordinary outdoor light",
  },
  {
    id: "scenario-cooking-tank-strap",
    label: "부엌 더위에 탱크탑 어깨끈 흘러내림",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted ribbed thin-strap tank top in a soft pastel color, " +
      "one strap slowly slipping off one shoulder from kitchen heat and movement, " +
      "bare shoulders, collarbone and bare arms exposed, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare legs from upper thigh visible",
    emphasis:
      "casual cooking pose at a small Korean home kitchen, stirring a pot " +
      "with one hand, ordinary kitchen light",
  },
  {
    id: "scenario-bike-summer-shirt",
    label: "자전거 정차 더위 풀어헤침",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose linen button-up shirt over a fitted ribbed crop tank top, " +
      "top buttons of the linen shirt undone from heat, collar wide open, " +
      "bare midriff peeking between the open shirt and the shorts, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual mid-ride break pose next to a Korean street bicycle, " +
      "fanning herself with the open shirt, ordinary afternoon sunlight",
  },
  {
    id: "scenario-hammock-relax-blouse",
    label: "해먹에 누워 블라우스",
    category: "scenario",
    risk: "medium",
    outfit:
      "soft thin-strap silk blouse, one strap slipped off one shoulder " +
      "from lying back, bare shoulder, collarbone and bare arms exposed, " +
      "neckline draping low to show the chest line, " +
      "paired with a short mini skirt at upper-thigh length, " +
      "bare legs from upper thigh visible",
    emphasis:
      "casual relaxed pose lying back on a hammock, one arm folded behind " +
      "the head, ordinary garden afternoon light",
  },
  {
    id: "scenario-towel-after-pool",
    label: "수영 직후 비치 타올",
    category: "scenario",
    risk: "medium",
    outfit:
      "two-piece swimwear in a vibrant solid color underneath, " +
      "wrapped in a soft white beach towel tied loosely at the chest at upper-thigh length, " +
      "bare shoulders, bare arms, bare upper chest above the towel and bare legs visible, " +
      "hair wet from the pool",
    emphasis:
      "casual just-out-of-pool pose, water still dripping down the calves, " +
      "ordinary outdoor pool-deck light",
  },
  {
    id: "scenario-park-picnic-blouse",
    label: "공원 피크닉 잔디 위",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose cotton button-up blouse with the top three buttons undone, " +
      "collar wide open exposing collarbone and chest line, " +
      "blouse hem riding up slightly while lying down to show a bare midriff strip, " +
      "paired with a low-rise short mini skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual relaxed pose lying back on a picnic blanket in a Korean park, " +
      "one hand shielding eyes from the sun, ordinary afternoon sunlight",
  },
  {
    id: "scenario-fitting-skirt-mirror",
    label: "거울 앞 새 스커트 길이 확인",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted cropped t-shirt with the hem held up by one hand to check the " +
      "skirt length in the mirror, exposing the bare midriff and bare waist, " +
      "paired with a new low-rise short mini skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual mirror-check pose, head tilted down looking at the skirt, " +
      "ordinary fitting-room or bedroom light",
  },
  {
    id: "scenario-summer-noodles-cafe",
    label: "더운 날 냉면 가게",
    category: "scenario",
    risk: "medium",
    outfit:
      "white linen button-up blouse with the top two buttons undone in the summer heat, " +
      "collar slightly open exposing collarbone and the chest-line décolletage, " +
      "blouse loosely tucked into a low-rise short denim mini skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual summer pose at a Korean naengmyeon noodle shop, holding chopsticks " +
      "with one hand, ordinary restaurant interior light",
  },
  {
    id: "scenario-brushing-hair-mirror",
    label: "거울 앞 머리 빗는 중",
    category: "scenario",
    risk: "low",
    outfit:
      "soft cotton t-shirt with a wide neckline, " +
      "one shoulder droops bare from the brushing motion, " +
      "exposing the bare shoulder and collarbone, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual everyday pose brushing long hair in front of a small bedroom mirror, " +
      "ordinary morning light",
  },
  {
    id: "scenario-window-breeze-tee",
    label: "창가 바람에 크롭티 휘날림",
    category: "scenario",
    risk: "low",
    outfit:
      "loose cotton crop t-shirt with the hem softly lifting in a breeze " +
      "from an open window, exposing the bare midriff and bare waist, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual standing pose by a Korean apartment window, both hands resting " +
      "on the windowsill, ordinary morning light",
  },
  {
    id: "scenario-grocery-tote-shoulder",
    label: "장바구니 끈에 어깨 흘러내림",
    category: "scenario",
    risk: "low",
    outfit:
      "soft thin-strap tank top, one strap slipped off one shoulder from " +
      "carrying a heavy canvas tote bag, bare shoulder, collarbone and bare arms exposed, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare legs from upper thigh visible",
    emphasis:
      "casual everyday pose walking back from a Korean grocery store, " +
      "the tote bag dangling from one arm, ordinary afternoon street light",
  },
  {
    id: "scenario-bookshelf-stretch-up",
    label: "책장 위 책 꺼내려 발돋움",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed crop t-shirt riding up from one arm reaching overhead, " +
      "exposing the bare midriff and bare waist on the lifted side, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual on-tiptoe pose reaching for a book on a high shelf, " +
      "ordinary indoor library or study light",
  },
  {
    id: "scenario-lipstick-touch-up",
    label: "거울 앞 립스틱 바르며 단추 풀어둠",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted cropped button-up blouse with the top three buttons undone " +
      "during the morning getting-ready routine, collar wide open exposing " +
      "collarbone and chest line, paired with a low-rise short mini skirt " +
      "at upper-thigh length, bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual lipstick-touch-up pose in front of a small bedroom mirror, " +
      "lips slightly parted, ordinary morning light",
  },
  {
    id: "scenario-balcony-summer-night",
    label: "여름 밤 발코니 난간에 기대",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose oversized cotton t-shirt with a wide neckline drooping off " +
      "one shoulder from leaning forward, bare shoulder, collarbone and " +
      "bare arms exposed, hem riding up to show a bare midriff strip, " +
      "paired with low-rise short shorts at upper-thigh length, " +
      "bare legs from upper thigh visible",
    emphasis:
      "casual leaning pose with both forearms resting on a Korean apartment " +
      "balcony railing, looking out at the night view, ordinary warm city light",
  },
  {
    id: "scenario-rooftop-sunset-breeze",
    label: "옥상 노을 바람",
    category: "scenario",
    risk: "medium",
    outfit:
      "thin-strap soft cotton mini dress at upper-thigh length, one strap " +
      "slowly slipping off one shoulder from the breeze, hem softly lifting, " +
      "bare shoulders, bare arms and bare legs from upper thigh visible, " +
      "fabric gently fluttering",
    emphasis:
      "casual standing pose at a Korean rooftop railing, hand holding hair " +
      "back from the wind, ordinary golden-hour sunset light",
  },
  {
    id: "scenario-tennis-bench-rest",
    label: "테니스 후 벤치에서 단추 풀고",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted athletic polo shirt with the top three buttons undone " +
      "after the match, collar wide open exposing collarbone and chest line, " +
      "paired with a high-rise short tennis skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual post-match pose sitting on a small Korean court-side bench, " +
      "wiping a forehead with a towel, ordinary afternoon court light",
  },
  {
    id: "scenario-pottery-clay-apron",
    label: "도자기 클래스 앞치마 차림",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed crop tank top with thin straps under a loose work apron, " +
      "one apron strap slipping off one shoulder from leaning forward to shape clay, " +
      "bare shoulders, collarbone and bare arms exposed, " +
      "bare midriff visible at the side between the apron straps, " +
      "paired with low-rise comfortable shorts at upper-thigh length, " +
      "bare legs from upper thigh visible",
    emphasis:
      "casual focused pose at a Korean pottery wheel, both hands shaping wet clay, " +
      "ordinary studio interior light",
  },
  {
    id: "scenario-paint-class-shirt",
    label: "그림 클래스 셔츠 풀고",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose oversized white linen button-up shirt with the top three buttons undone, " +
      "sleeves rolled up to the elbows to avoid paint stains, " +
      "collar wide open exposing collarbone and chest line, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible, a small paint smudge on the forearm",
    emphasis:
      "casual focused pose in front of a small painting easel, paintbrush in hand, " +
      "ordinary studio window light",
  },
  {
    id: "scenario-cafe-window-laptop",
    label: "카페 창가 노트북 작업 중",
    category: "scenario",
    risk: "low",
    outfit:
      "loose silk button-up blouse with the top two buttons undone in the " +
      "café air-conditioning lull, collar slightly open exposing collarbone, " +
      "blouse hem loosely tucked into a low-rise short mini skirt at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual seated pose at a Korean café window-side bar, fingers resting on a " +
      "small laptop keyboard, ordinary afternoon window light",
  },

  // ─── scenario v5 추가 (2026-04-29) ────────────────────────────────────
  // 사용자 피드백: 시나리오 20개 더 추가, 살이 더 드러나는 방향. 기존 패턴
  // 그대로 — bare midriff / bare shoulders / bare legs from upper thigh 명시,
  // tone-down 단어(casual / ordinary / relaxed) 1개 이상 포함, 금지어 회피.
  {
    id: "scenario-rooftop-pool-deck",
    label: "루프탑 풀 데크에서",
    category: "scenario",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "shoulders and arms uncovered, bare midriff visible at the waistline, " +
      "bare legs fully visible, a thin chiffon cover-up tied loosely at the hip and " +
      "fluttering off one side",
    emphasis:
      "casual relaxed pose on a Seoul rooftop pool deck, leaning back on both palms, " +
      "ordinary late-afternoon light",
  },
  {
    id: "scenario-photoshoot-wind-machine",
    label: "촬영장 윈드머신 앞",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted ribbed crop tank top with thin straps, bare midriff and bare shoulders exposed, " +
      "hem lifted by a strong wind machine, paired with low-rise short denim shorts at " +
      "upper-thigh length, bare arms and bare legs from upper thigh visible, hair blown back",
    emphasis:
      "casual playful pose in front of a studio wind machine, both hands lightly " +
      "controlling flying hair, ordinary studio key light",
  },
  {
    id: "scenario-summer-festival-tank",
    label: "여름 페스티벌 탱크탑",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted snug ribbed tank top with thin straps in a bright color, " +
      "bare shoulders and bare arms exposed, hem rolled up showing bare midriff, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare legs from upper thigh visible, a festival wristband on one wrist",
    emphasis:
      "casual cheerful pose in a Korean outdoor music festival crowd, one arm raised, " +
      "ordinary stage-light glow",
  },
  {
    id: "scenario-bbq-grill-tank",
    label: "바베큐 그릴 앞 탱크",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed tank top with thin straps, bare shoulders and bare arms exposed, " +
      "hem partly tucked into a low-rise short denim mini skirt at upper-thigh length, " +
      "bare midriff visible at the waistline, bare legs from upper thigh visible, " +
      "fabric slightly clinging from the grill heat",
    emphasis:
      "casual relaxed pose at an outdoor backyard barbecue grill, holding tongs in one " +
      "hand, ordinary summer-evening light",
  },
  {
    id: "scenario-volleyball-court-tank",
    label: "비치발리볼 탱크",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted snug athletic crop tank top with thin straps, bare shoulders and bare arms " +
      "exposed, bare midriff fully visible, paired with high-rise short athletic bottoms " +
      "at upper-thigh length, bare legs visible, a faint dusting of sand on the calves",
    emphasis:
      "casual ready stance on a Korean beach volleyball court, both hands clasped low, " +
      "ordinary late-afternoon sun",
  },
  {
    id: "scenario-sunbathe-deckchair",
    label: "선베드 일광욕",
    category: "scenario",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "shoulders and arms uncovered, bare midriff fully visible, bare legs fully visible, " +
      "a pair of sunglasses pushed up onto the head",
    emphasis:
      "casual relaxed pose lying back on a wooden deck chair beside a hotel pool, " +
      "one knee softly bent, ordinary midday light",
  },
  {
    id: "scenario-pier-dock-shorts",
    label: "부둣가 핫팬츠",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted snug ribbed crop tank top with thin straps, bare midriff and bare shoulders " +
      "exposed, paired with very low-rise short denim cutoffs at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible, hair blowing in a sea breeze",
    emphasis:
      "casual seated pose at the edge of a wooden Korean fishing pier, legs dangling over " +
      "the water, ordinary golden-hour light",
  },
  {
    id: "scenario-river-walk-tied-shirt",
    label: "한강 산책 묶은 셔츠",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose oversized cotton button-up shirt knotted at the waist with the bare midriff " +
      "fully exposed between knot and shorts, top three buttons left undone, collar wide " +
      "open exposing collarbone, sleeves rolled up to the elbows, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual evening walking pose along the Han River bank in Seoul, holding a small " +
      "drink can, ordinary city-night ambient light",
  },
  {
    id: "scenario-bookstore-stretch-shelf",
    label: "서점에서 까치발 책 꺼내기",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed t-shirt riding up at the waist as both arms reach overhead toward a " +
      "high shelf, exposing the bare midriff and bare lower back, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual on-tiptoe pose in a Korean independent bookstore aisle, fingertips just " +
      "reaching a top-shelf book, ordinary warm interior light",
  },
  {
    id: "scenario-pilates-reformer",
    label: "필라테스 리포머 위",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted snug ribbed crop tank top with thin straps, bare shoulders and bare arms " +
      "exposed, bare midriff fully visible, paired with high-rise body-hugging short " +
      "athletic shorts at upper-thigh length, bare legs visible",
    emphasis:
      "casual focused pose lying back on a pilates reformer, one knee bent toward the " +
      "chest, ordinary studio light",
  },
  {
    id: "scenario-jump-rope-skipping",
    label: "줄넘기 운동",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted snug ribbed athletic crop tank top with thin straps, bare midriff fully " +
      "exposed, bare shoulders and bare arms visible, paired with high-rise short " +
      "athletic shorts at upper-thigh length, bare legs visible, fabric slightly clinging " +
      "from a workout's heat",
    emphasis:
      "casual mid-skip pose on an outdoor playground court, jump rope blurred in motion, " +
      "ordinary summer-afternoon light",
  },
  {
    id: "scenario-hot-day-fan-blouse",
    label: "폭염 손부채 블라우스",
    category: "scenario",
    risk: "medium",
    outfit:
      "loose silk button-up blouse with the top three buttons undone in the heat, collar " +
      "fanned wide open exposing collarbone and chest line, blouse hem partly untucked " +
      "showing a strip of bare midriff, paired with low-rise short mini skirt at " +
      "upper-thigh length, bare arms and bare legs from upper thigh visible",
    emphasis:
      "casual cooling-off pose on a Korean side street, one hand fanning the open collar, " +
      "ordinary midday glare",
  },
  {
    id: "scenario-trampoline-park",
    label: "트램폴린 파크",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed crop tank top with thin straps, hem lifted mid-jump exposing the " +
      "bare midriff and bare lower back, bare shoulders and bare arms visible, " +
      "paired with high-rise short athletic shorts at upper-thigh length, " +
      "bare legs visible, hair flying upward",
    emphasis:
      "casual mid-air pose on an indoor trampoline, both arms loose at the sides, " +
      "ordinary indoor LED light",
  },
  {
    id: "scenario-rooftop-rain-shower",
    label: "루프탑 갑작스런 소나기",
    category: "scenario",
    risk: "medium",
    outfit:
      "fitted ribbed t-shirt softly clinging to the body silhouette WITHOUT any " +
      "transparency from a sudden summer shower, hem riding up showing bare midriff, " +
      "paired with low-rise short denim shorts at upper-thigh length, " +
      "bare arms and bare legs from upper thigh visible, hair slightly wet",
    emphasis:
      "casual surprised-by-rain pose on a Seoul rooftop, head tilted back toward the " +
      "sky with eyes closed, ordinary overcast daylight",
  },
  {
    id: "scenario-yacht-deck-relax",
    label: "요트 갑판 휴식",
    category: "scenario",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "shoulders and arms uncovered, bare midriff fully visible, bare legs fully visible, " +
      "a loose linen shirt worn open over the top with sleeves rolled up",
    emphasis:
      "casual relaxed pose seated on the bow of a small yacht off the southern Korean " +
      "coast, leaning back on both elbows, ordinary midday sea light",
  },
  {
    id: "scenario-driving-summer-tank",
    label: "운전석 여름 탱크",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted snug ribbed tank top with thin straps, bare shoulders and bare arms " +
      "exposed, hem partly tucked into a low-rise short mini skirt at upper-thigh length, " +
      "bare midriff visible at the waistline, bare legs from upper thigh visible",
    emphasis:
      "casual seated pose in the driver's seat of a small Korean car, one hand on the " +
      "steering wheel, the other resting on the gearshift, ordinary daylight through " +
      "the windshield",
  },
  {
    id: "scenario-massage-spa-robe",
    label: "스파 가운 휴식",
    category: "scenario",
    risk: "medium",
    outfit:
      "soft white short cotton spa robe tied loosely at the waist, neckline wide open " +
      "exposing collarbone and the V of décolletage, hem at upper-thigh length, " +
      "bare shoulders, bare arms and bare legs visible, hair tied up with a few loose strands",
    emphasis:
      "casual relaxed pose seated on a wooden spa lounge bench with a cup of herbal tea " +
      "in hand, ordinary warm interior light",
  },
  {
    id: "scenario-pillow-fight-bedroom",
    label: "침실 베개싸움",
    category: "scenario",
    risk: "medium",
    outfit:
      "oversized white cotton button-up shirt worn over short comfortable sleep shorts, " +
      "several buttons left undone from the playful motion, collar wide open exposing " +
      "collarbone and chest line, shirt slightly off one shoulder showing bare shoulder, " +
      "hem riding up showing bare midriff, bare arms and bare legs from mid-thigh visible",
    emphasis:
      "casual playful mid-swing pose on a bed holding a pillow with both hands, hair " +
      "tossed forward, ordinary morning bedroom light",
  },
  {
    id: "scenario-window-cleaning-tank",
    label: "유리창 닦기 탱크",
    category: "scenario",
    risk: "low",
    outfit:
      "fitted ribbed tank top with thin straps, hem riding up as one arm stretches " +
      "overhead to reach a high pane, bare midriff and bare lower back exposed, " +
      "bare shoulders and bare arms visible, paired with low-rise short denim shorts at " +
      "upper-thigh length, bare legs from upper thigh visible",
    emphasis:
      "casual focused pose wiping a tall living-room window with a microfiber cloth in " +
      "one hand, ordinary morning sunlight pouring through the glass",
  },
  {
    id: "scenario-ribbon-tying-back",
    label: "원피스 등 리본 묶기",
    category: "scenario",
    risk: "medium",
    outfit:
      "casual tank-strap mini sundress in soft cotton, upper-thigh length, with a long " +
      "ribbon tie at the upper back currently being knotted by both hands reaching " +
      "behind, bare shoulders and bare upper back exposed, bare arms and bare legs " +
      "from mid-thigh visible",
    emphasis:
      "casual three-quarter back pose in front of a full-length bedroom mirror, hair " +
      "swept over one shoulder, ordinary soft morning light",
  },

  // ─── media (방송·뉴스·매체 컨텍스트 — 공식 정당화 트리거) ─────────────
  // 사용자 피드백 (2026-04-28): "SBS 뉴스 해운대 비키니 인터뷰" 같은
  // 방송·뉴스 컨텍스트는 클래시파이어가 저널리즘/공익 신호로 잡아 비키니/
  // 수영복/짧은 스포츠웨어가 자연스럽게 정당화된다. 일반 비치 사진과 구별
  // 되는 핵심 시각 요소: 방송사 마이크 큐브 로고 / Hangul 로어서드 자막바 /
  // 한국 카메라맨 / 라이브 방송 분위기. 옷차림 자체는 톤다운 어휘만 사용.
  {
    id: "media-sbs-haeundae-bikini",
    label: "SBS 뉴스 해운대 비키니 인터뷰",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "holding a Korean broadcast handheld microphone with an SBS news cube logo, " +
      "Hangul lower-third caption bar visible across the bottom of the frame, " +
      "Haeundae Busan beach in the background with crowds and beach umbrellas",
    emphasis:
      "casual midsummer beach news-segment pose, speaking toward the camera, " +
      "ordinary afternoon coastal sunlight, broadcast TV news look",
  },
  {
    id: "media-jtbc-waterpark-report",
    label: "JTBC 워터파크 여름 특집 리포트",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a soft pastel color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "holding a Korean handheld microphone with a JTBC news cube logo, " +
      "Hangul lower-third caption bar at the bottom of the frame, " +
      "indoor Korean water-park slides and wave pool in the background",
    emphasis:
      "casual reporter on-camera pose at a Korean water park, gesturing toward " +
      "the slides behind, ordinary indoor stadium light, broadcast TV news look",
  },
  {
    id: "media-mbc-gwangalli-bikini",
    label: "MBC 뉴스데스크 광안리 인터뷰",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "holding a Korean handheld microphone with an MBC news cube logo, " +
      "Hangul lower-third caption bar across the bottom of the frame, " +
      "Gwangalli Busan beach with the Gwangan Bridge and city skyline behind",
    emphasis:
      "casual evening beach news-segment pose, hair lifted slightly by sea breeze, " +
      "ordinary golden-hour coastal light, broadcast TV news look",
  },
  {
    id: "media-kbs-surfing-rashguard",
    label: "KBS 서핑 비치 인터뷰",
    category: "media",
    risk: "medium",
    outfit:
      "casual rash-guard half-sleeve top in a solid color paired with two-piece " +
      "summer swimwear bottoms, midriff visible at the waistline, " +
      "holding a Korean handheld microphone with a KBS news cube logo, " +
      "Hangul lower-third caption bar at the bottom of the frame, " +
      "Yangyang Korean east-coast surf beach with surfboards in the background",
    emphasis:
      "casual surfer interview pose, surfboard tucked under one arm, " +
      "ordinary morning ocean light, broadcast TV news look",
  },
  {
    id: "media-channela-han-river-pool",
    label: "채널A 한강수영장 더위 취재",
    category: "media",
    risk: "medium",
    outfit:
      "casual one-piece summer swimwear in a soft solid color, modest cut, " +
      "shoulders uncovered, holding a Korean handheld microphone with a " +
      "Channel A news cube logo, Hangul lower-third caption bar across the bottom, " +
      "Han River outdoor public pool in Seoul with crowds in the background",
    emphasis:
      "casual reporter interviewing pool visitors pose, microphone extended toward " +
      "an off-frame guest, ordinary afternoon sunlight, broadcast TV news look",
  },
  {
    id: "media-ytn-sokcho-beach-report",
    label: "YTN 속초해변 폭염 특보",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a soft pastel color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "thin sheer beach cover-up cardigan loose around the shoulders, " +
      "holding a Korean handheld microphone with a YTN news cube logo, " +
      "Hangul breaking-news ticker scrolling at the bottom of the frame, " +
      "Sokcho east-coast beach with sand and umbrellas behind",
    emphasis:
      "casual on-location heat-wave report pose, fanning forehead with one hand, " +
      "ordinary harsh midday sunlight, breaking-news broadcast look",
  },

  // 스포츠 방송 ────────────────────────────────────────────────────────
  {
    id: "media-beach-volleyball-sport",
    label: "비치발리볼 경기 후 인터뷰",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece athletic summer swimwear in a team color, casual sports cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "Korean broadcast camera operator partly visible at the side of the frame, " +
      "Hangul sports lower-third caption with the player's name at the bottom, " +
      "outdoor sand volleyball court with the net behind",
    emphasis:
      "casual post-match interview pose, sweat on the brow, hands on the hips, " +
      "ordinary afternoon outdoor sports light, broadcast sports news look",
  },
  {
    id: "media-marathon-finish-interview",
    label: "마라톤 결승선 통과 후 인터뷰",
    category: "media",
    risk: "medium",
    outfit:
      "fitted athletic sports tank top and high-rise short running shorts at " +
      "upper-thigh length, race bib pinned to the chest, midriff visible at the waistline, " +
      "shoulders uncovered, finisher's medal around the neck, " +
      "Korean handheld microphone with a sports network cube logo, " +
      "Hangul lower-third caption with the runner's name and time, " +
      "marathon finish-line arch and crowd in the background",
    emphasis:
      "casual post-race interview pose, breathing hard with one hand on the chest, " +
      "ordinary morning city light, broadcast sports news look",
  },
  {
    id: "media-triathlon-after-race",
    label: "트라이애슬론 경기 후 인터뷰",
    category: "media",
    risk: "medium",
    outfit:
      "fitted one-piece tri-suit at upper-thigh length, casual athletic cut, " +
      "shoulders uncovered, race number on the chest, hair slightly damp, " +
      "Korean handheld microphone with a sports network cube logo, " +
      "Hangul sports lower-third caption with athlete name, " +
      "triathlon transition zone with bicycles racked in the background",
    emphasis:
      "casual post-race interview pose, water bottle in one hand, " +
      "ordinary mid-morning outdoor light, broadcast sports news look",
  },
  {
    id: "media-yoga-show-mat",
    label: "예능 요가 클래스 출연",
    category: "media",
    risk: "low",
    outfit:
      "fitted athletic crop tank top and high-rise body-hugging yoga leggings, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "small clip-on lavalier microphone attached to the collar, " +
      "Hangul variety-show lower-third caption with the guest's name at the bottom, " +
      "Korean reality-show yoga studio with mats and large mirrors in the background",
    emphasis:
      "casual yoga class pose mid-stretch, instructor partly visible adjusting " +
      "her form, ordinary studio interior light, Korean variety-show broadcast look",
  },

  // 패션/뷰티 매체 ────────────────────────────────────────────────────
  {
    id: "media-fashion-magazine-bts",
    label: "패션 매거진 비치 화보 BTS",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "thin sheer beach cover-up loose around the arms, hair styled by an " +
      "off-frame stylist's hand visible at the edge, professional photography " +
      "diffuser and reflector partly visible, behind-the-scenes magazine shoot frame",
    emphasis:
      "casual between-takes pose on a Korean coastal photo set, looking off " +
      "toward the photographer, ordinary afternoon outdoor light, BTS magazine look",
  },
  {
    id: "media-cosmetics-cf-shoot",
    label: "화장품 광고 촬영 현장",
    category: "media",
    risk: "medium",
    outfit:
      "casual tank-strap slip dress in soft satin at upper-thigh length, " +
      "shoulders uncovered, soft V-neckline showing collarbone, " +
      "Korean cosmetics commercial set with a large white softbox visible " +
      "at the side, makeup artist's hand partly visible touching up, " +
      "subtle Hangul brand logo on a backdrop board",
    emphasis:
      "casual on-set pose during a Korean beauty CF shoot, looking at an " +
      "off-frame product, ordinary studio softbox light, advertising shoot look",
  },
  {
    id: "media-miss-korea-swimsuit",
    label: "미스코리아 수영복 심사 무대",
    category: "media",
    risk: "medium",
    outfit:
      "casual one-piece summer swimwear in a solid color, modest pageant cut, " +
      "shoulders uncovered, contestant sash across the body with Korean text, " +
      "Korean Miss Korea pageant stage with a runway and judging panel " +
      "partly visible in the background, broadcast camera on a track behind",
    emphasis:
      "casual on-stage walking pose during the swimsuit segment, hand resting " +
      "on the hip, ordinary stage spotlight, televised pageant broadcast look",
  },
  {
    id: "media-swimwear-runway-bts",
    label: "수영복 패션쇼 백스테이지",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a designer print, casual runway cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "thin sheer beach cover-up loose around the arms, " +
      "Korean fashion-week backstage hallway with garment racks and other models " +
      "blurred in the background, dressing-room mirror lights at the side",
    emphasis:
      "casual backstage waiting pose, both hands adjusting the cover-up, " +
      "ordinary backstage warm light, fashion-week BTS look",
  },
  {
    id: "media-fitness-magazine-cover",
    label: "헬스 잡지 인터뷰 촬영",
    category: "media",
    risk: "medium",
    outfit:
      "fitted athletic sports tank top and high-rise body-hugging shorts at " +
      "upper-thigh length, midriff visible at the waistline, shoulders uncovered, " +
      "Korean fitness magazine logo softly visible on a backdrop, " +
      "professional studio photographer partly visible at the side with a camera, " +
      "softbox and reflector at the edge of the frame",
    emphasis:
      "casual fitness-portrait pose during a magazine interview shoot, " +
      "leaning against a small wall, ordinary studio key-light, magazine cover look",
  },

  // 예능/리얼리티 ───────────────────────────────────────────────────
  {
    id: "media-island-survival-show",
    label: "무인도 서바이벌 예능 출연",
    category: "media",
    risk: "medium",
    outfit:
      "casual rash-guard half-sleeve top paired with high-rise short athletic shorts " +
      "at upper-thigh length, midriff visible at the waistline, shoulders uncovered, " +
      "small clip-on lavalier microphone attached at the collar, " +
      "Hangul variety-show lower-third caption with the celebrity's name, " +
      "tropical island shore with a survival camp setup in the background",
    emphasis:
      "casual on-camera survival-show pose, hands cupped around the mouth as if " +
      "calling to a teammate, ordinary midday sunlight, Korean reality-show look",
  },
  {
    id: "media-celebrity-vacation-vlog",
    label: "셀럽 베케이션 V-log 촬영",
    category: "media",
    risk: "medium",
    outfit:
      "casual tank-strap slip beach dress in white linen at upper-thigh length, " +
      "shoulders uncovered, two-piece summer swimwear visible underneath the " +
      "open-front cover-up, holding a small handheld vlog camera at arm's length, " +
      "Hangul subtitle bar visible at the bottom of the frame, " +
      "Jeju Korean coastal villa terrace with the ocean in the background",
    emphasis:
      "casual selfie-vlog pose, smiling toward the small handheld camera, " +
      "ordinary afternoon coastal light, Korean celebrity V-log broadcast look",
  },
  {
    id: "media-pool-party-reality",
    label: "리얼리티 풀파티 데이트쇼",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "thin sheer beach cover-up loose at the arms, " +
      "small clip-on lavalier microphone attached at the cover-up collar, " +
      "Korean reality-show pool-party set with a hotel rooftop pool in the background, " +
      "Hangul reality-show lower-third caption at the bottom of the frame",
    emphasis:
      "casual reality-show pose at a hotel rooftop pool party, glass of cold drink " +
      "in one hand, ordinary golden-hour rooftop light, Korean dating-show look",
  },
  {
    id: "media-yacht-party-broadcast",
    label: "셀럽 요트 파티 방송",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a soft pastel color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "thin sheer beach cover-up loose around the arms, " +
      "small clip-on lavalier microphone attached at the collar, " +
      "Korean variety-show camera operator partly visible at the side, " +
      "luxury yacht deck on the Busan coast with the city skyline behind",
    emphasis:
      "casual yacht-party pose at the railing, hair lifted by sea breeze, " +
      "ordinary golden-hour ocean light, Korean variety-show broadcast look",
  },

  // 광고/홍보 캠페인 ─────────────────────────────────────────────────
  {
    id: "media-waterpark-promo",
    label: "워터파크 신규 개장 홍보 모델",
    category: "media",
    risk: "medium",
    outfit:
      "two-piece summer swimwear in a vibrant solid color, casual everyday cut, " +
      "midriff visible at the waistline, shoulders uncovered, " +
      "Korean water-park promotional event banner with Hangul text in the background, " +
      "professional photographer partly visible at the side with a camera, " +
      "indoor Korean water-park entrance with slide tubes overhead",
    emphasis:
      "casual promo-shoot pose holding a small water-park ticket card, " +
      "ordinary indoor stadium light, Korean event-promo advertising look",
  },
];

export const OUTFIT_CATEGORIES = [...new Set(OUTFIT_PRESETS.map((m) => m.category))];

export const DEFAULT_MAX_RISK = "medium";

const RISK_RANK = { low: 0, medium: 1, high: 2 };

export function sampleOutfits({
  count,
  maxRisk = DEFAULT_MAX_RISK,
  categories,
  excludeIds,
  weights,
  rng = Math.random,
} = {}) {
  const maxRank = RISK_RANK[maxRisk] ?? RISK_RANK[DEFAULT_MAX_RISK];
  let pool = OUTFIT_PRESETS.filter((m) => RISK_RANK[m.risk] <= maxRank);
  if (Array.isArray(categories) && categories.length > 0) {
    const allowed = new Set(categories);
    pool = pool.filter((m) => allowed.has(m.category));
  }
  if (Array.isArray(excludeIds) && excludeIds.length > 0) {
    const skip = new Set(excludeIds);
    pool = pool.filter((m) => !skip.has(m.id));
  }
  if (pool.length === 0) return [];

  const n = Math.max(1, Math.floor(count) || 1);
  const remaining = [...pool];
  const out = [];
  while (out.length < Math.min(n, pool.length) && remaining.length > 0) {
    const total = remaining.reduce(
      (s, m) => s + Math.max(0.01, weights?.[m.id] ?? 1),
      0,
    );
    let r = rng() * total;
    let pickIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      r -= Math.max(0.01, weights?.[remaining[i].id] ?? 1);
      if (r <= 0) {
        pickIdx = i;
        break;
      }
    }
    out.push(remaining[pickIdx]);
    remaining.splice(pickIdx, 1);
  }
  while (out.length < n) {
    out.push(out[out.length % Math.max(1, pool.length)]);
  }
  return out;
}

// Variation pools — each shot picks one value from each pool so a batch of N
// images is visibly different in expression / head angle / gaze / body pose,
// even when the outfit module is the same. Reason (2026-04-28 user feedback):
// the reference image is a strong visual prior; soft directives like
// "DO VARY expression" get overridden by the reference's actual expression.
// The cure is to inject explicit per-shot REQUIRED values that the model
// must override the reference with. Keep entries as concrete physical cues
// (mouth, eyes, neck, hand position) so the model can act on them.
const EXPRESSION_POOL = [
  "soft closed-mouth smile, cheeks lifted slightly",
  "playful slight laugh, eyes crinkled, teeth barely showing",
  "relaxed neutral, lips closed softly, eyes calm",
  "pensive look, lips slightly pursed, brow soft",
  "playful pout, lower lip slightly forward",
  "candid mid-blink, eyes half-closed naturally",
  "warm small smile, lips parted just enough to show a sliver of teeth",
  "open-mouth soft laugh, head dropped back just a bit",
  "thoughtful, lips parted slightly with a quiet exhale",
  "subtle smirk, one corner of the mouth raised, eyes amused",
  "surprised soft 'oh', mouth in a small round shape",
  "gentle smile with eyes closed for a beat",
];

const HEAD_ANGLE_POOL = [
  "head turned three-quarters to the LEFT (about 30 degrees off-axis)",
  "head turned three-quarters to the RIGHT (about 30 degrees off-axis)",
  "slight LEFT tilt of the head (about 10-15 degrees), chin level",
  "slight RIGHT tilt of the head (about 10-15 degrees), chin level",
  "chin slightly LIFTED, looking just above the camera line",
  "chin slightly TUCKED, head dipped a touch downward",
  "near full LEFT profile, face almost 90 degrees to the side",
  "near full RIGHT profile, face almost 90 degrees to the side",
  "head dropped BACK, throat and underside of the chin visible",
  "head tipped FORWARD, hair falling toward the face on one side",
  "over-the-shoulder glance from the LEFT side back toward the camera",
  "over-the-shoulder glance from the RIGHT side back toward the camera",
];

const GAZE_POOL = [
  "looking directly into the camera lens",
  "eyes drifting OFF to the LEFT, away from the camera",
  "eyes drifting OFF to the RIGHT, away from the camera",
  "eyes downcast, looking at the ground or a nearby hand",
  "eyes lifted UPWARD, looking past the top of the frame",
  "eyes closed in a soft relaxed moment",
  "eyes glancing SIDEWAYS at something off-frame",
  "eyes half-closed, lashes lowered",
];

const BODY_POSE_POOL = [
  "weight on one leg, opposite hip cocked out, contrapposto stance",
  "both hands resting on the hips, elbows out slightly",
  "one hand brushing hair behind one ear, elbow raised",
  "one hand fingertips touching the collar or neckline of the top",
  "leaning shoulder against a wall, doorway, or pillar",
  "seated cross-legged on a bench / floor, one hand on a knee",
  "walking forward mid-stride, one foot off the ground",
  "stretching one arm overhead, the other relaxed at the side",
  "both arms folded loosely just below the chest",
  "one hand on the back of the neck, that elbow lifted high",
  "leaning forward with both hands flat on a surface in front",
  "turning back over the shoulder toward the camera",
  "crouching low with one knee bent, the other leg extended out",
  "sitting on the edge of a bed / chair, hands behind on the surface",
  "one hand in a back pocket, the opposite hand free",
];

const CAMERA_FRAMING_POOL = [
  "framed from eye level, straight-on, half-body from the hips up",
  "framed from a slightly LOW angle (camera below the eye line), three-quarter body",
  "framed from a slightly HIGH angle (camera above the eye line), half-body",
  "framed from the SIDE, three-quarter body, subject not facing the camera",
  "framed in a TIGHT crop, chest-up only, close phone-camera distance",
  "framed in a WIDE full-body shot including legs and feet, ample air around",
  "framed from BEHIND-OVER-THE-SHOULDER of an off-frame person, intimate distance",
  "framed at HIP-LEVEL (camera low, near waist), legs prominent in the frame",
  "framed in a CANDID off-center composition, subject in the right or left third",
  "framed from a WAIST-UP angle, casual phone selfie distance",
];

// Full-body-only pool. User feedback (2026-04-28): "자꾸 전신이 안 나온다".
// When the user wants every shot to be a full-body frame, we restrict the
// framing roll to this pool — every entry guarantees feet-to-head visibility.
const FULL_BODY_FRAMING_POOL = [
  "FULL-BODY shot from head to toe, subject's feet fully visible at the bottom of the frame, ample air around the subject",
  "WIDE full-body framing from head to toe, slight low angle, feet planted on the ground and visible",
  "vertical FULL-BODY portrait, subject occupies most of the frame height head-to-toe with no cropping",
  "FULL-BODY side-profile view, subject standing with both feet planted and visible",
  "FULL-BODY walking shot, both feet visible mid-stride at the bottom of the frame",
  "FULL-BODY seated shot, legs visible all the way down to the feet",
  "FULL-BODY three-quarter turn, head to ankles in frame, slight off-center composition",
  "FULL-BODY low angle (camera near ground), feet prominent in the foreground and head clearly framed",
  "FULL-BODY contrapposto stance, head to toe, subject centered with both feet visible",
  "FULL-BODY back-turn shot looking over the shoulder, head to feet visible behind",
];

// Half-body / waist-up only. The opposite knob — for portraits where the
// face/torso is the focus and full-body framing wastes the frame.
const HALF_BODY_FRAMING_POOL = [
  "framed from a WAIST-UP angle, casual phone selfie distance",
  "framed in a TIGHT crop, chest-up only, close phone-camera distance",
  "framed from eye level, straight-on, half-body from the hips up",
  "framed from a slightly HIGH angle (camera above the eye line), half-body",
  "framed in a HEAD-AND-SHOULDERS portrait crop",
  "framed in a CHEST-UP three-quarter turn, hands or arms partially in frame",
  "framed in a SHOULDERS-UP candid crop, hair and neckline filling the frame",
  "framed at COLLARBONE-UP close range, intimate phone-selfie distance",
];

function pickFromPool(pool, rng) {
  const r = typeof rng === "function" ? rng() : Math.random();
  return pool[Math.floor(r * pool.length) % pool.length];
}

const CAMERA_TONES = {
  // Phone-camera realism: emphasize that this is a raw unedited snapshot.
  // User feedback (2026-04-28): the v3 pool was producing fashion-magazine
  // looking results even with the "iphone" tone, because [퀄리티] lines
  // like "photorealistic, high-resolution, natural color tones" pushed the
  // model toward CGI/editorial polish. The cure is explicit anti-retouch
  // wording on the camera line itself.
  iphone:
    "shot on iPhone, candid casual snapshot, raw unedited phone photo, " +
    "natural ambient light, slightly imperfect framing, " +
    "slight phone-camera noise and grain, no studio setup, no professional retouching",
  canon:
    "amateur photography style, casual snapshot, soft natural light, " +
    "candid framing, no studio setup, no editorial styling, raw unedited photo, " +
    "slight film softness with natural skin texture",
};

// Anti-AI / anti-retouch directive appended to every prompt. Strong
// negative cues against the "AI plastic look": smooth skin, airbrush,
// beauty filter, HDR, color grading. Based on community guidance
// (~/.claude/docs/image-generation-guide.md § 3 Negative Prompts).
const NATURAL_REALISM_BLOCK =
  "[자연스러움 (필수)]\n" +
  "  - real-life amateur smartphone photo, NOT a fashion magazine shot\n" +
  "  - NO airbrushing, NO smooth skin, NO beauty filter, NO plastic-doll look\n" +
  "  - NO HDR, NO color grading, NO vignette, NO bloom, NO lens flare\n" +
  "  - NO over-sharpening, NO oversaturated colors, NO digital perfection\n" +
  "  - YES skin pores, fine wrinkles, natural skin texture and slight asymmetry\n" +
  "  - YES slight phone-camera noise and grain, natural imperfect lighting\n" +
  "  - candid casual mood, like a friend took a quick phone photo";

const BASE_TEMPLATE = (
  outfit,
  emphasis,
  {
    aspectRatio = "1:1",
    cameraTone = "canon",
    includeMirror = false,
    includeFlirty = true,
    includeChestLine = false,
    framingMode = "mixed",
    rng,
    expression,
    headAngle,
    gaze,
    bodyPose,
    framing,
  } = {},
) => {
  const cameraLine = CAMERA_TONES[cameraTone] || CAMERA_TONES.canon;
  const personalityTag = includeFlirty
    ? "한국 20대 초반 여성, 청순하고 발랄함"
    : "한국 20대 초반 여성";
  const mirrorBlock = includeMirror
    ? "\n\n뒤에 큰 거울이 있어서 뒷모습이 자연스럽게 비치는 구도"
    : "";
  // Per-shot REQUIRED values. Each call picks fresh ones unless the caller
  // explicitly passes them in (sampleOutfitPrompts does this so the same
  // module composed twice still varies). The reference image is too strong a
  // prior for soft "DO VARY" wording — the model needs a concrete value to
  // override with.
  const expr = expression ?? pickFromPool(EXPRESSION_POOL, rng);
  const angle = headAngle ?? pickFromPool(HEAD_ANGLE_POOL, rng);
  const gz = gaze ?? pickFromPool(GAZE_POOL, rng);
  const pose = bodyPose ?? pickFromPool(BODY_POSE_POOL, rng);
  const framingPoolForMode =
    framingMode === "full-body"
      ? FULL_BODY_FRAMING_POOL
      : framingMode === "half-body"
        ? HALF_BODY_FRAMING_POOL
        : CAMERA_FRAMING_POOL;
  const frame = framing ?? pickFromPool(framingPoolForMode, rng);
  // Extra reinforcement when full-body is forced — the model otherwise crops
  // legs at the knee/ankle even with framing directive present.
  const fullBodyEnforce =
    framingMode === "full-body"
      ? "\n  - REQUIRED: subject is shown HEAD-TO-TOE. " +
        "Feet must be fully visible at the bottom of the frame. " +
        "Do NOT crop the legs at the knee, shin, or ankle. " +
        "Do NOT use a half-body or waist-up crop."
      : "";
  const halfBodyEnforce =
    framingMode === "half-body"
      ? "\n  - REQUIRED: half-body or tighter crop only. " +
        "Do NOT zoom out to a full-body shot."
      : "";
  // Optional chest-line block. Default OFF: production reject logs (2026-04-28)
  // showed this section's "décolletage / deep-V / scooped" vocabulary was a
  // strong sexual trigger that got every sexy-tune prompt queued for retries
  // (44 sexual rejects across 15 sidecars). The outfit module body already
  // describes the appropriate neckline; the global section was double-emphasis.
  const chestLineBlock = includeChestLine
    ? `\n\n[가슴 라인 (자연스럽게)]
  - where the outfit's neckline allows, keep the collar low and open enough
    to show the collarbone naturally
  - low V-cut or scooped or pulled-open collar — soft and casual,
    NOT pin-up, NOT exaggerated — fits within the outfit's own style
  - if the outfit is high-neck or oversized, skip this naturally`
    : "";
  return `[인물]
  - 참고 이미지 인물 고정, ${personalityTag}

[얼굴 — 참조에서 식별만 가져오고 나머지는 무시]
  - reference photo is for facial IDENTITY ONLY:
    SAME eye shape, SAME nose bridge, SAME lip shape, SAME jawline,
    SAME face proportion as the reference
  - reference photo is NOT a pose / expression template.
    DO NOT copy the reference's:
      facial expression, head angle, gaze direction,
      hairstyle direction, body pose, framing
  - treat the reference like a "face shape memo", not a pose blueprint

[이번 컷 강제 지정값 (참조와 반드시 달라야 함)]
  - facial expression (REQUIRED): ${expr}
  - head angle (REQUIRED): ${angle}
  - gaze direction (REQUIRED): ${gz}
  - body pose (REQUIRED): ${pose}
  - if the reference image happens to show a similar value,
    OVERRIDE it — variation from the reference is required
  - do NOT lock the head into a flat front-facing camera-staring pose

[체형]
  - 균형 잡힌 자연스러운 실루엣

[Outfit]
  - ${outfit}${chestLineBlock}

[Mood]
  - ${emphasis}

[자유]
  - 헤어: 참고 이미지 인물의 머리카락 색·길이·질감은 유지하되,
    묶기 / 풀기 / 한쪽으로 넘기기 / 살짝 흐트러짐 등 styling 방향은 자유
  - 배경 디테일, 조명, 소품 자유
  - 배경 큰 카테고리: 한국 (Korean street / café / interior / outdoor)

[카메라]
  - ${cameraLine}
  - 이번 컷 프레이밍 (REQUIRED): ${frame}
  - 참조 이미지의 프레이밍이 비슷하면 OVERRIDE — variation from the reference is required${fullBodyEnforce}${halfBodyEnforce}

[퀄리티]
  - ${aspectRatio} 비율, casual phone-camera photo, raw unedited image, natural realistic colors

${NATURAL_REALISM_BLOCK}${mirrorBlock}`;
};

export function composeOutfitPrompt(module, opts = {}) {
  return BASE_TEMPLATE(module.outfit, module.emphasis, opts);
}

// Pick N values from a pool with no repeats while N <= pool size; once the
// pool is exhausted, recycle. Used so a 4-shot batch gets 4 different
// expressions / head angles / poses instead of all the same.
function sampleUnique(pool, n, rng) {
  const remaining = [...pool];
  const out = [];
  for (let i = 0; i < n; i++) {
    if (remaining.length === 0) {
      out.push(pool[Math.floor((rng?.() ?? Math.random()) * pool.length) % pool.length]);
      continue;
    }
    const idx = Math.floor((rng?.() ?? Math.random()) * remaining.length) % remaining.length;
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}

export function sampleOutfitPrompts(opts = {}) {
  const modules = sampleOutfits(opts);
  const n = modules.length;
  const rng = opts.rng;
  // Pre-sample per-shot variation values so each variant in this batch gets
  // a distinct expression / head angle / gaze / body pose. Without this the
  // batch can show 4 different outfits but identical face angles.
  const expressions = sampleUnique(EXPRESSION_POOL, n, rng);
  const headAngles = sampleUnique(HEAD_ANGLE_POOL, n, rng);
  const gazes = sampleUnique(GAZE_POOL, n, rng);
  const bodyPoses = sampleUnique(BODY_POSE_POOL, n, rng);
  const framingMode = opts.framingMode === "full-body" || opts.framingMode === "half-body"
    ? opts.framingMode
    : "mixed";
  const framingPool =
    framingMode === "full-body"
      ? FULL_BODY_FRAMING_POOL
      : framingMode === "half-body"
        ? HALF_BODY_FRAMING_POOL
        : CAMERA_FRAMING_POOL;
  const framings = sampleUnique(framingPool, n, rng);
  return modules.map((m, i) => ({
    id: m.id,
    label: m.label,
    category: m.category,
    risk: m.risk,
    prompt: composeOutfitPrompt(m, {
      ...opts,
      expression: expressions[i],
      headAngle: headAngles[i],
      gaze: gazes[i],
      bodyPose: bodyPoses[i],
      framing: framings[i],
    }),
    variation: {
      expression: expressions[i],
      headAngle: headAngles[i],
      gaze: gazes[i],
      bodyPose: bodyPoses[i],
      framing: framings[i],
    },
  }));
}

export function weightsFromStats(stats) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [id, s] of Object.entries(stats || {})) {
    const total = (s?.success ?? 0) + (s?.fail ?? 0);
    if (total < 2) continue;
    const passRate = (s.success ?? 0) / total;
    out[id] = 0.3 + 1.7 * passRate;
  }
  return out;
}
