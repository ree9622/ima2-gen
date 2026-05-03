// 프롬프트 라이브러리 모달 (Phase 6.3) — 한 모달 안에서 검색·리스트·삭제·핀·
// 제목수정·적용을 다 한다. upstream의 별도 detail-modal/popover 분리 안 함.

import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import type { PromptItem } from "../lib/api";

export function PromptLibraryModal() {
  const open = useAppStore((s) => s.promptLibraryOpen);
  const close = useAppStore((s) => s.closePromptLibrary);
  const items = useAppStore((s) => s.promptLibraryItems);
  const query = useAppStore((s) => s.promptLibraryQuery);
  const loading = useAppStore((s) => s.promptLibraryLoading);
  const setQuery = useAppStore((s) => s.setPromptLibraryQuery);
  const apply = useAppStore((s) => s.applyPromptFromLibrary);
  const remove = useAppStore((s) => s.deletePromptFromLibrary);
  const togglePin = useAppStore((s) => s.togglePinPromptFromLibrary);
  const rename = useAppStore((s) => s.renamePromptInLibrary);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="prompt-lib__backdrop" onClick={close}>
      <div className="prompt-lib__modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-lib__header">
          <div className="prompt-lib__title">프롬프트 라이브러리</div>
          <div className="prompt-lib__actions">
            <GitHubImportButton />
            <button type="button" className="prompt-lib__close" onClick={close} aria-label="닫기">×</button>
          </div>
        </div>

        <div className="prompt-lib__search">
          <input
            type="text"
            placeholder="제목 또는 본문 검색…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="prompt-lib__list">
          {loading && items.length === 0 ? (
            <div className="prompt-lib__empty">불러오는 중…</div>
          ) : items.length === 0 ? (
            <div className="prompt-lib__empty">
              {query ? `"${query}" 검색 결과 없음` : "저장된 프롬프트가 없습니다. 프롬프트 입력 후 💾 저장 버튼으로 첫 프롬프트를 만들어 보세요."}
            </div>
          ) : (
            items.map((p) => (
              <PromptCard
                key={p.id}
                item={p}
                onApply={() => void apply(p.id)}
                onDelete={() => {
                  if (confirm(`"${p.title || p.body.slice(0, 30)}…" 를 삭제할까요?`)) {
                    void remove(p.id);
                  }
                }}
                onTogglePin={() => void togglePin(p.id)}
                onRename={(title) => void rename(p.id, title)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PromptCard({
  item,
  onApply,
  onDelete,
  onTogglePin,
  onRename,
}: {
  item: PromptItem;
  onApply: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRename: (title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);

  function commitRename() {
    const next = draftTitle.trim();
    if (next !== item.title) onRename(next);
    setRenaming(false);
  }

  return (
    <div className={`prompt-lib__card${item.pinned ? " is-pinned" : ""}`}>
      <button type="button" className="prompt-lib__card-body" onClick={onApply} title="클릭하면 현재 프롬프트로 채워집니다">
        {renaming ? null : item.title ? (
          <div className="prompt-lib__card-title">
            {item.pinned && <span className="prompt-lib__pin-badge">📌</span>}
            {item.title}
          </div>
        ) : null}
        <div className="prompt-lib__card-preview">{item.body.length > 160 ? item.body.slice(0, 160) + "…" : item.body}</div>
        <div className="prompt-lib__card-meta">
          {item.useCount > 0 && <span>사용 {item.useCount}회</span>}
          {item.lastUsedAt && <span>{new Date(item.lastUsedAt).toLocaleDateString("ko-KR")}</span>}
        </div>
      </button>

      {renaming && (
        <div className="prompt-lib__rename">
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraftTitle(item.title);
                setRenaming(false);
              }
            }}
            placeholder="제목 (선택)"
            autoFocus
          />
          <button type="button" onClick={commitRename}>저장</button>
        </div>
      )}

      <div className="prompt-lib__card-actions">
        <button type="button" onClick={onTogglePin} title={item.pinned ? "핀 해제" : "핀 고정"}>
          {item.pinned ? "📌" : "📍"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraftTitle(item.title);
            setRenaming((v) => !v);
          }}
          title="제목 수정"
        >
          ✏️
        </button>
        <button type="button" onClick={onDelete} title="삭제">🗑</button>
      </div>
    </div>
  );
}

function GitHubImportButton() {
  const importFromGitHub = useAppStore((s) => s.importPromptsFromGitHub);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className="prompt-lib__github-btn"
        onClick={() => setOpen((v) => !v)}
        title="GitHub URL 의 fenced code block 들을 일괄 가져오기"
      >
        📥 GitHub
      </button>
      {open && (
        <div className="prompt-lib__github-pop">
          <input
            type="url"
            placeholder="github.com/user/repo/blob/main/prompts.md"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void onSubmit();
              }
            }}
            autoFocus
          />
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={() => void onSubmit()}
          >
            {busy ? "가져오는 중…" : "가져오기"}
          </button>
          <button type="button" onClick={() => { setOpen(false); setUrl(""); }}>닫기</button>
        </div>
      )}
    </>
  );
  async function onSubmit() {
    setBusy(true);
    try {
      const r = await importFromGitHub(url.trim());
      if (r.created > 0) { setOpen(false); setUrl(""); }
    } finally {
      setBusy(false);
    }
  }
}
