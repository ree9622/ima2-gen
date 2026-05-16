---
created: 2026-05-16
status: implemented slice / lane still active
tags: [ima2-gen, agent-mode, image-focus, responsive-qa, fork-research]
commit: f250784
coauthor: damagethundercat <145410184+damagethundercat@users.noreply.github.com>
---

# Agent Image Focus Sync QA

2026-05-16 작업은 fork prompting modularization lane 전체를 끝낸 것이 아니라, Agent workspace에서 실제 사용 중 확인된 이미지 포커스/반응형 regression을 먼저 닫은 slice다. 따라서 이 폴더는 `_fin`으로 옮기지 않고 `_plan`에 유지한다. Prompt Builder, workspace profile, composer ordering, sidebar history, viewer polish 같은 원래 fork modularization scope는 아직 active lane으로 남아 있다.

이번 slice의 목적은 Agent 결과 이미지가 한 가지 일관된 선택 동작을 갖게 하는 것이었다. 왼쪽 채팅 결과 이미지를 누르면 오른쪽 현재 이미지가 바뀌어야 하고, 오른쪽 variants도 클릭과 키보드로 전환되어야 하며, 모바일 image sheet에는 중복 헤더나 작은 화면 깨짐이 없어야 한다.

---

## 구현 범위

- Agent 결과 썸네일을 `AgentResultThumb` 공용 버튼 컴포넌트로 통합했다.
- 채팅 이미지, tool summary 이미지, 오른쪽 variants가 같은 선택 affordance를 쓰도록 연결했다.
- tool summary는 expand/collapse 버튼과 image selection 버튼을 분리해 중첩 interactive control을 없앴다.
- `AgentWorkspace`에 단일 `selectImage(imageId)` 경로를 추가하고 chat pane, image pane, mobile sheet에 모두 전달했다.
- 선택한 이미지는 UI에서 즉시 optimistic update되고, `PATCH /api/agent/sessions/:sessionId`의 `currentImageId`로 서버에 저장된다.
- backend는 선택 이미지가 해당 Agent session에 속하는지 검증하고, 다른 세션/없는 이미지는 `AGENT_IMAGE_NOT_FOUND`로 거절한다.
- workspace payload에 `imageIdsBySession`을 추가해 오른쪽 variants가 현재 session 이미지들만 렌더링하게 했다.
- mobile image sheet의 별도 wrapper header를 제거하고 `AgentImagePane` header 하나로 통합했다.
- 오른쪽 preview/variants는 `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End` 키로 전환된다.
- 짧은 viewport에서는 width-only layout 대신 height-aware layout을 사용해 mobile sheet로 떨어지게 했다.
- sheet preview 이미지가 작은 높이에서 잘리지 않도록 preview image sizing을 absolute contain 방식으로 고정했다.

## 변경 파일 요약

주요 코드:

- `ui/src/components/agent/AgentResultThumb.tsx`
- `ui/src/components/agent/AgentMessage.tsx`
- `ui/src/components/agent/AgentMessageList.tsx`
- `ui/src/components/agent/AgentChatPane.tsx`
- `ui/src/components/agent/AgentImagePane.tsx`
- `ui/src/components/agent/AgentImageSheet.tsx`
- `ui/src/components/agent/AgentWorkspace.tsx`
- `ui/src/hooks/useAgentWorkspaceLayout.ts`
- `ui/src/styles/agent-workspace-panels.css`
- `ui/src/styles/agent-workspace.css`
- `ui/src/lib/agentApi.ts`
- `lib/agentStore.ts`
- `lib/agentTypes.ts`
- `routes/agent.ts`

주요 테스트:

- `tests/agent-mode-frontend-contract.test.js`
- `tests/agent-mode-runtime-contract.test.ts`

## 실제 QA 기록

QA는 로컬 `ima2 serve --dev` 서버의 `http://127.0.0.1:3369`에 Chrome + Computer Use로 직접 접속해서 수행했다. 테스트용 Agent session에는 `QA red sphere`, `QA blue sphere` 두 이미지를 넣고 동작을 확인했다.

확인한 항목:

- desktop three-pane에서 왼쪽 채팅 이미지 클릭 시 오른쪽 preview/file/prompt가 같은 이미지로 바뀜.
- 오른쪽 variants 클릭으로 현재 이미지가 바뀜.
- 오른쪽 preview focus 상태에서 화살표 키로 red/blue 이미지가 전환됨.
- `900x600` 작은 창에서 mobile image sheet로 전환됨.
- sheet에는 `Image Current image` 헤더가 하나만 보이고 별도 중복 header가 없음.
- sheet preview 이미지가 작은 창에서 잘리지 않고 contain 됨.
- sheet 내부 썸네일 클릭과 키보드 전환이 동작함.
- 서버 로그에서 image focus PATCH가 200으로 저장됨.

## 검증 명령

아래 검증을 모두 통과했다.

```bash
node --test tests/agent-mode-frontend-contract.test.js
node --import tsx --test tests/agent-mode-runtime-contract.test.ts
npm run typecheck
npm run typecheck:tests
npm run ui:build
npm test
git diff --check
```

`npm test` 결과:

```text
tests 741
pass 741
fail 0
```

## 커밋 / 서버 상태

구현 커밋:

```text
f250784 [agent] fix: sync agent image focus
Co-authored-by: damagethundercat <145410184+damagethundercat@users.noreply.github.com>
```

문서화 시점에 QA용 3369 서버는 종료했다. `lsof -nP -iTCP:3369 -sTCP:LISTEN` 기준 리스너가 없다.

## 남은 범위

이 slice는 Agent image focus regression만 닫는다. 아래 fork modularization 범위는 아직 완료로 보지 않는다.

- Prompt Builder backend/frontend/CLI contract.
- Workspace profile settings.
- Composer block ordering과 history metadata restore.
- Classic workspace/right-panel layout integration.
- Sidebar history와 grouped multimode history.
- Viewer zoom/pan polish와 empty-state animation.

이 남은 범위 때문에 `260515_fork-prompting-modularization-research/`는 `_plan`에 남긴다.
