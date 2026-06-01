# 00 — Video Integration Parity Audit & Implementation

## Summary

비디오 기능이 클래식 모드에서는 완전하지만 노드/에이전트/CLI에서 빈약한 부분을 감사하고 구현 완료.

---

## Feature 1: Agent Mode Video — Dead Code Activation

### 현재 상태
- `runAgentVideoGeneration()` 함수 존재 (lib/agentRuntime.ts:401)
- `ima2.generate_video` tool 선언됨 (lib/agentTypes.ts:5)
- 하지만: 라우트 없음, 큐 워커 연동 없음, 프론트엔드 트리거 없음
- 하드코딩: duration=5, resolution=480p, mode=text-to-video only

### 변경

**MODIFY** `routes/agent.ts` — POST `/api/agent/video` 엔드포인트 추가
- sessionId + prompt 받아서 `runAgentVideoGeneration()` 호출
- SSE 스트리밍은 불필요 (agent는 비동기 큐 기반)

**MODIFY** `lib/agentRuntime.ts` — `runAgentVideoGeneration` 파라미터 확장
- duration, resolution, aspectRatio, sourceImage 옵션 추가
- I2V 지원: sourceImage가 있으면 mode="image-to-video"

**MODIFY** `lib/agentQueueWorker.ts` — video plan 분기 추가
- plan.mode === "video" 일 때 `runAgentVideoGeneration` 호출

**MODIFY** `lib/agentRuntime.ts` — generation planner에 video 분기
- 사용자 프롬프트에 "video", "animate", "동영상", "비디오" 키워드 → video plan 생성

---

## Feature 2: CLI `--topic` Flag

### 현재 상태
- 서버 `/api/video/generate`는 `topic` 파라미터 지원
- CLI `bin/commands/video.ts`에 `--topic` 플래그 없음

### 변경

**MODIFY** `bin/commands/video.ts`
- SPEC.flags에 `topic: { type: "string" }` 추가
- HELP에 `--topic <text>` 설명 추가
- body에 `if (args.topic) body.topic = args.topic` 추가

---

## Feature 3: Node Mode — Animate Button (I2V)

### 현재 상태
- Classic mode: ResultActions에 "Animate" 버튼 → `animateImage(filename, prompt)`
- Node mode: 없음

### 변경

**MODIFY** `ui/src/components/ImageNode.tsx`
- ready 상태 + imageUrl이 비디오가 아닐 때 "▶" (animate) 버튼 추가
- 클릭 시 `animateImage(serverNodeId + ext, prompt)` 호출
- 또는 새 자식 노드 생성 후 video model로 생성

실제 구현: 노드의 이미지를 sourceImage로 사용하여 자식 노드에서 비디오 생성
- "▶" 클릭 → 자식 노드 추가 → videoModelSelected 임시 설정 → generateNode

더 간단한 접근: store에 `animateNode(clientId)` 추가
- 현재 노드의 serverNodeId로 파일명 구성
- `animateImage(filename, prompt)` 호출 (기존 classic 로직 재사용)

### 변경 (최종)

**MODIFY** `ui/src/components/ImageNode.tsx`
- ready + non-video 상태에서 "▶" 버튼 추가
- onClick → `animateImage(d.serverNodeId + ".png", d.prompt)` (format 감지 필요)

**MODIFY** `ui/src/store/useAppStore.ts`
- `animateNode(clientId)` 함수 추가: 노드의 filename을 구성하여 animateImage 호출
- 결과를 새 자식 노드로 반영

---

## Feature 4: Agent-Friendly CLI Surface Review

### 현재 상태
- `ima2 video --help` 출력은 이미 agent-friendly
- capabilities.ts에 video 설명 있음
- 하지만 `--topic` 누락, `--source-image` 직접 지정 불가

### 변경

**MODIFY** `bin/commands/video.ts`
- `--source-image <file>` 플래그 추가 (--ref 1개와 동일하지만 의미 명확)
- 이미 --ref 1개 = I2V이므로 alias 역할

**MODIFY** `lib/capabilities.ts`
- video capabilities 설명에 `--topic` 추가

---

## Implementation Order

1. CLI `--topic` (가장 간단)
2. Agent mode video activation (라우트 + 큐 워커)
3. Node mode animate button
4. CLI surface review (--source-image alias + capabilities update)

## Success Criteria

- `npx tsc --noEmit` pass (server + UI)
- `npm test` pass (기존 package-smoke 제외)
- CLI: `ima2 video "test" --topic "series1"` → 서버에 topic 전달 확인
- Agent: video plan 생성 → 큐 처리 → 비디오 파일 생성
- Node: animate 버튼 → 비디오 생성 → 노드에 표시
