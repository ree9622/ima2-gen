import type { ReactNode } from "react";

export type OptionItem<V extends string> = {
  value: V;
  label: ReactNode;
  sub?: ReactNode;
  color?: string;
};

type Props<V extends string> = {
  title?: string;
  // 이 그룹이 실제로는 그대로 적용되지 않을 때 그 사실을 적는 자리.
  hint?: ReactNode;
  items: ReadonlyArray<OptionItem<V>>;
  value: V;
  onChange: (v: V) => void;
};

export function OptionGroup<V extends string>({ title, hint, items, value, onChange }: Props<V>) {
  return (
    <div className="option-group">
      {title ? <div className="section-title">{title}</div> : null}
      {hint ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", margin: "-2px 0 6px" }}>{hint}</div>
      ) : null}
      <div className="option-row">
        {items.map((it) => (
          <button
            key={it.value}
            className={`option-btn${it.value === value ? " active" : ""}`}
            style={it.color ? { color: it.color } : undefined}
            onClick={() => onChange(it.value)}
            type="button"
          >
            {it.label}
            {it.sub ? (
              <>
                <br />
                <span className="option-sub">{it.sub}</span>
              </>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
