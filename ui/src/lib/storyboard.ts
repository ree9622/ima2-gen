export function buildStoryboardPrefix(frameIndex: number, anchorPrompt?: string): string {
  const parts = [
    `[STORYBOARD FRAME ${frameIndex}]`,
    "This image is part of a sequential storyboard. Generate the next frame continuing from the previous frame's composition.",
    "Maintain character visual descriptions verbatim — do not paraphrase character appearance across frames.",
    "Change only the action, shot scale, or camera angle — keep lighting, environment, and character design constant.",
  ];
  if (anchorPrompt) {
    parts.push(`Anchor context from previous frame: ${anchorPrompt.slice(0, 300)}`);
  }
  return parts.join("\n");
}

export function getStoryboardFrameIndex(lineageEntries?: unknown[]): number {
  if (!Array.isArray(lineageEntries)) return 1;
  return lineageEntries.length + 1;
}
