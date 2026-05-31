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
