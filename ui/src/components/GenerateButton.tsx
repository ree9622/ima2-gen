import { useAppStore } from "../store/useAppStore";

export function GenerateButton() {
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const mode = useAppStore((s) => s.mode);
  const generate = useAppStore((s) => s.generate);

  const loading = activeGenerations > 0;
  const base = mode === "i2i" ? "Edit Image" : "Generate";
  const label = loading ? `${base} (${activeGenerations})` : base;

  return (
    <button
      type="button"
      className={`generate-btn${loading ? " loading" : ""}`}
      onClick={() => void generate()}
    >
      {label}
    </button>
  );
}
