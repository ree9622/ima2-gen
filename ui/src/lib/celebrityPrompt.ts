export type CelebrityPromptTone = "natural" | "resort" | "stage";
export type CelebrityFacePriority = "strong" | "balanced" | "soft";

export type CelebrityPromptInput = {
  celebrityName: string;
  groupName?: string;
  outfit: string;
  scene?: string;
  tone?: CelebrityPromptTone;
  facePriority?: CelebrityFacePriority;
};

// Keep the implementation executable by the root Node 20 test matrix.
export { buildCelebrityPrompt, getCelebrityPromptDefaults } from "./celebrityPromptRuntime.js";
