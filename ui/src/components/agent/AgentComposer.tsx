import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { GlobeIcon, PaperclipIcon, SendIcon } from "./AgentIcons";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { filterCommands, type SlashCommandDef } from "./slashCommands";

type Props = {
  webSearchEnabled: boolean;
  insertedPrompt?: { id: number; text: string } | null;
  onWebSearchChange: (enabled: boolean) => void;
  onSend: (text: string) => void;
};

export function AgentComposer({ webSearchEnabled, insertedPrompt, onWebSearchChange, onSend }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listboxId = useId();

  const canSend = draft.trim().length > 0;
  const slashMatch = draft.trimStart().match(/^\/([a-z]*)$/i);
  const inSlashMode = slashMatch !== null;
  const showMenu = inSlashMode && !menuDismissed;
  const slashQuery = slashMatch?.[1] ?? "";
  const filtered = filterCommands(slashQuery);
  const menuVisible = showMenu && filtered.length > 0;

  const safeIndex = filtered.length > 0
    ? Math.min(highlightIndex, filtered.length - 1)
    : 0;
  const activeOptionId = menuVisible
    ? `${listboxId}-opt-${safeIndex}`
    : undefined;

  useEffect(() => {
    setHighlightIndex(0);
    setMenuDismissed(false);
  }, [slashQuery]);

  useEffect(() => {
    if (inSlashMode) setMenuDismissed(false);
  }, [inSlashMode]);

  useEffect(() => {
    if (!insertedPrompt?.text) return;
    setDraft((current) => current.trim() ? `${current.trim()}\n\n${insertedPrompt.text}` : insertedPrompt.text);
  }, [insertedPrompt]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  const handleSelect = (cmd: SlashCommandDef) => {
    setDraft(`/${cmd.name} `);
    textareaRef.current?.focus();
  };

  return (
    <div className="agent-composer">
      {menuVisible && (
        <SlashCommandMenu
          listboxId={listboxId}
          query={slashQuery}
          highlightIndex={safeIndex}
          onSelect={handleSelect}
          onHighlightChange={setHighlightIndex}
        />
      )}
      <textarea
        ref={textareaRef}
        value={draft}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-label={t("agent.composerPlaceholder")}
        {...(menuVisible ? { "aria-controls": listboxId } : {})}
        aria-activedescendant={activeOptionId}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={t("agent.composerPlaceholder")}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
            return;
          }

          if (menuVisible) {
            switch (event.key) {
              case "Tab": {
                event.preventDefault();
                handleSelect(filtered[safeIndex]);
                return;
              }
              case "ArrowDown": {
                event.preventDefault();
                setHighlightIndex((safeIndex + 1) % filtered.length);
                return;
              }
              case "ArrowUp": {
                event.preventDefault();
                setHighlightIndex((safeIndex - 1 + filtered.length) % filtered.length);
                return;
              }
              case "Enter": {
                event.preventDefault();
                handleSelect(filtered[safeIndex]);
                return;
              }
              case "Escape": {
                event.preventDefault();
                setMenuDismissed(true);
                return;
              }
            }
          }
        }}
      />
      <div className="agent-composer__actions">
        <button type="button" aria-label={t("agent.attachReference")} title={t("agent.attachReference")}>
          <PaperclipIcon size={16} />
        </button>
        <button
          type="button"
          className={webSearchEnabled ? "is-active" : ""}
          aria-pressed={webSearchEnabled}
          onClick={() => onWebSearchChange(!webSearchEnabled)}
          aria-label={t("agent.webSearch")}
          title={t("agent.webSearch")}
        >
          <GlobeIcon size={16} />
        </button>
        <button type="button" className="agent-composer__send" onClick={submit} disabled={!canSend} aria-label={t("agent.send")}>
          <SendIcon size={16} />
          <span>{t("agent.send")}</span>
        </button>
      </div>
    </div>
  );
}
