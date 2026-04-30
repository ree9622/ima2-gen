import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import { StyleChips } from "./StyleChips";
import { EnhanceModal } from "./EnhanceModal";
import { SexyTuneModal } from "./SexyTuneModal";
import { RefBundlesModal } from "./RefBundlesModal";
import { PromptBundlesModal } from "./PromptBundlesModal";
import { enhancePrompt as apiEnhance } from "../lib/api";

const MAX_REFS = 5;

// Per-prompt cap when importing .txt files. Each .txt is one prompt; very
// long files are typically a paste mistake (e.g. a whole document) rather
// than an intentional 10k-char prompt, so we clamp instead of bailing.
const TXT_PROMPT_MAX = 8000;

// Hard ceiling on how many .txt files we'll process in one batch. Above this
// we ask for confirmation since the multiplier with `count` can be huge
// (50 files × 4 = 200 generations).
const TXT_BATCH_CONFIRM_THRESHOLD = 20;
const TXT_BATCH_HARD_CAP = 500;

// Throttling — running 31 generates back-to-back killed the local OAuth
// proxy (auto-restart loop, every following request → "fetch failed").
// Worse, on 2026-04-30 the main Node process took a SIGSEGV during a
// 31-prompt batch (status=11/SEGV in the systemd journal) — likely from
// concurrent better-sqlite3 + undici load. Cut the chunk size hard so
// only N requests are ever in-flight at once. Smaller chunks also mean
// shorter waits between visible progress for the user.
const TXT_BATCH_CHUNK_SIZE = 2;
const TXT_BATCH_CHUNK_DELAY_MS = 4000;
// Stop the whole run after this many prompts produced zero new history
// rows in a row — almost always a sign the upstream stopped responding
// (proxy crash / network drop / OpenAI outage). Trying 30 more wastes
// minutes for guaranteed failures.
const TXT_BATCH_CONSECUTIVE_FAIL_LIMIT = 3;

