import type { GenerateItem } from "../../types";
import { getGalleryItemKey, isGalleryVisibleItem } from "../galleryNavigation";

export type SidebarHistoryEntry =
  | { type: "image"; key: string; item: GenerateItem }
  | { type: "sequence"; key: string; sequenceId: string; items: GenerateItem[] };

export type SidebarHistoryShortcutTarget =
  | { type: "image"; item: GenerateItem }
  | { type: "sequence"; sequenceId: string };

export const SIDEBAR_HISTORY_RENDER_LIMIT = 72;
export const SIDEBAR_HISTORY_PAGE_STEP = 10;

export function compareSequenceItems(a: GenerateItem, b: GenerateItem): number {
  const ai = a.sequenceIndex ?? Number.MAX_SAFE_INTEGER;
  const bi = b.sequenceIndex ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

export function getSequenceThumbSlotCount(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  return 4;
}

export function groupSidebarHistoryEntries(history: GenerateItem[]): SidebarHistoryEntry[] {
  const seenImages = new Set<string>();
  const sequences = new Map<string, Extract<SidebarHistoryEntry, { type: "sequence" }>>();
  const entries: SidebarHistoryEntry[] = [];

  for (const item of history) {
    if (!isGalleryVisibleItem(item)) continue;

    if (item.sequenceId) {
      const key = `sequence:${item.sequenceId}`;
      let entry = sequences.get(item.sequenceId);
      if (!entry) {
        entry = { type: "sequence", key, sequenceId: item.sequenceId, items: [] };
        sequences.set(item.sequenceId, entry);
        entries.push(entry);
      }
      entry.items.push(item);
      continue;
    }

    const key = getGalleryItemKey(item);
    if (seenImages.has(key)) continue;
    seenImages.add(key);
    entries.push({ type: "image", key, item });
  }

  for (const entry of sequences.values()) {
    entry.items.sort(compareSequenceItems);
  }

  return entries;
}

export function getSidebarHistoryActiveKey(
  currentImage: GenerateItem | null,
  activeSequenceId?: string | null,
): string | null {
  if (activeSequenceId) return `sequence:${activeSequenceId}`;
  if (currentImage?.sequenceId) return `sequence:${currentImage.sequenceId}`;
  return currentImage ? getGalleryItemKey(currentImage) : null;
}

function toShortcutTarget(entry: SidebarHistoryEntry): SidebarHistoryShortcutTarget {
  if (entry.type === "sequence") return { type: "sequence", sequenceId: entry.sequenceId };
  return { type: "image", item: entry.item };
}

export function getSidebarHistoryShortcutTarget(
  history: GenerateItem[],
  currentImage: GenerateItem | null,
  action: "previous" | "next" | "first" | "last" | "pagePrevious" | "pageNext",
  activeSequenceId?: string | null,
  limit = SIDEBAR_HISTORY_RENDER_LIMIT,
): SidebarHistoryShortcutTarget | null {
  const entries = groupSidebarHistoryEntries(history).slice(0, limit);
  if (entries.length === 0) return null;
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) return null;
  if (action === "first") return toShortcutTarget(first);
  if (action === "last") return toShortcutTarget(last);

  const activeKey = getSidebarHistoryActiveKey(currentImage, activeSequenceId);
  const currentIndex = activeKey
    ? entries.findIndex((entry) => entry.key === activeKey)
    : -1;
  if (currentIndex < 0) return null;

  const delta =
    action === "pagePrevious" ? -SIDEBAR_HISTORY_PAGE_STEP :
      action === "pageNext" ? SIDEBAR_HISTORY_PAGE_STEP :
        action === "previous" ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(entries.length - 1, currentIndex + delta));
  if (nextIndex === currentIndex) return null;
  const next = entries[nextIndex];
  return next ? toShortcutTarget(next) : null;
}
