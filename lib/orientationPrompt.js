const SIZE_RE = /^(\d+)x(\d+)$/i;

export function buildOrientationDirective(size) {
  if (typeof size !== "string") return "";
  const normalized = size.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "";

  const match = SIZE_RE.exec(normalized);
  if (!match) {
    return `You MUST generate this image at exactly ${size.trim()} resolution.`;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  const orientation = width > height
    ? "a WIDE horizontal LANDSCAPE canvas (clearly wider than tall, never square or portrait)"
    : width < height
      ? "a TALL vertical PORTRAIT canvas (clearly taller than wide, never square or landscape)"
      : "a SQUARE 1:1 canvas";

  return `You MUST generate this image at exactly ${normalized} resolution as ${orientation}.`;
}

export function applyOrientationDirective(prompt, size) {
  const directive = buildOrientationDirective(size);
  return directive ? `${directive}\n\n${prompt}` : prompt;
}
