# 00 — Video Series (Topic + Chain) + Agent Video Tool + Trash Fallback

## Summary

3가지 기능을 ima2-gen에 추가:
1. **삭제 폴백** — `moveToSystemTrash` 실패 시 내부 `.trash/` 폴더로 rename
2. **비디오 시리즈** — topic(고정 주제) + 최근 4개 revisedPrompt 체인을 planner에 전달
3. **Agent video tool** — `ima2.generate_video` tool 추가 (Grok 경유)

---

## Feature 1: Trash Fallback

### 현재 동작
- `trashAsset()` → `moveToSystemTrash()` 실패 시 500 에러 throw
- `deleteAssetPermanent()` → `unlink()` 직접 호출

### 변경
- `trashAsset()` 에서 `moveToSystemTrash()` 실패 시 내부 `.trash/` 폴더로 `rename()`
- 영구삭제는 내부 `.trash/`에서 `unlink()` (이미 구현됨 — `deleteAssetPermanent`는 generatedDir 기준이므로 별도 변경 불필요)

### Files

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/lib/assetLifecycle.ts`

```diff
- try {
-   await moveToSystemTrash(paths);
- } catch (cause) {
-   const err: any = new Error("Could not move asset to system trash");
-   err.status = 500;
-   err.code = "SYSTEM_TRASH_FAILED";
-   err.cause = cause;
-   throw err;
- }
+ let trashMethod: "system" | "internal" = "system";
+ try {
+   await moveToSystemTrash(paths);
+ } catch {
+   // Fallback: move to internal .trash/ directory
+   trashMethod = "internal";
+   const trashDir = resolve(config.storage.trashDir);
+   await mkdir(trashDir, { recursive: true });
+   const trashId = `${Date.now()}_${filename}`;
+   for (const p of paths) {
+     const dest = resolve(trashDir, trashId + (p.endsWith(".json") ? ".json" : ""));
+     await rename(p, dest);
+   }
+ }
```

Return value에 `trash: trashMethod` 반영 (기존 `"system"` → 동적).

---

## Feature 2: Video Series (Topic + Prompt Chain)

### 개념
- **topic**: 시리즈 전체에 걸쳐 유지되는 고정 프롬프트 (예: "한국 여행 브이로그")
- **chain**: 같은 topic의 최근 4개 revisedPrompt를 planner에 전달
- 저장: 비디오 메타 `.json` sidecar에 `videoSeries: { topic, chainIndex }` 추가
- UI: VideoControlsPanel 상단에 조건부 "시리즈 주제" 필드

### Files

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/routes/video.ts`
- Request body에 `topic?: string` 파라미터 추가
- 메타에 `videoSeries: { topic, chainIndex }` 저장
- 응답 `done` 이벤트에 `videoSeries` 포함

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/lib/historyList.ts`
- `listHistoryRows()` 반환에 `videoSeries` 필드 추가 (sidecar에서 읽기)

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/ui/src/store/useAppStore.ts`
- State: `videoTopic: string`, `setVideoTopic(topic: string)`
- `animateImage` / video generate 호출 시 `topic` 전달
- `newFromHere` (continueHere) 시 이전 비디오의 topic 자동 로드

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/ui/src/components/VideoControlsPanel.tsx`
- 비디오 모드일 때 상단에 "시리즈 주제" 텍스트 필드 추가
- 이전 체인 표시 (최근 4개 revisedPrompt 요약)

**NEW** `/Users/jun/Developer/new/700_projects/ima2-gen/lib/videoSeriesChain.ts`
- `getVideoSeriesChain(generatedDir: string, topic: string, limit?: number): Promise<string[]>`
- generatedDir 내 `.json` sidecar를 스캔, 같은 topic의 최근 4개 revisedPrompt 반환

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/routes/video.ts`
- generate 시 `getVideoSeriesChain(topic)` 호출 → prompt에 체인 컨텍스트 prepend

---

## Feature 3: Agent Video Tool

### 현재 동작
- `AGENT_ALLOWED_TOOLS = ["ima2.get_image_context", "ima2.web_search", "ima2.generate_image"]`
- `generateAgentImage()` → `generateViaResponses()` 또는 `generateViaGrok()` (이미지)

### 변경
- `ima2.generate_video` tool 추가
- Agent가 비디오 생성 요청 시 Grok video API 호출
- 결과를 agent session에 import (video handle)

### Files

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/lib/agentTypes.ts`
- `AGENT_ALLOWED_TOOLS`에 `"ima2.generate_video"` 추가

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/lib/agentRuntime.ts`
- `generateAgentVideo()` 함수 추가 — `generateVideoViaGrok()` 호출
- `persistAgentVideo()` 함수 추가 — .mp4 + .json 저장, agent session에 import
- `runAgentGenerationPlan()` 에서 tool name 분기: image → 기존, video → 새 함수

**MODIFY** `/Users/jun/Developer/new/700_projects/ima2-gen/lib/agentStore.ts`
- `importAgentVideo()` — agent_images 테이블에 video handle 저장 (mediaType 구분)

---

## Execution Order

1. Feature 1 (Trash Fallback) — 가장 독립적, 1파일 수정
2. Feature 3 (Agent Video Tool) — 백엔드 3파일 수정
3. Feature 2 (Video Series) — 프론트+백엔드 5파일, 가장 큼

---

## Success Criteria

- `tsc --noEmit` 통과
- 사용자 수동 확인:
  - 삭제 시 시스템 trash 실패해도 내부 trash로 이동
  - topic 설정 후 비디오 연속 생성 시 체인 전달 확인
  - Agent 대화에서 generate_video 호출 성공
