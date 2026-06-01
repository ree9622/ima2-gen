# 01 — xAI Grok Imagine Video API 전체 계약 표면

Source: https://docs.x.ai/developers/model-capabilities/imagine (2026-05-12 기준)

---

## 현재 ima2가 쓰는 것

| 기능 | 엔드포인트 | ima2 구현 |
|------|-----------|----------|
| Text-to-Video | `POST /v1/videos/generations` | ✅ |
| Image-to-Video | `POST /v1/videos/generations` + `image: {url}` | ✅ |
| Reference-to-Video | `POST /v1/videos/generations` + `reference_images` | ✅ |

---

## xAI가 지원하는데 ima2에서 안 쓰는 것 ❌

### 1. Video Editing (진짜 V2V)
**엔드포인트**: `POST /v1/videos/edits`
```json
{
  "model": "grok-imagine-video",
  "prompt": "Give the woman a silver necklace",
  "video": { "url": "https://..." }
}
```
- 기존 비디오를 텍스트로 편집 (배경 변경, 객체 추가/제거, 스타일 변경)
- 입력 비디오: mp4, 최대 8.7초, H.264/H.265/AV1
- 출력: 입력과 동일한 duration/aspect/resolution (최대 720p)
- duration/aspect_ratio/resolution 파라미터 무시됨 (입력 따라감)

### 2. Video Extension (이어붙이기)
**엔드포인트**: `POST /v1/videos/extensions`
```json
{
  "model": "grok-imagine-video",
  "prompt": "The shot pans to an over the shoulder perspective",
  "duration": 10,
  "video": { "url": "https://..." }
}
```
- 기존 비디오의 마지막 프레임에서 이어서 생성
- 입력 비디오: 2-15초
- extension duration: 2-10초 (기본 6초)
- 출력: 원본 + 확장 합쳐진 하나의 비디오 (예: 10초 원본 + 5초 확장 = 15초)
- aspect_ratio/resolution 무시 (입력 따라감, 최대 720p)

### 3. Reference-to-Video (이미 구현됨 — 확인용)
**엔드포인트**: `POST /v1/videos/generations`
```json
{
  "model": "grok-imagine-video",
  "prompt": "...",
  "reference_images": [{"url": "..."}, ...],
  "duration": 10
}
```
- 최대 7개 레퍼런스 이미지
- 캐릭터/스타일/설정 일관성 유지

---

## API 엔드포인트 정리

| 엔드포인트 | 용도 | ima2 상태 |
|-----------|------|----------|
| `POST /v1/videos/generations` | T2V, I2V, Ref2V | ✅ 구현됨 |
| `POST /v1/videos/edits` | Video Editing (V2V) | ❌ 미구현 |
| `POST /v1/videos/extensions` | Video Extension (이어붙이기) | ❌ 미구현 |
| `GET /v1/videos/{request_id}` | 상태 폴링 | ✅ 구현됨 |

---

## 구현 계획

### Video Extension (우선순위 높음)
- 현재 "V2V"라고 부르던 것의 **진짜 해결책**
- canvas last-frame 추출 대신 API가 직접 비디오를 이어붙여줌
- 노드 모드에서: 부모가 비디오 → 자식 생성 시 `/v1/videos/extensions` 호출
- CLI: `ima2 video "다음 장면" --extend video.mp4 --duration 5`

### Video Editing (우선순위 중간)
- 기존 비디오의 스타일/객체 편집
- 노드 모드에서: 비디오 노드에 "편집" 버튼 추가
- CLI: `ima2 video "배경을 우주로 바꿔" --edit video.mp4`

---

## 핵심 인사이트

1. **Video Extension이 진짜 V2V다** — 마지막 프레임 추출 같은 해킹 불필요. API가 원본 비디오를 받아서 이어서 생성해줌.
2. **Video Editing이 진짜 스타일 변환이다** — 비디오 입력 → 텍스트로 편집 → 같은 모션 유지하면서 스타일만 변경.
3. **둘 다 비디오 URL을 입력으로 받음** — ima2 서버에서 생성된 비디오의 URL을 그대로 전달하면 됨.
4. **Multi-shot은 Extension 반복으로 구현** — 5초 생성 → 5초 extension → 5초 extension = 15초 연결 비디오.

---

## progrok 프록시 확인 필요

현재 progrok이 `/v1/videos/generations`만 프록시하는지, `/v1/videos/edits`와 `/v1/videos/extensions`도 프록시하는지 확인 필요.

---

## Smoke Test 결과 (2026-05-31 21:57 KST)

### progrok 프록시 경유 확인

| 엔드포인트 | progrok 프록시 | xAI 응답 |
|-----------|--------------|----------|
| `POST /v1/videos/extensions` | ✅ 통과 | ✅ request_id 반환 |
| `POST /v1/videos/edits` | ✅ 통과 | ✅ request_id 반환 |
| `GET /v1/videos/{id}` | ✅ 통과 | ✅ status/video.url 반환 |

### 모델별 지원 확인 (실제 테스트)

| 기능 | grok-imagine-video | grok-imagine-video-1.5-preview |
|------|-------------------|-------------------------------|
| Video Generation (T2V) | ✅ | ⚠️ (T2V 미지원, white canvas 해킹) |
| Image-to-Video | ✅ | ✅ |
| Reference-to-Video | ✅ | ✅ |
| **Video Extension** | ✅ 확인됨 (20초 소요) | ❌ "not supported for this model" |
| **Video Editing** | ✅ 확인됨 (30초 소요) | ❌ "not supported for this model" |

### 실제 스모크 결과

**Video Extension** (grok-imagine-video):
- 입력: 3초 바다 영상 + "The camera slowly pulls back"
- 결과: 3초 확장 성공, 20초 소요
- 출력 URL: `https://vidgen.x.ai/xai-vidgen-bucket/xai-video-b03dc324-...mp4`

**Video Editing** (grok-imagine-video):
- 입력: 3초 바다 영상 + "Make the water glow neon blue like a bioluminescent ocean"
- 결과: 스타일 변환 성공, 30초 소요
- 출력 URL: `https://vidgen.x.ai/xai-vidgen-bucket/xai-video-7b0b2d12-...mp4`

### 최종 확정

- **Video Extension + Editing은 `grok-imagine-video` (base) 전용**
- **1.5-preview는 generation/I2V/Ref2V만 지원**
- **OAuth (SuperGrok via progrok) 경유 동작 확인됨**
- **canvas last-frame 해킹 불필요 — Extension API가 진짜 V2V**
