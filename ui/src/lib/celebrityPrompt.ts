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

const DEFAULT_SCENE = "리조트 풀사이드";
const DEFAULT_OUTFIT = "블랙 리조트 의상";

function clean(value: string | undefined, fallback = ""): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function identityLine(name: string, groupName: string, priority: CelebrityFacePriority): string {
  const group = groupName ? ` from ${groupName}` : "";
  const groupContext = groupName ? `, with ${groupName} public styling cues` : "";
  if (priority === "soft") {
    return `A candid iPhone rear-camera photo of a Korean woman with a subtle ${name}-like public appearance${groupContext}.`;
  }
  if (priority === "balanced") {
    return `A candid iPhone rear-camera photo of a Korean woman with a clear ${name}-like public appearance${groupContext}, closer to ${name}${group} than a generic Korean celebrity-inspired woman.`;
  }
  return `A candid iPhone rear-camera photo of a Korean woman with a clear ${name}-like public appearance${groupContext}, not a generic Korean woman.`;
}

function toneLine(tone: CelebrityPromptTone): string {
  switch (tone) {
    case "stage":
      return "K-pop performance photo mood with realistic stage lighting, natural camera perspective, and a candid backstage or rehearsal snapshot feeling rather than a polished studio poster.";
    case "resort":
      return "Tasteful resort travel photo mood, relaxed vacation styling, soft golden-hour light, water reflections, palm trees, and a casual Korean celebrity vacation atmosphere.";
    case "natural":
    default:
      return "Natural everyday snapshot mood with realistic colors, slightly imperfect framing, mild motion softness in the hair, without a studio-polished look.";
  }
}

function outfitLine(outfit: string): string {
  const swimwear = /수영복|비키니|swimsuit|swimwear|bikini|one[- ]?piece/i.test(outfit);
  if (swimwear) {
    return `Wearing ${outfit}, styled as tasteful non-sexual resort fashion, with relaxed vacation layering and no body-part emphasis.`;
  }
  return `Wearing ${outfit}, styled naturally for the scene with relaxed fit, realistic fabric texture, and no over-polished fashion editorial look.`;
}

export function getCelebrityPromptDefaults(): CelebrityPromptInput {
  return {
    celebrityName: "",
    groupName: "",
    outfit: DEFAULT_OUTFIT,
    scene: DEFAULT_SCENE,
    tone: "natural",
    facePriority: "strong",
  };
}

export function buildCelebrityPrompt(input: CelebrityPromptInput): string {
  const celebrityName = clean(input.celebrityName);
  if (!celebrityName) {
    throw new Error("celebrityName is required");
  }

  const groupName = clean(input.groupName);
  const outfit = clean(input.outfit, DEFAULT_OUTFIT);
  const scene = clean(input.scene, DEFAULT_SCENE);
  const tone = input.tone ?? "natural";
  const facePriority = input.facePriority ?? "strong";

  return [
    `${identityLine(celebrityName, groupName, facePriority)} Preserve the recognizable ${celebrityName}-like facial impression as much as the image model allows: very refined small oval face, long elegant face line, large clear almond eyes, softly lifted eye corners, high slim nose bridge, small soft lips, delicate adult features, long dark hair moving naturally.`,
    `She is at ${scene}, looking casually at the camera with a small relaxed smile. Face is close enough and clearly visible, eyes nose mouth and jawline unobstructed. Natural everyday makeup, realistic skin texture with slight pores and tiny imperfections, soft uneven light on the face, no beauty filter, no heavy retouching.`,
    outfitLine(outfit),
    toneLine(tone),
    "Background details should feel like a real place, with a few ordinary people softly blurred far behind when appropriate, casual travel or event snapshot feeling.",
    "Shot on iPhone rear camera, natural perspective, realistic colors, ordinary photo, not studio lighting, not fashion editorial, not AI-perfect skin, no text, no watermark, portrait 4:5.",
  ].join("\n\n");
}
