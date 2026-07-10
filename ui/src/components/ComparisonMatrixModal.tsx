import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { postGenerateStream } from "../lib/api";
import {
  buildComparisonCells,
  comparisonCellCount,
  MAX_COMPARISON_CELLS,
  toggleComparisonValue,
  type ComparisonAxes,
  type ComparisonCellConfig,
} from "../lib/comparisonMatrix";
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from "../lib/reasoning";
import { composePrompt, cloneInsertedPrompts } from "../store/storePersistence";
import { useAppStore } from "../store/useAppStore";
import {
  isMultiResponse,
  type GenerateItem,
  type GenerateRequest,
  type OpenAIImageModel,
  type Quality,
} from "../types";
import "../styles/comparison-matrix.css";

const MODELS: OpenAIImageModel[] = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
];
const QUALITIES: Quality[] = ["low", "medium", "high"];
const SIZES = ["1024x1024", "1536x1024", "1024x1536", "2048x2048"];
const OPENAI_MODELS = new Set<string>(MODELS);
const WORKER_LIMIT = 3;

type CellStatus = "queued" | "running" | "done" | "error" | "canceled";
type ComparisonCell = ComparisonCellConfig & {
  status: CellStatus;
  result?: GenerateItem;
  error?: string;
};
type LockedRequest = Omit<GenerateRequest, "model" | "quality" | "reasoningEffort" | "requestId" | "size">;

function asOpenAIModel(model: string): OpenAIImageModel {
  return OPENAI_MODELS.has(model) ? model as OpenAIImageModel : "gpt-5.4";
}

function responseToItem(
  response: Awaited<ReturnType<typeof postGenerateStream>>,
  prompt: string,
  config: ComparisonCellConfig,
): GenerateItem {
  const image = isMultiResponse(response) ? response.images[0] : response;
  if (!image?.image) throw new Error("Comparison cell returned no image");
  return {
    image: image.image,
    filename: image.filename,
    providerUrl: image.providerUrl ?? null,
    prompt,
    elapsed: response.elapsed,
    provider: response.provider,
    usage: response.usage,
    requestId: response.requestId ?? null,
    quality: config.quality,
    size: config.size,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    createdAt: image.createdAt ?? Date.now(),
  };
}

function AxisGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="comparison-axis">
      <legend>{label}</legend>
      <div className="comparison-axis__options">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`comparison-axis__chip${selected.includes(option.value) ? " active" : ""}`}
            aria-pressed={selected.includes(option.value)}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ComparisonMatrixModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const initialModel = useAppStore((state) => asOpenAIModel(state.imageModel));
  const initialReasoning = useAppStore((state) => state.reasoningEffort);
  const initialQuality = useAppStore((state) => state.quality);
  const initialSize = useAppStore((state) => state.getResolvedSize());
  const [axes, setAxes] = useState<ComparisonAxes>({
    models: [initialModel],
    reasoningEfforts: [initialReasoning],
    qualities: [initialQuality],
    sizes: [SIZES.includes(initialSize) ? initialSize : "1024x1024"],
  });
  const [cells, setCells] = useState<ComparisonCell[]>([]);
  const [running, setRunning] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const runSequence = useRef(0);
  const count = comparisonCellCount(axes);
  const countValid = count >= 2 && count <= MAX_COMPARISON_CELLS;
  const completed = cells.filter((cell) => cell.status === "done").length;

  const modelOptions = useMemo(
    () => MODELS.map((value) => ({ value, label: value.replace("gpt-", "GPT ") })),
    [],
  );
  const reasoningOptions = useMemo(
    () => REASONING_EFFORT_OPTIONS.map((option) => ({
      value: option.value,
      label: option.value === "none" ? t("settings.reasoning.none") : option.value,
    })),
    [t],
  );

  const updateCell = (id: string, patch: Partial<ComparisonCell>) => {
    setCells((current) => current.map((cell) => cell.id === id ? { ...cell, ...patch } : cell));
  };

  const lockRequest = (): LockedRequest => {
    const state = useAppStore.getState();
    const prompt = composePrompt(state.prompt, state.insertedPrompts);
    if (!prompt) throw new Error(t("toast.promptRequired"));
    return {
      prompt,
      format: state.format,
      moderation: state.moderation,
      provider: state.provider,
      n: 1,
      webSearchEnabled: state.webSearchEnabled,
      mode: state.promptMode,
      composerPrompt: state.prompt,
      composerInsertedPrompts: cloneInsertedPrompts(state.insertedPrompts),
      ...(state.providerUrlReference
        ? { providerUrl: state.providerUrlReference }
        : state.referenceImages.length
          ? { references: state.referenceImages.map((value) => value.replace(/^data:[^;]+;base64,/, "")) }
          : {}),
    };
  };

  const runCell = async (config: ComparisonCellConfig, lockedRequest = lockRequest()) => {
    const state = useAppStore.getState();
    const requestId = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    controllers.current.set(config.id, controller);
    updateCell(config.id, { status: "running", error: undefined });
    try {
      const response = await postGenerateStream({
        ...lockedRequest,
        quality: config.quality,
        size: config.size,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        requestId,
      }, { signal: controller.signal });
      const result = responseToItem(response, lockedRequest.prompt, config);
      await state.addGeneratedHistoryItem(result);
      updateCell(config.id, { status: "done", result });
    } catch (error) {
      const canceled = controller.signal.aborted || (error as Error).name === "AbortError";
      updateCell(config.id, {
        status: canceled ? "canceled" : "error",
        error: canceled ? undefined : (error as Error).message,
      });
    } finally {
      controllers.current.delete(config.id);
    }
  };

  const runAll = async () => {
    if (!countValid || running) return;
    const configs = buildComparisonCells(axes);
    const lockedRequest = lockRequest();
    const runId = ++runSequence.current;
    setCells(configs.map((config) => ({ ...config, status: "queued" })));
    setRunning(true);
    let cursor = 0;
    const worker = async () => {
      while (runSequence.current === runId && cursor < configs.length) {
        const config = configs[cursor++];
        await runCell(config, lockedRequest);
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKER_LIMIT, configs.length) }, worker));
    if (runSequence.current === runId) setRunning(false);
  };

  const cancelAll = () => {
    runSequence.current += 1;
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    setCells((current) => current.map((cell) =>
      cell.status === "queued" || cell.status === "running"
        ? { ...cell, status: "canceled" }
        : cell,
    ));
    setRunning(false);
  };

  const close = () => {
    if (running) cancelAll();
    onClose();
  };

  return createPortal((
    <div className="comparison-modal" role="dialog" aria-modal="true" aria-labelledby="comparison-title">
      <button className="comparison-modal__backdrop" type="button" aria-label={t("comparison.close")} onClick={close} />
      <section className="comparison-modal__panel">
        <header className="comparison-modal__header">
          <div>
            <h2 id="comparison-title">{t("comparison.title")}</h2>
            <p>{t("comparison.subtitle")}</p>
          </div>
          <button type="button" className="comparison-modal__close" onClick={close} aria-label={t("comparison.close")}>×</button>
        </header>

        <div className="comparison-modal__body">
          <aside className="comparison-builder">
            <AxisGroup label={t("comparison.model")} options={modelOptions} selected={axes.models} onToggle={(value) => setAxes((current) => ({ ...current, models: toggleComparisonValue(current.models, value) }))} />
            <AxisGroup label={t("comparison.reasoning")} options={reasoningOptions} selected={axes.reasoningEfforts} onToggle={(value: ReasoningEffort) => setAxes((current) => ({ ...current, reasoningEfforts: toggleComparisonValue(current.reasoningEfforts, value) }))} />
            <AxisGroup label={t("comparison.quality")} options={QUALITIES.map((value) => ({ value, label: value }))} selected={axes.qualities} onToggle={(value) => setAxes((current) => ({ ...current, qualities: toggleComparisonValue(current.qualities, value) }))} />
            <AxisGroup label={t("comparison.size")} options={SIZES.map((value) => ({ value, label: value.replace("x", "×") }))} selected={axes.sizes} onToggle={(value) => setAxes((current) => ({ ...current, sizes: toggleComparisonValue(current.sizes, value) }))} />
            <div className={`comparison-builder__count${count > MAX_COMPARISON_CELLS ? " invalid" : ""}`}>
              {t("comparison.cellCount", { count, max: MAX_COMPARISON_CELLS })}
            </div>
            <div className="comparison-builder__actions">
              {running ? (
                <button type="button" className="comparison-button comparison-button--danger" onClick={cancelAll}>{t("comparison.cancel")}</button>
              ) : (
                <button type="button" className="comparison-button comparison-button--primary" disabled={!countValid} onClick={() => void runAll()}>{t("comparison.generate")}</button>
              )}
            </div>
          </aside>

          <main className="comparison-results" aria-live="polite">
            {cells.length === 0 ? (
              <div className="comparison-results__empty">{t("comparison.empty")}</div>
            ) : (
              <>
                <div className="comparison-results__progress">{t("comparison.progress", { completed, total: cells.length })}</div>
                <div className="comparison-results__grid">
                  {cells.map((cell) => (
                    <article key={cell.id} className={`comparison-cell comparison-cell--${cell.status}`}>
                      <div className="comparison-cell__media">
                        {cell.result ? <img src={cell.result.url ?? cell.result.image} alt={cell.id} loading="lazy" decoding="async" /> : <span>{t(`comparison.status.${cell.status}`)}</span>}
                      </div>
                      <dl className="comparison-cell__meta">
                        <div><dt>{t("comparison.model")}</dt><dd>{cell.model}</dd></div>
                        <div><dt>{t("comparison.reasoning")}</dt><dd>{cell.reasoningEffort}</dd></div>
                        <div><dt>{t("comparison.quality")}</dt><dd>{cell.quality}</dd></div>
                        <div><dt>{t("comparison.size")}</dt><dd>{cell.size.replace("x", "×")}</dd></div>
                      </dl>
                      {cell.error ? <p className="comparison-cell__error">{cell.error}</p> : null}
                      {cell.result ? (
                        <div className="comparison-cell__actions">
                          <button type="button" onClick={() => { useAppStore.getState().selectHistory(cell.result!); close(); }}>{t("comparison.use")}</button>
                          <a href={cell.result.url ?? cell.result.image} download={cell.result.filename ?? "comparison.png"}>{t("comparison.download")}</a>
                          <button type="button" disabled={running} onClick={() => void runCell(cell)}>{t("comparison.retry")}</button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </>
            )}
          </main>
        </div>
      </section>
    </div>
  ), document.body);
}
