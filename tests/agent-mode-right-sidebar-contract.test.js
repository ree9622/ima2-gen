import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("Agent Mode right sidebar contract", () => {
  it("mounts image, prompt library, forms, quality, model, and queue tabs", () => {
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const chat = readSource("ui/src/components/agent/AgentChatPane.tsx");
    const sidebar = readSource("ui/src/components/agent/AgentRightSidebar.tsx");
    const modelSheet = readSource("ui/src/components/agent/AgentModelSheet.tsx");
    const tabs = readSource("ui/src/components/agent/AgentSidebarTabs.tsx");
    const quality = readSource("ui/src/components/agent/AgentQualityPanel.tsx");
    const model = readSource("ui/src/components/agent/AgentModelSelector.tsx");
    const promptLibrary = readSource("ui/src/components/agent/AgentPromptLibraryPanel.tsx");
    const css = readSource("ui/src/styles/agent-workspace-sidebar.css");
    const ko = readSource("ui/src/i18n/ko.json");
    const en = readSource("ui/src/i18n/en.json");

    assert.match(workspace, /AgentRightSidebar/);
    assert.match(workspace, /AgentModelSheet/);
    assert.match(workspace, /settings={selectedSettings}/);
    assert.match(workspace, /const openModelSettings = \(\) =>/);
    assert.match(workspace, /setSidebarTab\("model"\)/);
    assert.match(workspace, /setModelSheetOpen\(true\)/);
    assert.match(workspace, /open={modelSheetOpen && !showRightSidebar}/);
    assert.match(chat, /agent-model-chip/);
    assert.match(chat, /formatModelSummary/);
    assert.match(sidebar, /AgentImagePane/);
    assert.match(sidebar, /AgentPromptLibraryPanel/);
    assert.match(sidebar, /AgentFormTemplatePanel/);
    assert.match(sidebar, /AgentFormTemplatePanel/);
    assert.match(sidebar, /AgentQualityPanel/);
    assert.match(sidebar, /AgentModelSelector/);
    assert.match(sidebar, /AgentQueuePanel/);
    assert.match(modelSheet, /role="dialog"/);
    assert.match(modelSheet, /AgentModelSelector/);
    assert.match(tabs, /\["image", "library", "forms", "quality", "model", "queue"\]/);
    assert.match(quality, /generationStrategy/);
    assert.match(model, /reasoningEffort/);
    assert.match(promptLibrary, /agent:form/);
    assert.match(css, /\.agent-right-sidebar/);
    assert.match(css, /\.agent-sidebar-tabs/);
    assert.match(css, /\.agent-model-chip/);
    assert.match(en, /"openModelSettings": "Open model settings"/);
    assert.match(en, /"closeModelSettings": "Close model settings"/);
    assert.match(ko, /"openModelSettings": "모델 설정 열기"/);
    assert.match(ko, /"closeModelSettings": "모델 설정 닫기"/);
  });

  it("syncs sidebar settings and queue actions through the server-backed workspace", () => {
    const workspace = readSource("ui/src/components/agent/AgentWorkspace.tsx");
    const api = readSource("ui/src/lib/agentApi.ts");
    const types = readSource("ui/src/components/agent/agentTypes.ts");

    assert.match(types, /type AgentGenerationSettings/);
    assert.match(types, /queueBySession: Record<string, AgentQueueItem\[\]>/);
    assert.match(types, /runSummaryBySession: Record<string, AgentSessionRunSummary>/);
    assert.match(workspace, /updateGenerationSettings/);
    assert.match(workspace, /onSettingsChange={updateGenerationSettings}/);
    assert.match(workspace, /queueItems={queueItems}/);
    assert.match(workspace, /runSummary={selectedRunSummary}/);
    assert.match(workspace, /cancelAgentQueueItem/);
    assert.match(workspace, /retryAgentQueueItem/);
    assert.match(api, /enqueueAgentTurn/);
    assert.match(api, /cancelAgentQueueItem/);
    assert.match(api, /retryAgentQueueItem/);
  });

  it("allows Grok as an Agent Mode provider and keeps model/provider in sync", () => {
    const model = readSource("ui/src/components/agent/AgentModelSelector.tsx");
    const types = readSource("ui/src/components/agent/agentTypes.ts");

    assert.match(types, /provider: "oauth" \| "api" \| "grok"/);
    assert.match(model, /<option value="grok">Grok<\/option>/);
    assert.match(model, /isGrokImageModel\(settings\.model\)/);
    assert.match(model, /provider === "grok"/);
    assert.match(model, /onChange\(\{ model, provider: "grok" \}\)/);
  });
});
