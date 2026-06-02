import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { OptionGroup } from "./OptionGroup";
import { SizePicker } from "./SizePicker";
import { CountPicker } from "./CountPicker";
import { CostEstimate } from "./CostEstimate";
import { ProviderSelect } from "./ProviderSelect";
import { GrokSizePicker } from "./GrokSizePicker";
import { GrokModelPicker } from "./GrokModelPicker";
import { VideoControlsPanel } from "./VideoControlsPanel";
import type { Format, Moderation, Quality } from "../types";

const FORMAT_ITEMS = [
  { value: "png" as const, label: "PNG" },
  { value: "jpeg" as const, label: "JPEG" },
  { value: "webp" as const, label: "WebP" },
];

const GEMINI_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "3:4", label: "3:4" },
  { value: "4:3", label: "4:3" },
  { value: "4:5", label: "4:5" },
  { value: "5:4", label: "5:4" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "21:9", label: "21:9" },
];

const GEMINI_RESOLUTIONS = [
  { value: "512", label: "512px" },
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const GEMINI_RATIO_TO_SIZE: Record<string, Record<string, string>> = {
  "1:1":  { "512": "512x512",  "1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096" },
  "2:3":  { "512": "424x632",  "1K": "848x1264",  "2K": "1696x2528", "4K": "3392x5056" },
  "3:2":  { "512": "632x424",  "1K": "1264x848",  "2K": "2528x1696", "4K": "5056x3392" },
  "3:4":  { "512": "448x600",  "1K": "896x1200",  "2K": "1792x2400", "4K": "3584x4800" },
  "4:3":  { "512": "600x448",  "1K": "1200x896",  "2K": "2400x1792", "4K": "4800x3584" },
  "4:5":  { "512": "464x576",  "1K": "928x1152",  "2K": "1856x2304", "4K": "3712x4608" },
  "5:4":  { "512": "576x464",  "1K": "1152x928",  "2K": "2304x1856", "4K": "4608x3712" },
  "9:16": { "512": "384x688",  "1K": "768x1376",  "2K": "1536x2752", "4K": "3072x5504" },
  "16:9": { "512": "688x384",  "1K": "1376x768",  "2K": "2752x1536", "4K": "5504x3072" },
  "21:9": { "512": "792x168",  "1K": "1584x672",  "2K": "3168x1344", "4K": "6336x2688" },
};

function parseCurrentGeminiSettings(size: string): { ratio: string; res: string } {
  for (const [ratio, resMap] of Object.entries(GEMINI_RATIO_TO_SIZE)) {
    for (const [res, sizeStr] of Object.entries(resMap)) {
      if (sizeStr === size) return { ratio, res };
    }
  }
  return { ratio: "1:1", res: "1K" };
}

export function GenerationControlsPanel() {
  const { t } = useI18n();
  const provider = useAppStore((s) => s.provider);
  const quality = useAppStore((s) => s.quality);
  const setQuality = useAppStore((s) => s.setQuality);
  const format = useAppStore((s) => s.format);
  const setFormat = useAppStore((s) => s.setFormat);
  const moderation = useAppStore((s) => s.moderation);
  const setModeration = useAppStore((s) => s.setModeration);
  const multimode = useAppStore((s) => s.multimode);
  const setMultimode = useAppStore((s) => s.setMultimode);
  const imageModel = useAppStore((s) => s.imageModel);
  const setImageModel = useAppStore((s) => s.setImageModel);
  const selectVideoModel = useAppStore((s) => s.selectVideoModel);
  const sizePreset = useAppStore((s) => s.sizePreset);
  const customW = useAppStore((s) => s.customW);
  const customH = useAppStore((s) => s.customH);
  const setSizePreset = useAppStore((s) => s.setSizePreset);
  const setCustomSize = useAppStore((s) => s.setCustomSize);
  const uiMode = useAppStore((s) => s.uiMode);
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const showMultimodeControls = uiMode === "classic";
  const isGrok = provider === "grok" || provider === "grok-api";
  const isAgyOnly = provider === "agy";
  const isGeminiApi = provider === "gemini-api";
  const isAnyGemini = isAgyOnly || isGeminiApi;
  const hideFormatControls = isGrok || isAnyGemini;

  const currentSize = sizePreset === "custom" ? `${customW}x${customH}` : "1024x1024";
  const geminiSettings = isGeminiApi ? parseCurrentGeminiSettings(currentSize) : { ratio: "1:1", res: "1K" };

  const setGeminiSize = (ratio: string, res: string) => {
    const sizeStr = GEMINI_RATIO_TO_SIZE[ratio]?.[res] || "1024x1024";
    const [w, h] = sizeStr.split("x").map(Number);
    setSizePreset("custom");
    setCustomSize(w, h);
  };

  const qualityItems = [
    { value: "low" as const, label: t("quality.lowLabel"), sub: t("quality.lowSub") },
    { value: "medium" as const, label: t("quality.mediumLabel"), sub: t("quality.mediumSub") },
    { value: "high" as const, label: t("quality.highLabel"), sub: t("quality.highSub") },
  ];
  const moderationItems = [
    { value: "auto" as const, label: t("moderation.autoLabel"), sub: t("moderation.autoSub") },
    {
      value: "low" as const,
      label: t("moderation.lowLabel"),
      sub: t("moderation.lowSub"),
      color: "var(--amber)",
    },
  ];

  const handleModeSwitch = (mode: "image" | "video") => {
    if (mode === "video") {
      selectVideoModel("grok-imagine-video");
    } else {
      setImageModel(imageModel);
    }
  };

  return (
    <div className="right-panel-settings" role="tabpanel">
      <ProviderSelect allowGrok />
      {isGrok ? (
        <details className="provider-compat-details">
          <summary>{t("provider.grokCompatTitle")}</summary>
          <p>{t("provider.grokCompatBody")}</p>
        </details>
      ) : isAgyOnly ? (
        <details className="provider-compat-details">
          <summary>{t("provider.agyCompatTitle")}</summary>
          <p>{t("provider.agyCompatBody")}</p>
        </details>
      ) : isGeminiApi ? (
        <details className="provider-compat-details">
          <summary>Gemini API</summary>
          <p>Google Gemini API. Supports aspect ratio + resolution control (512px–4K).</p>
        </details>
      ) : (
        <details className="provider-compat-details">
          <summary>{t("provider.gptCompatTitle")}</summary>
          <p>{t("provider.gptCompatBody")}</p>
        </details>
      )}
      {isGrok && (
        <div className="option-group grok-mode-toggle">
          <div className="option-row">
            <button
              type="button"
              className={`option-btn${!videoModelSelected ? " active" : ""}`}
              onClick={() => handleModeSwitch("image")}
            >
              {t("grokMode.image")}
            </button>
            <button
              type="button"
              className={`option-btn${videoModelSelected ? " active" : ""}`}
              onClick={() => handleModeSwitch("video")}
            >
              {t("grokMode.video")}
            </button>
          </div>
        </div>
      )}
      {videoModelSelected ? (
        <VideoControlsPanel />
      ) : (
      <>
      {isAgyOnly ? null : isGrok ? (
        <>
        <GrokModelPicker />
        <GrokSizePicker />
        </>
      ) : isGeminiApi ? (
        <>
        <div className="option-group">
          <div className="section-title">{t("quality.grokModelTitle") || "Model"}</div>
          <div className="option-row">
            <button
              type="button"
              className={`option-btn${imageModel === "nano-banana-2" ? " active" : ""}`}
              onClick={() => setImageModel("nano-banana-2")}
              style={{ lineHeight: "1.3" }}
            >
              <span>Nano</span><br /><span>Banana 2</span>
            </button>
            <button
              type="button"
              className={`option-btn${imageModel === "nano-banana-pro" ? " active" : ""}`}
              onClick={() => setImageModel("nano-banana-pro")}
              style={{ lineHeight: "1.3" }}
            >
              <span>Nano</span><br /><span>Banana Pro</span>
            </button>
          </div>
        </div>
        <div className="option-group">
          <div className="section-title">{t("size.grokAspectTitle") || "Aspect Ratio"}</div>
          {[
            GEMINI_ASPECT_RATIOS.slice(0, 3),
            GEMINI_ASPECT_RATIOS.slice(3, 6),
            GEMINI_ASPECT_RATIOS.slice(6, 8),
            GEMINI_ASPECT_RATIOS.slice(8),
          ].map((row, ri) => (
            <div key={ri} className="option-row">
              {row.map((ar) => (
                <button
                  key={ar.value}
                  type="button"
                  className={`option-btn${geminiSettings.ratio === ar.value ? " active" : ""}`}
                  onClick={() => setGeminiSize(ar.value, geminiSettings.res)}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="option-group">
          <div className="section-title">{t("size.grokResolutionTitle") || "Resolution"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
            {GEMINI_RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`option-btn${geminiSettings.res === r.value ? " active" : ""}`}
                onClick={() => setGeminiSize(geminiSettings.ratio, r.value)}
                style={{ padding: "6px 4px" }}
              >
                <span>{r.label}</span><br /><small>{GEMINI_RATIO_TO_SIZE[geminiSettings.ratio]?.[r.value]?.replace("x", "×") || ""}</small>
              </button>
            ))}
          </div>
        </div>
        </>
      ) : (
        <>
        <OptionGroup<Quality>
          title={t("quality.title")}
          items={qualityItems}
          value={quality}
          onChange={setQuality}
        />
        <SizePicker />
        </>
      )}
      {hideFormatControls ? null : (
        <>
          <OptionGroup<Format>
            title={t("format.title")}
            items={FORMAT_ITEMS}
            value={format}
            onChange={setFormat}
          />
          <OptionGroup<Moderation>
            title={t("moderation.title")}
            items={moderationItems}
            value={moderation}
            onChange={setModeration}
          />
          <p className="option-help">
            {t("moderation.explain")}
          </p>
        </>
      )}
      {showMultimodeControls && !isAnyGemini && (
        <div className="option-group multimode-toggle">
          <button
            type="button"
            className={`multimode-toggle__button${multimode ? " active" : ""}`}
            aria-pressed={multimode}
            title={t("multimode.tooltip")}
            onClick={() => setMultimode(!multimode)}
          >
            <span>{t("multimode.label")}</span>
            <span>{t("multimode.shortHint")}</span>
          </button>
        </div>
      )}
      {isAnyGemini ? null : <CountPicker />}
      <CostEstimate />
      </>
      )}
    </div>
  );
}
