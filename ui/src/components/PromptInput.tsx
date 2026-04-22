import { useAppStore } from "../store/useAppStore";

export function PromptInput() {
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const generate = useAppStore((s) => s.generate);

  return (
    <>
      <div className="section-title">Prompt</div>
      <textarea
        className="prompt-area"
        value={prompt}
        placeholder="Describe the image you want to generate..."
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void generate();
          }
        }}
      />
    </>
  );
}
