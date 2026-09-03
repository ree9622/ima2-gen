import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAppStore } from "../store/useAppStore";

type EditMode = "whole" | "area" | "outpaint";
type Aspect = "keep" | "1:1" | "3:2" | "2:3";

async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const response = await fetch(src);
  if (!response.ok) throw new Error(`이미지를 불러오지 못했습니다 (${response.status})`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("이미지 읽기 실패"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 표시하지 못했습니다."));
    image.src = src;
  });
}

type EditableSource = {
  image: string;
  label?: string;
  previousResponseId?: string | null;
};

export function EditWorkspaceModal({
  open,
  onClose,
  sourceImage,
}: {
  open: boolean;
  onClose: () => void;
  sourceImage?: EditableSource;
}) {
  const currentImage = useAppStore((state) => state.currentImage);
  const editImage = useAppStore((state) => state.editImage);
  const activeGenerations = useAppStore((state) => state.activeGenerations);
  const showToast = useAppStore((state) => state.showToast);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [source, setSource] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<EditMode>("whole");
  const [aspect, setAspect] = useState<Aspect>("keep");
  const [brush, setBrush] = useState(72);
  const [undo, setUndo] = useState<string[]>([]);
  const [redo, setRedo] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const editableSource = sourceImage?.image ?? currentImage?.url ?? currentImage?.image ?? "";
  const sourceKey = sourceImage?.image ?? currentImage?.filename ?? editableSource;

  const restoreOverlay = async (dataUrl: string) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const image = await loadImage(dataUrl);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    if (!open || !editableSource) return;
    let canceled = false;
    setLoading(true);
    void toDataUrl(editableSource)
      .then(async (dataUrl) => {
        if (canceled) return;
        const image = await loadImage(dataUrl);
        if (canceled) return;
        const canvas = overlayRef.current;
        if (canvas) {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        }
        setSource(dataUrl);
        setPrompt("");
        setMode("whole");
        setAspect("keep");
        setUndo([]);
        setRedo([]);
      })
      .catch((error) => showToast(error instanceof Error ? error.message : "이미지 불러오기 실패", true))
      .finally(() => !canceled && setLoading(false));
    return () => { canceled = true; };
  }, [open, sourceKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !editableSource) return null;

  const snapshot = () => overlayRef.current?.toDataURL("image/png") ?? "";
  const pushUndo = () => {
    setUndo((items) => [...items.slice(-19), snapshot()]);
    setRedo([]);
  };
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const paint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || mode !== "area") return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.fillStyle = "rgba(255, 70, 70, 0.62)";
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const buildAreaMask = () => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const overlayCtx = overlay.getContext("2d");
    if (!overlayCtx) return null;
    const selected = overlayCtx.getImageData(0, 0, overlay.width, overlay.height);
    let hasSelection = false;
    const mask = document.createElement("canvas");
    mask.width = overlay.width;
    mask.height = overlay.height;
    const maskCtx = mask.getContext("2d");
    if (!maskCtx) return null;
    const pixels = maskCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const marked = selected.data[i + 3] > 0;
      if (marked) hasSelection = true;
      pixels.data[i] = 255;
      pixels.data[i + 1] = 255;
      pixels.data[i + 2] = 255;
      pixels.data[i + 3] = marked ? 0 : 255;
    }
    maskCtx.putImageData(pixels, 0, 0);
    return hasSelection ? mask.toDataURL("image/png") : null;
  };

  const buildOutpaint = async () => {
    const image = await loadImage(source);
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = aspect === "1:1" ? 1 : aspect === "3:2" ? 1.5 : aspect === "2:3" ? 2 / 3 : sourceRatio;
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    if (targetRatio > sourceRatio) width = Math.round(height * targetRatio);
    else height = Math.round(width / targetRatio);
    if (aspect === "keep") {
      width = Math.round(width * 1.25);
      height = Math.round(height * 1.25);
    }
    const scale = Math.min(1, 2048 / Math.max(width, height));
    width = Math.max(16, Math.round(width * scale / 16) * 16);
    height = Math.max(16, Math.round(height * scale / 16) * 16);
    const fittedScale = Math.min(width / image.naturalWidth, height / image.naturalHeight, 1);
    const drawW = Math.round(image.naturalWidth * fittedScale);
    const drawH = Math.round(image.naturalHeight * fittedScale);
    const x = Math.round((width - drawW) / 2);
    const y = Math.round((height - drawH) / 2);
    const expanded = document.createElement("canvas");
    expanded.width = width;
    expanded.height = height;
    expanded.getContext("2d")?.drawImage(image, x, y, drawW, drawH);
    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    const ctx = mask.getContext("2d");
    if (!ctx) throw new Error("확장 마스크를 만들지 못했습니다.");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "white";
    ctx.fillRect(x, y, drawW, drawH);
    return { image: expanded.toDataURL("image/png"), mask: mask.toDataURL("image/png") };
  };

  const submit = async () => {
    if (!prompt.trim()) {
      showToast("어떻게 수정할지 입력해 주세요.", true);
      return;
    }
    let image = source;
    let mask: string | undefined;
    if (mode === "area") {
      mask = buildAreaMask() ?? undefined;
      if (!mask) {
        showToast("수정할 영역을 이미지 위에 칠해 주세요.", true);
        return;
      }
    } else if (mode === "outpaint") {
      const expanded = await buildOutpaint();
      image = expanded.image;
      mask = expanded.mask;
    }
    const ok = await editImage({
      prompt,
      image,
      mask,
      previousResponseId: sourceImage
        ? sourceImage.previousResponseId ?? null
        : currentImage?.responseId ?? null,
    });
    if (ok) onClose();
  };

  return (
    <div className="edit-workspace-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="edit-workspace" role="dialog" aria-modal="true" aria-labelledby="edit-workspace-title">
        <header>
          <div>
            <h2 id="edit-workspace-title">이미지 이어서 수정</h2>
            <p>
              {sourceImage?.label
                ? `${sourceImage.label}에서 바로 작업합니다.`
                : "노드 화면으로 옮기지 않고 현재 결과에서 바로 작업합니다."}
            </p>
          </div>
          <button type="button" className="edit-workspace__close" onClick={onClose} aria-label="편집 닫기">×</button>
        </header>
        <div className="edit-workspace__modes" role="tablist" aria-label="수정 방식">
          {([['whole', '전체 수정'], ['area', '부분 수정'], ['outpaint', '캔버스 확장']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>
          ))}
        </div>
        <div className="edit-workspace__body">
          <div className="edit-workspace__preview">
            {loading ? <div role="status">이미지 준비 중…</div> : <>
              <div className="edit-workspace__image-stage">
                <img
                  src={source}
                  alt="수정할 원본"
                  onLoad={(event) => {
                    const canvas = overlayRef.current;
                    if (!canvas) return;
                    canvas.width = event.currentTarget.naturalWidth;
                    canvas.height = event.currentTarget.naturalHeight;
                    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
                  }}
                />
                <canvas
                  ref={overlayRef}
                  className={mode === "area" ? "is-drawable" : ""}
                  onPointerDown={(event) => { if (mode !== "area") return; pushUndo(); drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); paint(event); }}
                  onPointerMove={paint}
                  onPointerUp={() => { drawing.current = false; }}
                  onPointerCancel={() => { drawing.current = false; }}
                />
              </div>
            </>}
          </div>
          <div className="edit-workspace__controls">
            {mode === "area" ? <>
              <label>브러시 크기 <output>{brush}px</output><input type="range" min={16} max={240} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label>
              <div className="edit-workspace__undo">
                <button type="button" disabled={!undo.length} onClick={() => { const previous = undo.at(-1); if (!previous) return; setRedo((items) => [...items, snapshot()]); setUndo((items) => items.slice(0, -1)); void restoreOverlay(previous); }}>되돌리기</button>
                <button type="button" disabled={!redo.length} onClick={() => { const next = redo.at(-1); if (!next) return; setUndo((items) => [...items, snapshot()]); setRedo((items) => items.slice(0, -1)); void restoreOverlay(next); }}>다시 실행</button>
                <button type="button" onClick={() => { pushUndo(); void restoreOverlay(""); }}>영역 지우기</button>
              </div>
              <p>바꿀 부분만 붉게 칠해 주세요.</p>
            </> : null}
            {mode === "outpaint" ? <label>확장 비율<select value={aspect} onChange={(event) => setAspect(event.target.value as Aspect)}><option value="keep">사방 25% 확장</option><option value="1:1">정사각형 1:1</option><option value="3:2">가로 3:2</option><option value="2:3">세로 2:3</option></select></label> : null}
            <label className="edit-workspace__prompt">수정 지시<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "area" ? "예: 선택한 셔츠를 짙은 남색 재킷으로 바꿔줘" : mode === "outpaint" ? "예: 주변 풍경을 자연스럽게 이어서 채워줘" : "예: 인물은 유지하고 배경을 야간 도시로 바꿔줘"} autoFocus /></label>
          </div>
        </div>
        <footer>
          <button type="button" onClick={onClose}>취소</button>
          <button type="button" className="primary" disabled={loading || activeGenerations > 0 || !prompt.trim()} onClick={() => void submit()}>{activeGenerations > 0 ? "수정 중…" : "새 결과로 저장"}</button>
        </footer>
      </section>
    </div>
  );
}
