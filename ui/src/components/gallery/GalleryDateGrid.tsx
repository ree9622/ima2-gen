import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GenerateItem } from "../../types";
import { getGalleryItemKey } from "../../lib/galleryNavigation";

type DateGroup = [string, GenerateItem[]];

type VirtualRow =
  | { type: "header"; id: string; label: string; count: number }
  | { type: "items"; id: string; items: GenerateItem[] };

type GalleryDateGridProps = {
  dateGroups: DateGroup[];
  selectedKey: string | null;
  scrollElement: HTMLDivElement | null;
  localizeBucket: (key: string) => string;
  renderTile: (item: GenerateItem, keyPrefix: string, idx: number) => ReactNode;
};

const TILE_MIN_WIDTH = 170;
const TILE_GAP = 10;
const GROUP_SIDE_PADDING = 36;
const HEADER_ESTIMATE = 44;

function getColumnCount(width: number): number {
  const usable = Math.max(TILE_MIN_WIDTH, width - GROUP_SIDE_PADDING);
  return Math.max(1, Math.floor((usable + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)));
}

function getTileRowEstimate(width: number, columns: number): number {
  const usable = Math.max(TILE_MIN_WIDTH, width - GROUP_SIDE_PADDING);
  const tile = Math.max(
    TILE_MIN_WIDTH,
    Math.floor((usable - TILE_GAP * Math.max(0, columns - 1)) / columns),
  );
  return tile + TILE_GAP;
}

function buildRows(dateGroups: DateGroup[], columns: number): VirtualRow[] {
  const rows: VirtualRow[] = [];
  for (const [label, items] of dateGroups) {
    rows.push({ type: "header", id: `h-${label}`, label, count: items.length });
    for (let start = 0; start < items.length; start += columns) {
      rows.push({
        type: "items",
        id: `r-${label}-${start}`,
        items: items.slice(start, start + columns),
      });
    }
  }
  return rows;
}

export function GalleryDateGrid({
  dateGroups,
  selectedKey,
  scrollElement,
  localizeBucket,
  renderTile,
}: GalleryDateGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const columns = useMemo(() => getColumnCount(width || 960), [width]);
  const tileEstimate = useMemo(() => getTileRowEstimate(width || 960, columns), [width, columns]);
  const rows = useMemo(() => buildRows(dateGroups, columns), [dateGroups, columns]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => rows[index]?.type === "header" ? HEADER_ESTIMATE : tileEstimate,
    overscan: 6,
  });

  useEffect(() => {
    if (!selectedKey) return;
    const index = rows.findIndex(
      (row) => row.type === "items" && row.items.some((item) => getGalleryItemKey(item) === selectedKey),
    );
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
  }, [rows, selectedKey, virtualizer]);

  return (
    <div ref={rootRef} className="gallery__virtual" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;
        return (
          <div
            key={row.id}
            className="gallery__virtual-row"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {row.type === "header" ? (
              <header className="gallery__group-header gallery__group-header--virtual">
                <span className="gallery__group-label">{localizeBucket(row.label)}</span>
                <span className="gallery__group-count">{row.count}</span>
              </header>
            ) : (
              <div className="gallery__grid gallery__grid--virtual">
                {row.items.map((item, i) => renderTile(item, row.id, i))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
