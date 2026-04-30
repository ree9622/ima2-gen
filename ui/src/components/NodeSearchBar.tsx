import { useAppStore, type ImageNodeStatus } from "../store/useAppStore";

const STATUS_CHIPS: { value: ImageNodeStatus; label: string }[] = [
  { value: "ready", label: "완료" },
  { value: "pending", label: "생성중" },
  { value: "error", label: "오류" },
  { value: "empty", label: "비어있음" },
];

export function NodeSearchBar() {
  const text = useAppStore((s) => s.nodeFilterText);
  const statuses = useAppStore((s) => s.nodeFilterStatuses);
  const setText = useAppStore((s) => s.setNodeFilterText);
  const toggleStatus = useAppStore((s) => s.toggleNodeFilterStatus);
  const clear = useAppStore((s) => s.clearNodeFilters);
  const totalNodes = useAppStore((s) => s.graphNodes.length);

  const active = text.trim().length > 0 || statuses.length > 0;

  return (
    <div className="node-search-bar nodrag">
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`프롬프트 검색… (전체 ${totalNodes})`}
        className="node-search-bar__input"
      />
      <div className="node-search-bar__chips">
        {STATUS_CHIPS.map((chip) => {
          const on = statuses.includes(chip.value);
          return (
            <button
              key={chip.value}
              type="button"
              className="node-search-bar__chip"
              aria-pressed={on}
              onClick={() => toggleStatus(chip.value)}
            >
              {chip.label}
            </button>
          );
        })}
        {active ? (
          <button
            type="button"
            className="node-search-bar__clear"
            onClick={clear}
            title="필터 초기화"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
