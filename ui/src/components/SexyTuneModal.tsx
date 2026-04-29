import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

type CategoryMeta = { id: string; label: string; category: string; risk: string };

type Props = {
  open: boolean;
  onClose: () => void;
};

// All inline styles use the project's existing CSS variables (defined in
// index.css :root and :root[data-theme="light"]) so the modal automatically
// adapts between dark and light themes:
//   --surface    modal panel background
//   --surface-2  inset/footer background, soft chips
//   --border     dividers + neutral button outlines
//   --text       primary text
//   --text-dim   secondary text
//   --accent     primary action color (dark→white, light→near-black)
//   --bg         page background — used as the contrast color on accent
//   --amber      warning highlight
export function SexyTuneModal({ open, onClose }: Props) {
  const runSexyTuneBatch = useAppStore((s) => s.runSexyTuneBatch);
  const refsCount = useAppStore((s) => s.referenceImages.length);
  const sizePreset = useAppStore((s) => s.sizePreset);

  // Persist last-used options across modal opens (also across page reloads).
  // Stored in localStorage as a JSON blob; missing/corrupt → fall back to
  // sensible defaults. Schema-versioned so we can migrate safely later.
  const PREFS_KEY = "ima2.sexyTune.prefs.v1";
  type Prefs = {
    count: number;
    maxRisk: "low" | "medium";
    selectedCats: string[];
    cameraTone: "canon" | "iphone";
    includeMirror: boolean;
    includeFlirty: boolean;
    autoFillOnFail: boolean;
    maxResolution: boolean;
    framingMode: "mixed" | "full-body" | "half-body";
  };
  const loadPrefs = (): Partial<Prefs> => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  };
  const initial = loadPrefs();

  const [count, setCount] = useState(
    typeof initial.count === "number" ? initial.count : 4,
  );
  const [maxRisk, setMaxRisk] = useState<"low" | "medium">(
    initial.maxRisk === "low" ? "low" : "medium",
  );
  const [presets, setPresets] = useState<CategoryMeta[] | null>(null);
  const [selectedCats, setSelectedCats] = useState<string[]>(
    Array.isArray(initial.selectedCats) ? initial.selectedCats : [],
  );
  const [cameraTone, setCameraTone] = useState<"canon" | "iphone">(
    initial.cameraTone === "canon" ? "canon" : "iphone",
  );
  const [includeMirror, setIncludeMirror] = useState(
    initial.includeMirror === true,
  );
  const [includeFlirty, setIncludeFlirty] = useState(
    initial.includeFlirty !== false,
  );
  const [autoFillOnFail, setAutoFillOnFail] = useState(
    initial.autoFillOnFail !== false,
  );
  const [maxResolution, setMaxResolution] = useState(
    initial.maxResolution !== false,
  );
  const [framingMode, setFramingMode] = useState<"mixed" | "full-body" | "half-body">(
    initial.framingMode === "full-body" || initial.framingMode === "half-body"
      ? initial.framingMode
      : "mixed",
  );
  const [preview, setPreview] = useState<
    Array<{ id: string; label: string; category: string; risk: string }> | null
  >(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [stats, setStats] = useState<Record<
    string,
    { passRate: number | null; total: number }
  > | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!presets) {
      fetch("/api/outfit/categories")
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled && Array.isArray(data?.presets)) setPresets(data.presets);
        })
        .catch(() => {
          if (!cancelled) setPresets([]);
        });
    }
    // Always refresh stats on open — sidecar history may have grown since
    // the last time the modal was used.
    fetch("/api/outfit/stats")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.stats) {
          const out: Record<string, { passRate: number | null; total: number }> = {};
          for (const [id, s] of Object.entries(data.stats as Record<string, { passRate: number | null; total: number }>)) {
            out[id] = { passRate: s.passRate, total: s.total };
          }
          setStats(out);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, presets]);

  const samplePreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/outfit/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count,
          maxRisk,
          categories: selectedCats.length > 0 ? selectedCats : undefined,
          aspectRatio: sizePreset === "auto" ? "1:1" : sizePreset,
          cameraTone,
          includeMirror,
          includeFlirty,
          framingMode,
          useWeights: true,
          hasReferences: refsCount > 0,
        }),
      });
      const data = await res.json();
      setPreview(Array.isArray(data?.variants) ? data.variants : []);
    } catch {
      setPreview([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Persist current option set whenever the user adjusts anything. Must run
  // BEFORE the `if (!open) return null` early return so React sees the same
  // hook order on every render (otherwise: error #310 — rendered more
  // hooks than during the previous render).
  useEffect(() => {
    if (!open) return;
    try {
      const blob: Prefs = {
        count,
        maxRisk,
        selectedCats,
        cameraTone,
        includeMirror,
        includeFlirty,
        autoFillOnFail,
        maxResolution,
        framingMode,
      };
      localStorage.setItem(PREFS_KEY, JSON.stringify(blob));
    } catch {
      // localStorage unavailable (private mode / quota) — silently skip.
    }
  }, [
    open,
    count,
    maxRisk,
    selectedCats,
    cameraTone,
    includeMirror,
    includeFlirty,
    autoFillOnFail,
    maxResolution,
    framingMode,
  ]);

  if (!open) return null;

  const allCategories = presets
    ? [...new Set(presets.map((p) => p.category))].sort()
    : [];
  const filteredCount = (() => {
    if (!presets) return 0;
    return presets.filter((p) => {
      if (maxRisk === "low" && p.risk !== "low") return false;
      if (selectedCats.length > 0 && !selectedCats.includes(p.category)) return false;
      return true;
    }).length;
  })();

  const toggleCat = (cat: string) => {
    setSelectedCats((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const start = () => {
    // Fire-and-forget so the user can close the modal and queue another
    // batch with a different reference image immediately. The store
    // snapshots references at start, so this batch keeps using THIS image
    // even after the user swaps it for the next batch.
    const aspectRatio = sizePreset === "auto" ? "1:1" : sizePreset;
    runSexyTuneBatch({
      count,
      maxRisk,
      categories: selectedCats.length > 0 ? selectedCats : undefined,
      aspectRatio,
      cameraTone,
      includeMirror,
      includeFlirty,
      autoFillOnFail,
      maxResolution,
      framingMode,
    }).catch((e) => {
      console.error("[sexy-tune] batch error:", e);
    });
    onClose();
  };

  // 2026-04-29 — 참조 사진 0장이어도 시작 가능 (random mode). 카테고리
  // 필터로 풀이 0개로 줄어들면 막음.
  const canStart = filteredCount > 0;

  const fieldset: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 12px",
    display: "grid",
    gap: 6,
    color: "var(--text)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: "100%",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 32px)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>
            🎲 섹시 다듬기
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text)",
              fontSize: 22,
              cursor: "pointer",
              padding: "0 6px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            display: "grid",
            gap: 16,
            padding: 16,
            overflow: "auto",
            color: "var(--text)",
          }}
        >
          {refsCount === 0 && (
            <div
              style={{
                padding: 8,
                border: "1px solid var(--border)",
                color: "var(--text-dim)",
                borderRadius: 6,
                fontSize: 13,
                background: "var(--surface-2)",
              }}
            >
              참고 이미지가 없어 <b>랜덤 모드</b>로 진행됩니다. 매 컷 다른
              얼굴이 생성됩니다 (시리즈성 없음). 같은 얼굴로 옷·배경만 바꾸려면
              참고 사진을 먼저 첨부하세요.
            </div>
          )}

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
              몇 장 만들까요?
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="range"
                min={1}
                max={8}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span
                style={{
                  minWidth: 32,
                  textAlign: "right",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                {count}장
              </span>
            </div>
          </label>

          <fieldset style={fieldset}>
            <legend
              style={{ fontSize: 12, color: "var(--text-dim)", padding: "0 4px" }}
            >
              risk level
            </legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={maxRisk === "low"}
                onChange={() => setMaxRisk("low")}
              />
              <span>안전 (라운지/스포츠/원피스 위주)</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={maxRisk === "medium"}
                onChange={() => setMaxRisk("medium")}
              />
              <span>기본 (비키니/크롭/시착도 포함)</span>
            </label>
          </fieldset>

          <fieldset style={fieldset}>
            <legend
              style={{ fontSize: 12, color: "var(--text-dim)", padding: "0 4px" }}
            >
              카메라 톤 (자주 쓰시는 표현 기반)
            </legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={cameraTone === "canon"}
                onChange={() => setCameraTone("canon")}
              />
              <span>📸 Canon DSLR (잡지 톤, 검열 통과율 높음)</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={cameraTone === "iphone"}
                onChange={() => setCameraTone("iphone")}
              />
              <span>📱 아이폰 스냅 (자연스러운 일상 톤)</span>
            </label>
          </fieldset>

          <fieldset style={fieldset}>
            <legend
              style={{ fontSize: 12, color: "var(--text-dim)", padding: "0 4px" }}
            >
              프레이밍 (몸 어디까지 보일지)
            </legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={framingMode === "mixed"}
                onChange={() => setFramingMode("mixed")}
              />
              <span>🎲 자동 (전신·반신·얼굴 다양하게 섞기)</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={framingMode === "full-body"}
                onChange={() => setFramingMode("full-body")}
              />
              <span>🧍 전신만 (머리부터 발끝까지, 다리·발 강제)</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={framingMode === "half-body"}
                onChange={() => setFramingMode("half-body")}
              />
              <span>👤 반신만 (얼굴/상반신 위주, 클로즈업 톤)</span>
            </label>
          </fieldset>

          <fieldset style={fieldset}>
            <legend
              style={{ fontSize: 12, color: "var(--text-dim)", padding: "0 4px" }}
            >
              내 스타일 추가 옵션
            </legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeMirror}
                onChange={(e) => setIncludeMirror(e.target.checked)}
              />
              <span>🪞 거울에 뒷모습 비치는 구도</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={includeFlirty}
                onChange={(e) => setIncludeFlirty(e.target.checked)}
              />
              <span>✨ 청순하고 발랄한 분위기</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={autoFillOnFail}
                onChange={(e) => setAutoFillOnFail(e.target.checked)}
              />
              <span>🔁 실패하면 다른 의상으로 자동 보충</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={maxResolution}
                onChange={(e) => setMaxResolution(e.target.checked)}
              />
              <span>🔥 최고 해상도 + 품질 (2K~4K, high quality)</span>
            </label>
          </fieldset>

          {allCategories.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                카테고리 (선택 안 하면 전체)
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {allCategories.map((cat) => {
                  const active = selectedCats.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCat(cat)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        border: `1px solid ${
                          active ? "var(--accent)" : "var(--border)"
                        }`,
                        borderRadius: 999,
                        background: active ? "var(--accent)" : "transparent",
                        color: active ? "var(--bg)" : "var(--text)",
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                미리보기 (시작 전 어떤 의상이 뽑혔는지 확인)
              </span>
              <button
                type="button"
                onClick={samplePreview}
                disabled={previewLoading || filteredCount === 0}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--surface)",
                  color: "var(--text)",
                  cursor:
                    previewLoading || filteredCount === 0 ? "not-allowed" : "pointer",
                }}
              >
                {previewLoading
                  ? "샘플링 중…"
                  : preview
                  ? "🔄 다시 뽑기"
                  : "🎯 변형 미리 뽑기"}
              </button>
            </div>
            {preview && preview.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gap: 4,
                  padding: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                {preview.map((v, i) => {
                  const stat = stats?.[v.id];
                  const passLabel =
                    stat && stat.total >= 2 && stat.passRate !== null
                      ? `${Math.round(stat.passRate * 100)}% (${stat.total}회)`
                      : "신규";
                  return (
                    <div
                      key={`${v.id}-${i}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        color: "var(--text)",
                      }}
                    >
                      <span style={{ color: "var(--text-dim)", minWidth: 20 }}>
                        #{i + 1}
                      </span>
                      <strong>{v.label}</strong>
                      <span style={{ color: "var(--text-dim)" }}>
                        · {v.category} · risk={v.risk}
                      </span>
                      <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>
                        통과율 {passLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {preview && preview.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  padding: 8,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                풀이 비었습니다. 카테고리 선택을 줄여보세요.
              </div>
            )}
          </div>

          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              padding: "6px 8px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
          >
            현재 풀에서 사용 가능한 변형:{" "}
            <strong style={{ color: "var(--text)" }}>{filteredCount}개</strong>
            {filteredCount < count && (
              <> (요청한 {count}개보다 적어 일부는 중복될 수 있습니다)</>
            )}
            <br />
            첨부 이미지 {refsCount}장 · 비율{" "}
            {sizePreset === "auto" ? "1:1" : sizePreset}
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: 16,
            borderTop: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            style={{
              padding: "8px 16px",
              border: `1px solid ${canStart ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 6,
              background: canStart ? "var(--accent)" : "var(--surface-2)",
              color: canStart ? "var(--bg)" : "var(--text-dim)",
              cursor: canStart ? "pointer" : "not-allowed",
              fontSize: 14,
              fontWeight: 600,
              minWidth: 120,
            }}
          >
            {`${count}장 시작 (백그라운드)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
