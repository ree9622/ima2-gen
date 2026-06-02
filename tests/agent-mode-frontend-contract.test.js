import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Agent Mode frontend shell contract", () => {
  it("exposes Agent mode only through the dev feature gate", () => {
    const devMode = readSource("ui/src/lib/devMode.ts");
    const types = readSource("ui/src/types.ts");
    const store = readSource("ui/src/store/useAppStore.ts");
    const app = readSource("ui/src/App.tsx");
    const main = readSource("ui/src/main.tsx");
    const switcher = readSource("ui/src/components/UIModeSwitch.tsx");

    assert.match(devMode, /export const ENABLE_AGENT_MODE/);
    assert.match(devMode, /VITE_IMA2_AGENT_MODE === "1"/);
    assert.match(devMode, /VITE_IMA2_DEV === "1"/);
    assert.match(types, /"classic" \| "node" \| "card-news" \| "agent"/);
    assert.match(store, /raw === "agent"/);
    assert.match(store, /m === "agent" && !ENABLE_AGENT_MODE/);
    assert.match(app, /if \(ENABLE_AGENT_MODE.*\) loadSessions\(\);/);
    assert.match(store, /return "classic";/);  // default mode for new users
    assert.match(main, /canonicalizeLocalhostOrigin/);
    assert.match(main, /window\.location\.hostname !== "localhost"/);
    assert.match(main, /next\.hostname = "127\.0\.0\.1"/);
    assert.match(main, /window\.location\.replace/);
    assert.match(switcher, /ENABLE_AGENT_MODE/);
    assert.match(switcher, /uiMode\.agent/);
  });

  it("mounts a lazy Agent workspace instead of Classic or Node surfaces", () => {
    const app = readSource("ui/src/App.tsx");
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const css = readSource("ui/src/styles/agent-workspace.css");

    assert.match(app, /LazyAgentWorkspace/);
    assert.match(app, /uiMode === "agent" \?/);
    assert.match(app, /isAgentMode = uiMode === "agent"/);
    assert.match(app, /showHistoryStrip = !promptStudioClassic && !isAgentMode/);
    assert.match(workspace, /AgentSessionSidebar/);
    assert.match(workspace, /AgentChatPane/);
    assert.match(workspace, /AgentRightSidebar/);
    assert.match(css, /\.app\[data-ui-mode="agent"\]/);
    assert.match(css, /\.app\[data-ui-mode="agent"\] \.sidebar/);
  });

  it("implements the planned responsive Agent regions and mobile overlays", () => {
    const layoutHook = readSource("ui/src/hooks/useAgentWorkspaceLayout.ts");
    const layout = readSource("ui/src/lib/agentLayout.ts");
    const types = readSource("ui/src/components/agent/agentTypes.ts");
    const drawer = readSource("ui/src/components/agent/AgentSessionDrawer.tsx");
    const sheet = readSource("ui/src/components/agent/AgentImageSheet.tsx");
    const modelSheet = readSource("ui/src/components/agent/AgentModelSheet.tsx");
    const css = readSource("ui/src/styles/agent-workspace.css");
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");

    assert.match(types, /"desktop-three-pane"/);
    assert.match(types, /"desktop-rail"/);
    assert.match(types, /"tablet-stacked"/);
    assert.match(types, /"mobile-chat-image-sheet"/);
    assert.match(layoutHook, /resolveAgentLayout/);
    assert.match(layout, /height < 560 && width < 1280/);
    assert.match(layout, /width >= 1280/);
    assert.match(layout, /width >= 960 && height >= 560/);
    assert.match(layout, /width >= 768 && height >= 700/);
    assert.match(layoutHook, /getWindowHeight/);
    assert.match(css, /280px minmax\(420px, 0\.95fr\) minmax\(520px, 1\.05fr\)/);
    assert.match(css, /64px minmax\(420px, 1fr\) minmax\(440px, 1fr\)/);
    assert.match(css, /minmax\(280px, min\(46dvh, 420px\)\) minmax\(0, 1fr\)/);
    assert.match(css, /grid-template-areas: "image" "chat"/);
    assert.match(drawer, /role="dialog"/);
    assert.match(sheet, /role="dialog"/);
    assert.match(modelSheet, /role="dialog"/);
    assert.match(panelCss, /\.agent-image-sheet/);
    assert.match(panelCss, /\.agent-model-sheet/);
  });

  it("wires Agent workspace to server-backed runtime APIs and image handles", () => {
    const api = readSource("ui/src/lib/agentApi.ts");
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const composer = readSource("ui/src/components/agent/AgentComposer.tsx");
    const message = readSource("ui/src/components/agent/AgentMessage.tsx");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    assert.match(api, /\/api\/agent\/sessions/);
    assert.match(api, /\/queue/);
    assert.match(api, /\/turns/);
    assert.match(api, /currentImageId\?: string/);
    assert.match(api, /imageHandleFromCurrent/);
    assert.match(api, /enqueueAgentTurn/);
    assert.match(api, /cancelAgentQueueItem/);
    assert.match(api, /retryAgentQueueItem/);
    assert.doesNotMatch(api, /createAgentWorkspaceSeed/);
    assert.doesNotMatch(api, /base64/i);
    assert.match(workspace, /getAgentWorkspace/);
    assert.match(workspace, /enqueueAgentTurn/);
    assert.match(workspace, /derivedRuntimeStatus/);
    assert.match(workspace, /imageIdsBySession/);
    assert.match(workspace, /queueBySession/);
    assert.match(workspace, /runSummaryBySession/);
    assert.match(composer, /onWebSearchChange/);
    assert.match(composer, /onSend/);
    assert.match(message, /imageIds/);
    assert.match(ko, /"agent"/);
    assert.match(en, /"agent"/);
  });

  it("shows optimistic chat turns and visible pending state while Agent generation is in flight", () => {
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const message = readSource("ui/src/components/agent/AgentMessage.tsx");
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    assert.match(workspace, /LOCAL_TURN_PREFIX/);
    assert.match(workspace, /localUserTurn/);
    assert.match(workspace, /localPendingTurn/);
    assert.match(workspace, /status: "streaming"/);
    assert.match(workspace, /pendingTurnsRef/);
    assert.match(workspace, /mergeWorkspaceWithLocalTurns/);
    assert.match(workspace, /replacePendingWithError/);
    assert.match(workspace, /appendTurns\(current, sessionId, \[userTurn, pendingTurn\]\)/);
    assert.match(workspace, /payload\.workspace/);
    assert.match(workspace, /t\("agent\.pending"\)/);
    assert.match(message, /aria-busy/);
    assert.match(panelCss, /\.agent-message\.is-streaming/);
    assert.match(panelCss, /@keyframes agent-spin/);
    assert.match(panelCss, /agent-status__dot[\s\S]*animation: agent-pulse/);
    assert.match(en, /"pending": "Generating image\.\.\."/);
    assert.match(ko, /"pending": "이미지를 생성하는 중\.\.\."/);
  });

  it("collapses Agent tool turns behind accessible summary controls", () => {
    const message = readSource("ui/src/components/agent/AgentMessage.tsx");
    const group = readSource("ui/src/components/agent/AgentToolGroup.tsx");
    const row = readSource("ui/src/components/agent/AgentToolCallRow.tsx");
    const icons = readSource("ui/src/components/agent/AgentIcons.tsx");
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");
    const sidebarCss = readSource("ui/src/styles/agent-workspace-sidebar.css");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    const messageList = readSource("ui/src/components/agent/AgentMessageList.tsx");
    assert.match(messageList, /turn\.role === "tool"/);
    assert.match(messageList, /AgentToolGroup/);
    assert.match(group, /useState\(false\)/);
    assert.match(group, /agent-message__tool-toggle/);
    assert.match(group, /aria-expanded={expanded}/);
    assert.match(group, /aria-controls={detailsId}/);
    assert.match(group, /agent-message__tool-details/);
    assert.match(group, /hidden={!expanded}/);
    assert.match(group, /AgentToolCallRow/);
    assert.match(row, /agent-tool-call-row__toggle/);
    assert.match(row, /AgentToolCallDetails/);
    assert.match(icons, /ChevronRightIcon/);
    assert.match(icons, /ChevronDownIcon/);
    assert.match(panelCss, /\.agent-message__tool-toggle/);
    assert.match(panelCss, /\.agent-message__tool-details\[hidden\]/);
    assert.match(panelCss, /\.agent-message__tool-thumbs/);
    assert.match(sidebarCss, /\.agent-tool-call-row__toggle/);
    assert.match(en, /"toolExpand": "Show tool details"/);
    assert.match(ko, /"toolExpand": "도구 상세 펼치기"/);
  });

  it("syncs Agent image focus across chat thumbs, right variants, and mobile sheet", () => {
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const chat = readSource("ui/src/components/agent/AgentChatPane.tsx");
    const list = readSource("ui/src/components/agent/AgentMessageList.tsx");
    const message = readSource("ui/src/components/agent/AgentMessage.tsx");
    const group = readSource("ui/src/components/agent/AgentToolGroup.tsx");
    const pane = readSource("ui/src/components/agent/AgentImagePane.tsx");
    const sheet = readSource("ui/src/components/agent/AgentImageSheet.tsx");
    const thumb = readSource("ui/src/components/agent/AgentResultThumb.tsx");
    const panelCss = readSource("ui/src/styles/agent-workspace-panels.css");
    const imageCss = readSource("ui/src/styles/agent-workspace-image.css");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    assert.match(workspace, /const selectImage = \(imageId: string\) =>/);
    assert.match(workspace, /currentImageId: imageId/);
    assert.match(workspace, /updateAgentSession\(sessionId, \{ currentImageId: imageId \}\)/);
    assert.match(workspace, /imageIdsBySession\[selectedSessionId\]/);
    assert.match(workspace, /onImageSelect=\{selectImage\}/);
    assert.match(chat, /currentImageId: string \| null/);
    assert.match(list, /currentImageId: string \| null/);
    assert.match(message, /AgentResultThumb/);
    assert.match(message, /currentImageId/);
    assert.match(group, /agent-message__tool-summary/);
    assert.doesNotMatch(group, /agent-message__tool-toggle[\s\S]*AgentResultThumb[\s\S]*<\/button>/);
    assert.match(pane, /onImageSelect: \(imageId: string\) => void/);
    assert.match(pane, /handleImageKeyDown/);
    assert.match(pane, /ArrowLeft/);
    assert.match(pane, /ArrowRight/);
    assert.match(pane, /Home/);
    assert.match(pane, /End/);
    assert.match(pane, /scrollIntoView/);
    assert.match(sheet, /headerAction/);
    assert.doesNotMatch(sheet, /<header>/);
    assert.match(thumb, /forwardRef/);
    assert.match(thumb, /aria-current=\{selected \? "true" : undefined\}/);
    assert.match(panelCss, /\.agent-result-thumb/);
    assert.match(panelCss, /\.agent-image-sheet \.agent-image/);
    assert.match(imageCss, /\.agent-image__preview:focus-visible/);
    assert.match(imageCss, /\.agent-image__preview\s*\{[\s\S]*?position: relative;/);
    assert.match(imageCss, /\.agent-image__preview img\s*\{[\s\S]*?position: absolute;[\s\S]*?object-fit: contain;/);
    assert.match(panelCss, /\.agent-image-sheet \.agent-image__preview img/);
    assert.match(en, /"selectImage": "Focus image"/);
    assert.match(ko, /"selectImage": "이미지 포커스"/);
  });
});
