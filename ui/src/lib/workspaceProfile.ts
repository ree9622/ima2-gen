export type WorkspaceProfile = "default" | "prompt-studio";

export type WorkspaceOverrides = {
  promptBuilderSurface: "off" | "right-panel" | "popup";
  composerPlacement: "sidebar" | "bottom";
  multimodeHistoryGrouping: "individual" | "sequence";
  restoreComposerFromHistory: boolean;
  viewerTools: "basic" | "zoom-pan";
};

export const DEFAULT_WORKSPACE_PRESET: WorkspaceOverrides = {
  promptBuilderSurface: "off",
  composerPlacement: "sidebar",
  multimodeHistoryGrouping: "individual",
  restoreComposerFromHistory: true,
  viewerTools: "basic",
};

export const PROMPT_STUDIO_WORKSPACE_PRESET: WorkspaceOverrides = {
  promptBuilderSurface: "right-panel",
  composerPlacement: "bottom",
  multimodeHistoryGrouping: "sequence",
  restoreComposerFromHistory: true,
  viewerTools: "zoom-pan",
};

const PRESETS: Record<WorkspaceProfile, WorkspaceOverrides> = {
  default: DEFAULT_WORKSPACE_PRESET,
  "prompt-studio": PROMPT_STUDIO_WORKSPACE_PRESET,
};

export function resolveWorkspaceSettings(
  profile: WorkspaceProfile,
  overrides?: Partial<WorkspaceOverrides>,
): WorkspaceOverrides {
  const base = PRESETS[profile] ?? DEFAULT_WORKSPACE_PRESET;
  if (!overrides) return base;
  return { ...base, ...overrides };
}

export function isPromptBuilderEnabled(
  profile: WorkspaceProfile,
  overrides?: Partial<WorkspaceOverrides>,
): boolean {
  const resolved = resolveWorkspaceSettings(profile, overrides);
  return resolved.promptBuilderSurface !== "off";
}

export const WORKSPACE_PROFILE_STORAGE_KEY = "ima2.workspaceProfile";
export const WORKSPACE_OVERRIDES_STORAGE_KEY = "ima2.workspaceOverrides";
