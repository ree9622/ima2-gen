import type { Count, Format, Moderation, Quality, SizePreset } from "../types";

export type PresetPayload = {
  quality: Quality;
  sizePreset: SizePreset;
  customW?: number;
  customH?: number;
  format: Format;
  moderation: Moderation;
  count: Count;
};

export type Preset = {
  id: string;
  name: string;
  createdAt: number;
  builtIn?: boolean;
  payload: PresetPayload;
};

const STORE_KEY = "ima2.presets";

export const BUILTINS: ReadonlyArray<Preset> = [
  {
    id: "builtin-selfie-hi",
    name: "셀카 고품질",
    createdAt: 0,
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "1024x1536",
      format: "png", moderation: "low", count: 1,
    },
  },
  {
    id: "builtin-insta-sq",
    name: "인스타 사각",
    createdAt: 0,
    builtIn: true,
    payload: {
      quality: "medium", sizePreset: "1024x1024",
      format: "jpeg", moderation: "low", count: 2,
    },
  },
  {
    id: "builtin-illust-4k",
    name: "일러스트 4K",
    createdAt: 0,
    builtIn: true,
    payload: {
      quality: "high", sizePreset: "3824x2160",
      format: "webp", moderation: "low", count: 1,
    },
  },
];

function isValidPayload(p: unknown): p is PresetPayload {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.quality === "string" &&
    typeof obj.sizePreset === "string" &&
    typeof obj.format === "string" &&
    typeof obj.moderation === "string" &&
    typeof obj.count === "number"
  );
}

export function loadPresets(): Preset[] {
  let user: Preset[] = [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        user = arr.filter(
          (p): p is Preset =>
            p && typeof p.id === "string" && typeof p.name === "string" &&
            typeof p.createdAt === "number" && isValidPayload(p.payload),
        );
      }
    }
  } catch {}
  return [...BUILTINS, ...user];
}

export function saveUserPresets(user: Preset[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(user.filter((p) => !p.builtIn)));
  } catch {}
}

export function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function findActivePreset(
  list: ReadonlyArray<Preset>,
  payload: PresetPayload,
): Preset | null {
  for (const p of list) {
    const q = p.payload;
    if (
      q.quality === payload.quality &&
      q.sizePreset === payload.sizePreset &&
      q.format === payload.format &&
      q.moderation === payload.moderation &&
      q.count === payload.count &&
      (q.sizePreset !== "custom" ||
        (q.customW === payload.customW && q.customH === payload.customH))
    ) return p;
  }
  return null;
}
