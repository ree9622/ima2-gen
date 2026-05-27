import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/canvas-mode.css";
import "./styles/canvas-background-cleanup.css";
import "./styles/classic-workspace.css";
import "./styles/composer-flow.css";
import "./styles/gallery-controls.css";
import "./styles/prompt-builder.css";
import "./styles/prompt-builder-messages.css";
import "./styles/sidebar-history.css";
import "./styles/settings-controls.css";
import "./styles/viewer-workflow.css";
import "./styles/result-preview.css";
import "./styles/agent-workspace.css";
import "./styles/agent-workspace-panels.css";
import "./styles/agent-workspace-image.css";
import "./styles/agent-workspace-sidebar.css";
import App from "./App";

function canonicalizeLocalhostOrigin(): boolean {
  if (window.location.protocol !== "http:" || window.location.hostname !== "localhost") {
    return false;
  }
  const next = new URL(window.location.href);
  next.hostname = "127.0.0.1";
  window.location.replace(next.toString());
  return true;
}

if (!canonicalizeLocalhostOrigin()) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