export function PromptComposer() {
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const generate = useAppStore((s) => s.generate);
  const count = useAppStore((s) => s.count);
  const showToast = useAppStore((s) => s.showToast);
  const originalPrompt = useAppStore((s) => s.originalPrompt);
  const applyEnhancedPrompt = useAppStore((s) => s.applyEnhancedPrompt);
  const revertToOriginalPrompt = useAppStore((s) => s.revertToOriginalPrompt);
  const clearOriginalPrompt = useAppStore((s) => s.clearOriginalPrompt);

  const refs = useAppStore((s) => s.referenceImages);
  const addReferences = useAppStore((s) => s.addReferences);
  const removeReference = useAppStore((s) => s.removeReference);
  const useCurrentAsReference = useAppStore((s) => s.useCurrentAsReference);
  const currentImage = useAppStore((s) => s.currentImage);

  const fileInput = useRef<HTMLInputElement>(null);
  const txtBatchInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [sexyTuneOpen, setSexyTuneOpen] = useState(false);
  const [bundlesOpen, setBundlesOpen] = useState(false);
  const [promptBundlesOpen, setPromptBundlesOpen] = useState(false);
  const [txtBatchRunning, setTxtBatchRunning] = useState(false);

  const canAddMore = refs.length < MAX_REFS;

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) void addReferences(files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const extractClipboardImages = (items: DataTransferItemList | null): File[] => {
    if (!items) return [];
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind !== "file") continue;
      if (!it.type.startsWith("image/")) continue;
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    return files;
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!canAddMore) return;
    const files = extractClipboardImages(e.clipboardData?.items ?? null);
    if (files.length === 0) return;
    e.preventDefault();
    const room = MAX_REFS - refs.length;
    void addReferences(files.slice(0, room));
  };

  // Read .txt files (one file = one prompt) and fire generate sequentially
  // in small chunks. Right-panel options (count / quality / size / refs /
  // format) come from the store; we only override prompt. Total images
  // produced = N files × store.count when everything succeeds.
  //
  // Robustness vs. the naive "for await generate" loop:
  //   1. Chunk into TXT_BATCH_CHUNK_SIZE; sleep TXT_BATCH_CHUNK_DELAY_MS
  //      between chunks so the local OAuth proxy can settle. Without this
  //      a 30+ batch killed the proxy and the next 25 calls all failed
  //      with "fetch failed" while it was auto-restarting.
  //   2. Track success via history.length diff before/after each call —
  //      `generate` swallows its own errors (sets toast + inflight=error
  //      but never throws), so try/catch alone wouldn't catch them.
  //   3. Bail when usage-limited cool-down kicks in (would silently no-op
  //      anyway), or when N consecutive prompts produce zero new history
  //      rows (upstream is gone — keep going wastes minutes).
  const handleTxtBatch = async (files: File[]) => {
    if (txtBatchRunning) {
      showToast("이미 일괄 생성이 진행 중입니다.", true);
      return;
    }
    if (files.length === 0) return;
    if (files.length > TXT_BATCH_HARD_CAP) {
      showToast(`한 번에 ${TXT_BATCH_HARD_CAP}개까지만 처리할 수 있습니다.`, true);
      return;
    }

    // Read each file → strip BOM → trim → clamp. Drop empties (spaces only,
    // wrong encoding, etc.) so we don't fire generate("") for them.
    const prompts: { name: string; text: string }[] = [];
    for (const f of files) {
      try {
        const raw = await f.text();
        const text = raw.replace(/^﻿/, "").trim().slice(0, TXT_PROMPT_MAX);
        if (text) prompts.push({ name: f.name, text });
      } catch (err) {
        console.warn("[txt-batch] failed to read", f.name, err);
      }
    }
    if (prompts.length === 0) {
      showToast("불러온 .txt 에 사용할 텍스트가 없습니다.", true);
      return;
    }

    const total = prompts.length * count;
    if (prompts.length >= TXT_BATCH_CONFIRM_THRESHOLD) {
      const ok = window.confirm(
        `프롬프트 ${prompts.length}개 × 개수 ${count}장 = 총 ${total}장.\n` +
          `${TXT_BATCH_CHUNK_SIZE}개씩 끊어서 ${TXT_BATCH_CHUNK_DELAY_MS / 1000}초 휴식하며 진행됩니다. 계속?`,
      );
      if (!ok) return;
    }

    setTxtBatchRunning(true);
    showToast(
      `텍스트 일괄 시작: ${prompts.length}개 × ${count}장 = 총 ${total}장 ` +
        `(${TXT_BATCH_CHUNK_SIZE}개 동시, 묶음 사이 ${TXT_BATCH_CHUNK_DELAY_MS / 1000}초 휴식)`,
    );
    console.log(
      `[txt-batch] start: prompts=${prompts.length} count=${count} ` +
      `chunkSize=${TXT_BATCH_CHUNK_SIZE} chunkDelay=${TXT_BATCH_CHUNK_DELAY_MS}ms`,
    );

    let succeeded = 0; // number of *images* added to history (count-aware)
    let failedPrompts = 0; // prompts that produced 0 new history rows
    let consecutiveFailedChunks = 0;
    let stopReason: string | null = null;

    try {
      for (let chunkStart = 0; chunkStart < prompts.length; chunkStart += TXT_BATCH_CHUNK_SIZE) {
        // Bail early if cool-down kicked in (429). Subsequent generate calls
        // would silent-no-op anyway.
        const cool = useAppStore.getState().usageLimitedUntil;
        if (cool && cool > Date.now()) {
          stopReason = "OpenAI 사용 한도(429) 로 일괄 중단";
          console.warn(`[txt-batch] cool-down active until ${new Date(cool).toISOString()} — stopping`);
          break;
        }

        const chunk = prompts.slice(chunkStart, chunkStart + TXT_BATCH_CHUNK_SIZE);
        const chunkNum = Math.floor(chunkStart / TXT_BATCH_CHUNK_SIZE) + 1;
        const totalChunks = Math.ceil(prompts.length / TXT_BATCH_CHUNK_SIZE);
        console.log(
          `[txt-batch] chunk ${chunkNum}/${totalChunks} firing ${chunk.length}: ` +
          chunk.map((c) => c.name).join(", "),
        );
        showToast(
          `묶음 ${chunkNum}/${totalChunks} 동시 발사 (${chunk.length}개) — 각 generate 끝나는 대로 표시`,
        );

        // Fire all prompts in this chunk in PARALLEL, but track each one
        // individually so the user sees progress as the FAST ones finish
        // instead of waiting for the slowest. (Earlier behavior: a chunk-
        // level diff after Promise.all completed → if one prompt did 7
        // safety retries the user thought everything was stuck for 5
        // minutes when in fact 4 of the 5 had already produced images.)
        const chunkStartedAt = Date.now();
        let chunkAdded = 0;
        let chunkDoneCount = 0;
        const tasks = chunk.map(async ({ name, text }) => {
          const promptStartedAt = Date.now();
          const before = useAppStore.getState().history.length;
          // Defensive: generate() catches internally, but we wrap anyway
          // so a thrown error (e.g. server SIGSEGV mid-request → fetch
          // reject in generate's outer try) never aborts Promise.all
          // and breaks the chunk loop. The history-diff already classes
          // this as "failure" — the throw is just noise to suppress.
          let threw = false;
          try {
            await generate({ overridePrompt: text });
          } catch (err) {
            threw = true;
            console.warn("[txt-batch] generate threw for", name, err);
          }
          const after = useAppStore.getState().history.length;
          const added = after - before;
          chunkDoneCount += 1;
          chunkAdded += added;
          const seconds = Math.max(1, Math.round((Date.now() - promptStartedAt) / 1000));
          const mark = added > 0 ? `✓ +${added}장` : threw ? "✗ 서버 끊김" : "✗ 실패";
          showToast(
            `묶음 ${chunkNum}/${totalChunks} · ${chunkDoneCount}/${chunk.length} ${name} ${mark} (${seconds}s)`,
            added === 0,
          );
          return added;
        });
        await Promise.all(tasks);

        const chunkSeconds = Math.max(1, Math.round((Date.now() - chunkStartedAt) / 1000));
        const expected = chunk.length * count;
        succeeded += chunkAdded;
        const chunkMissed = Math.max(0, expected - chunkAdded);
        if (chunkMissed > 0) {
          failedPrompts += Math.ceil(chunkMissed / Math.max(1, count));
        }

        if (chunkAdded === 0) {
          consecutiveFailedChunks += 1;
          if (consecutiveFailedChunks >= TXT_BATCH_CONSECUTIVE_FAIL_LIMIT) {
            stopReason =
              `연속 ${consecutiveFailedChunks}묶음 전부 실패 — 서버 연결 또는 OAuth proxy 점검 필요`;
            break;
          }
        } else {
          consecutiveFailedChunks = 0;
        }

        const isLast = chunkStart + TXT_BATCH_CHUNK_SIZE >= prompts.length;
        console.log(
          `[txt-batch] chunk ${chunkNum}/${totalChunks} done: +${chunkAdded}/${chunk.length * count} ` +
          `in ${chunkSeconds}s, consecutiveFailedChunks=${consecutiveFailedChunks}, isLast=${isLast}`,
        );
        if (!isLast) {
          showToast(
            `묶음 ${chunkNum}/${totalChunks} 완료 (+${chunkAdded}장 / ${chunkSeconds}s) · ${TXT_BATCH_CHUNK_DELAY_MS / 1000}초 휴식`,
          );
          await new Promise((r) => setTimeout(r, TXT_BATCH_CHUNK_DELAY_MS));
        }
      }
      console.log(`[txt-batch] loop exited: succeeded=${succeeded} failedPrompts=${failedPrompts} stopReason=${stopReason ?? "none"}`);
    } catch (err) {
      console.error("[txt-batch] caught at loop level:", err);
      stopReason = `오류: ${(err as Error).message}`;
    } finally {
      setTxtBatchRunning(false);
    }

    const summary = `일괄 종료 — 성공 ${succeeded}장 / 실패 약 ${failedPrompts}건`;
    if (stopReason) {
      showToast(`${summary} · ${stopReason}`, true);
    } else {
      showToast(summary);
    }
  };

  useEffect(() => {
    const handler = (e: globalThis.ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      const files = extractClipboardImages(e.clipboardData?.items ?? null);
      if (files.length === 0) return;
      if (refs.length >= MAX_REFS) return;
      e.preventDefault();
      const room = MAX_REFS - refs.length;
      void addReferences(files.slice(0, room));
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [refs.length, addReferences]);

  return (
    <div
      className={`composer${dragOver ? " composer--drag" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onPaste={onPaste}
    >
      <div className="composer__header">
        <span className="section-title composer__label">프롬프트</span>
        {refs.length > 0 && (
          <span className="composer__count">
            참조 {refs.length}/{MAX_REFS}
          </span>
        )}
      </div>

      {refs.length > 0 && (
        <div className="composer__ref-hint" role="note">
          {refs.length === 1
            ? "💡 같은 인물의 정면/측면/상반신 등 2~3장을 추가하면 얼굴 일관성이 더 잘 유지돼요"
            : "✓ 다각도 참조 — 얼굴은 자동으로 그대로 유지됩니다. 포즈/의상/배경만 바꿔주세요"}
        </div>
      )}

      {refs.length > 0 && (
        <div className="composer__chips">
          {refs.map((src, i) => (
            <div key={i} className="composer__chip" title={`참조 이미지 ${i + 1}`}>
              <img src={src} alt={`참조 이미지 ${i + 1}`} />
              <button
                type="button"
                className="composer__chip-remove"
                onClick={() => removeReference(i)}
                aria-label={`참조 이미지 ${i + 1} 제거`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        className="prompt-area composer__textarea"
        value={prompt}
        placeholder={
          refs.length > 0
            ? "첨부한 이미지로 무엇을 만들지 설명해 주세요..."
            : "원하는 이미지를 설명하고, 드래그 앤 드롭이나 붙여넣기로 참조 이미지를 추가할 수 있어요..."
        }
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void generate();
            return;
          }
          if ((e.key === "e" || e.key === "E") && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (prompt.trim()) setEnhanceOpen(true);
          }
        }}
      />

      {originalPrompt && (
        <div className="composer__enhance-hint" title={originalPrompt}>
          <span className="composer__enhance-hint-label">다듬기 적용됨</span>
          <span className="composer__enhance-hint-orig">{originalPrompt}</span>
          <button
            type="button"
            className="composer__enhance-hint-action"
            onClick={() => revertToOriginalPrompt()}
            title="원본 프롬프트로 되돌리기"
          >
            되돌리기
          </button>
          <button
            type="button"
            className="composer__enhance-hint-dismiss"
            onClick={() => clearOriginalPrompt()}
            aria-label="원본 보관 해제"
            title="이 알림 닫기 (원본은 그대로 저장됨)"
          >
            ×
          </button>
        </div>
      )}

      <div className="composer__toolbar">
        <button
          type="button"
          className="composer__tool"
          onClick={() => canAddMore && fileInput.current?.click()}
          disabled={!canAddMore}
          title="참조 이미지 첨부"
          aria-label="참조 이미지 첨부"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <span>첨부</span>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => setBundlesOpen(true)}
          title="참조 이미지 묶음 저장/불러오기"
        >
          <span aria-hidden="true">📦</span>
          <span>묶음</span>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => setPromptBundlesOpen(true)}
          title="프롬프트 묶음 저장/불러오기"
        >
          <span aria-hidden="true">📑</span>
          <span>프롬프트 묶음</span>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => txtBatchInput.current?.click()}
          disabled={txtBatchRunning}
          title={`여러 .txt 파일 불러와 일괄 생성 (각 파일 × 개수 ${count}장)`}
        >
          <span aria-hidden="true">📄</span>
          <span>{txtBatchRunning ? "일괄 진행…" : "텍스트 일괄"}</span>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => setSexyTuneOpen(true)}
          disabled={refs.length === 0}
          title="참고 이미지로 N장 자동 생성 (각 다른 의상)"
        >
          <span aria-hidden="true">🎲</span>
          <span>섹시 다듬기</span>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => prompt.trim() && setEnhanceOpen(true)}
          disabled={!prompt.trim()}
          title="프롬프트 자세히 다듬기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span>다듬기</span>
        </button>
        <button
          type="button"
          className="composer__tool"
          onClick={() => void useCurrentAsReference()}
          disabled={!currentImage || !canAddMore}
          title="현재 결과를 참조로 사용"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>현재 결과 사용</span>
        </button>
        <span className="composer__hint">Ctrl + Enter로 생성</span>
      </div>

      <StyleChips />

      {dragOver && (
        <div className="composer__dropzone" aria-hidden="true">
          놓아서 참조 이미지로 추가 ({MAX_REFS}장까지)
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void addReferences(files);
          e.target.value = "";
        }}
      />

      <input
        ref={txtBatchInput}
        type="file"
        accept=".txt,text/plain"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void handleTxtBatch(files);
          e.target.value = "";
        }}
      />

      <SexyTuneModal open={sexyTuneOpen} onClose={() => setSexyTuneOpen(false)} />

      <RefBundlesModal open={bundlesOpen} onClose={() => setBundlesOpen(false)} />

      <PromptBundlesModal open={promptBundlesOpen} onClose={() => setPromptBundlesOpen(false)} />

      <EnhanceModal
        open={enhanceOpen}
        originalPrompt={prompt}
        onClose={() => setEnhanceOpen(false)}
        onApply={(next) => {
          applyEnhancedPrompt(prompt, next);
          setEnhanceOpen(false);
        }}
        enhancer={async (p) => {
          // Strip the "data:image/...;base64," prefix so the server gets the
          // raw base64 (matches the /api/generate references contract).
          const refB64 = (refs ?? [])
            .map((d) => d.replace(/^data:[^;]+;base64,/, ""))
            .filter(Boolean);
          return (await apiEnhance(p, "ko", refB64)).prompt;
        }}
      />
    </div>
  );
}
