import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type PanelResizeTarget = "sidebar" | "right-panel";

type PanelResizeConfig = {
  cssVar: string;
  defaultWidth: number;
  label: string;
  max: number;
  min: number;
  selector: string;
  storageKey: string;
};

const PANEL_RESIZE: Record<PanelResizeTarget, PanelResizeConfig> = {
  sidebar: {
    cssVar: "--sidebar-width",
    defaultWidth: 380,
    label: "왼쪽 패널 폭 조절",
    max: 560,
    min: 300,
    selector: ".sidebar",
    storageKey: "ima2.sidebarWidth.v2",
  },
  "right-panel": {
    cssVar: "--right-panel-width",
    defaultWidth: 340,
    label: "오른쪽 설정 패널 폭 조절",
    max: 560,
    min: 300,
    selector: ".right-panel:not(.collapsed)",
    storageKey: "ima2.rightPanelWidth.v2",
  },
};

function clampWidth(value: number, config: PanelResizeConfig): number {
  if (!Number.isFinite(value)) return config.defaultWidth;
  return Math.min(config.max, Math.max(config.min, Math.round(value)));
}

function readStoredWidth(config: PanelResizeConfig): number {
  if (typeof window === "undefined") return config.defaultWidth;
  try {
    const raw = window.localStorage.getItem(config.storageKey);
    if (raw == null) return config.defaultWidth;
    try {
      return clampWidth(Number(JSON.parse(raw)), config);
    } catch {
      return clampWidth(Number.parseFloat(raw), config);
    }
  } catch {
    return config.defaultWidth;
  }
}

function readCurrentWidth(config: PanelResizeConfig): number {
  if (typeof document === "undefined") return readStoredWidth(config);
  const node = document.querySelector<HTMLElement>(config.selector);
  const measured = node?.getBoundingClientRect().width;
  return clampWidth(measured ?? readStoredWidth(config), config);
}

function writeWidth(config: PanelResizeConfig, width: number): number {
  const next = clampWidth(width, config);
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty(config.cssVar, `${next}px`);
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(config.storageKey, JSON.stringify(next));
    } catch {}
  }
  return next;
}

export function PanelResizeHandle({ target }: { target: PanelResizeTarget }) {
  const config = PANEL_RESIZE[target];
  const [width, setWidth] = useState(config.defaultWidth);

  const applyWidth = useCallback(
    (nextWidth: number) => {
      setWidth(writeWidth(config, nextWidth));
    },
    [config],
  );

  useEffect(() => {
    applyWidth(readStoredWidth(config));
  }, [applyWidth, config]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();

      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = readCurrentWidth(config);

      document.body.classList.add("panel-resizing");
      try {
        handle.setPointerCapture(pointerId);
      } catch {}

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const next =
          target === "sidebar" ? startWidth + deltaX : startWidth - deltaX;
        applyWidth(next);
      };

      const finishResize = () => {
        document.body.classList.remove("panel-resizing");
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
        window.removeEventListener("blur", finishResize);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {}
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
      window.addEventListener("blur", finishResize);
    },
    [applyWidth, config, target],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 16;
      if (event.key === "Home") {
        event.preventDefault();
        applyWidth(config.defaultWidth);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      applyWidth(width + (target === "sidebar" ? direction : -direction) * step);
    },
    [applyWidth, config.defaultWidth, target, width],
  );

  return (
    <div
      className={`panel-resize-handle panel-resize-handle--${target}`}
      role="separator"
      aria-label={config.label}
      aria-orientation="vertical"
      aria-valuemin={config.min}
      aria-valuemax={config.max}
      aria-valuenow={width}
      tabIndex={0}
      title={`${config.label} · 더블클릭하면 기본값으로 돌아갑니다`}
      onDoubleClick={() => applyWidth(config.defaultWidth)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}
