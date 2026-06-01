# 01 — Video Integration Parity Audit Report

## Audit Date: 2026-05-31

## Executive Summary

비디오 기능이 클래식 모드에서는 완전하지만 노드/에이전트/CLI에서 빈약했던 부분을 감사하고 수정 완료.

---

## Findings & Resolutions

### 1. Node Mode — Video Not Rendering ❌→✅

**증상**: 노드에서 비디오 생성 후 `🖼️ 노드 이미지` (깨진 이미지 아이콘) 표시
**원인**: `ImageNode.tsx`에 `<video>` 렌더링 코드 없음 — `<img>` 태그만 존재
**수정**: `isVideoUrl()` 체크 후 `<video controls loop playsInline muted>` 렌더링
**파일**: `ui/src/components/ImageNode.tsx`

### 2. Node Mode — Parent Image Not Used as Reference ❌→✅

**증상**: 자식 노드에서 비디오 생성 시 부모 이미지를 레퍼런스로 안 씀
**원인**: `runVideoGenerate`가 `parentServerNodeId`를 통한 부모 이미지 로드 로직 없음
**수정**: 부모 노드의 이미지를 `sourceImage`로 전달 (I2V 모드)
**파일**: `ui/src/store/useAppStore.ts`

### 3. Node Mode — No Pending State During Video Generation ❌→✅

**증상**: 비디오 생성 중 노드가 pending 상태로 안 바뀜, 결과도 노드에 반영 안 됨
**원인**: `runVideoGenerate`가 응답값을 무시하고 노드 상태 업데이트 안 함
**수정**: 생성 시작 시 pending 마킹, 완료 시 imageUrl/status 업데이트
**파일**: `ui/src/store/useAppStore.ts`

### 4. Node Mode — Spinner Not Visible ❌→✅

**증상**: 이미지 생성 중 border spin + skeleton 안 보임
**원인 1**: `-webkit-mask-composite: source-out` → Chrome에서 mask 무효화
**원인 2**: `.image-node__skeleton`에 시각적 피드백 없음 (빈 div)
**수정**: `xor`로 변경 + shimmer 애니메이션 추가
**파일**: `ui/src/index.css`

### 5. Agent Mode — Dead Code (generate_video unreachable) ❌→✅

**증상**: `runAgentVideoGeneration()` 존재하지만 호출 경로 없음
**원인**: 라우트 없음, 큐 워커 연동 없음, planner에 video 분기 없음
**수정**:
- `AgentGenerationPlanMode`에 `"video"` 추가
- `deriveAgentGenerationPlan`에 video intent 감지 (키워드 매칭)
- `runAgentGenerationPlan`에 `plan.mode === "video"` 분기 → `runAgentVideoGeneration` 호출
**파일**: `lib/agentTypes.ts`, `lib/agentGenerationPlanner.ts`, `lib/agentRuntime.ts`

### 6. CLI — Missing `--topic` Flag ❌→✅

**증상**: 서버는 `topic` 파라미터 지원하지만 CLI에서 접근 불가
**수정**: `--topic <text>` 플래그 추가, HELP 업데이트, body에 전달
**파일**: `bin/commands/video.ts`

### 7. Node Mode — No Animate Button ❌→✅

**증상**: 클래식 모드에는 "Animate" 버튼이 있지만 노드 모드에는 없음
**수정**: ready + non-video 상태에서 "▶" 버튼 추가 → `animateImage()` 호출
**파일**: `ui/src/components/ImageNode.tsx`

### 8. Capabilities Description Outdated ❌→✅

**수정**: video help string에 `--topic` 언급 추가
**파일**: `lib/capabilities.ts`

---

## Remaining Items (Low Priority)

| Item | Status | Notes |
|------|--------|-------|
| Agent video: I2V support | ⚠️ | 현재 T2V만 지원. sourceImage 파라미터 추가 가능 |
| Agent video: duration/resolution 설정 | ⚠️ | 하드코딩 5s/480p. AgentGenerationSettings 확장 필요 |
| Node video progress per-node | ⚠️ | 글로벌 videoProgress 사용 중. 동시 생성 시 혼동 가능 |
| Server-side video thumbnails | ⚠️ | 브라우저 preload=metadata 의존 |

---

## Verification

- `npx tsc --noEmit` — ✅ server + UI 모두 통과
- `npm test` — 843/848 pass (5 pre-existing package-smoke failures)
- Commits: 137d800, 2d865b8, 2c7dd5a
