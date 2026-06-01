import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { OptionGroup } from "./OptionGroup";
import { deriveVideoModeUI, MAX_REF2V_DURATION_UI } from "../lib/imageModels";
import { ACTIVE_VIDEO_PROMPT_GUIDANCE, continuitySummary } from "../lib/videoContinuity";
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from "../lib/reasoning";
import type { VideoResolutionUI } from "../types";

interface PlannerConfig { model: string; options: string[]; }

const RES_ITEMS = [
  { value: "480p" as const, label: "480p" },
  { value: "720p" as const, label: "720p" },
];
const ASPECT_ITEMS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].map((v) => ({ value: v, label: v }));
const DURATIONS = [3, 5, 8, 10, 12, 15];

export function VideoControlsPanel() {
  const { t } = useI18n();
  const refCount = useAppStore((s) => s.activeVideoRefCount());
  const duration = useAppStore((s) => s.videoDuration);
  const setDuration = useAppStore((s) => s.setVideoDuration);
  const resolution = useAppStore((s) => s.videoResolution);
  const setResolution = useAppStore((s) => s.setVideoResolution);
  const aspect = useAppStore((s) => s.videoAspectRatio);
  const setAspect = useAppStore((s) => s.setVideoAspectRatio);
  const videoTopic = useAppStore((s) => s.videoTopic);
  const setVideoTopic = useAppStore((s) => s.setVideoTopic);
  const continuity = useAppStore((s) => s.videoContinuityLineage);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const setReasoningEffort = useAppStore((s) => s.setReasoningEffort);
  const maxDuration = refCount >= 2 ? MAX_REF2V_DURATION_UI : 15;
  const mode = deriveVideoModeUI(refCount);
  const summary = continuitySummary(continuity);

  const [plannerConfig, setPlannerConfig] = useState<PlannerConfig | null>(null);
  useEffect(() => {
    fetch("/api/config/grok-planner")
      .then((r) => r.json() as Promise<PlannerConfig>)
      .then(setPlannerConfig)
      .catch(() => {});
  }, []);
  const onPlannerChange = async (model: string) => {
    try {
      await fetch("/api/config/grok-planner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setPlannerConfig((prev) => prev ? { ...prev, model } : null);
    } catch {}
  };

  return (
    <div className="right-panel-settings video-controls">
      <div className="provider-compat-note" role="note">
        <strong>{t("video.modeLabel")}</strong>
        <span>{t(`video.mode.${mode}`, { n: refCount })}</span>
      </div>
      {summary ? (
        <div className="provider-compat-note" role="note">
          <strong>Continuity</strong>
          <span>{summary}</span>
        </div>
      ) : null}
      <div className="option-group">
        <div className="section-title">{t("video.seriesTopicTitle") ?? "시리즈 주제"}</div>
        <input
          type="text"
          className="video-topic-input"
          placeholder={t("video.seriesTopicPlaceholder") ?? "예: 한국 여행 브이로그"}
          value={videoTopic}
          onChange={(e) => setVideoTopic(e.target.value)}
        />
      </div>
      <div className="option-group">
        <div className="section-title">{t("video.durationTitle")}</div>
        <div className="option-row">
          {DURATIONS.filter((d) => d <= maxDuration).map((d) => (
            <button
              key={d}
              type="button"
              className={`option-btn${duration === d ? " active" : ""}`}
              onClick={() => setDuration(d)}
            >
              {d}s
            </button>
          ))}
        </div>
      </div>
      <OptionGroup<VideoResolutionUI>
        title={t("video.resolutionTitle")}
        items={RES_ITEMS}
        value={resolution}
        onChange={setResolution}
      />
      <OptionGroup<string>
        title={t("video.aspectTitle")}
        items={ASPECT_ITEMS}
        value={aspect}
        onChange={setAspect}
      />
      <div className="video-controls__pills">
        {plannerConfig && (
          <select
            className="video-controls__pill"
            value={plannerConfig.model}
            onChange={(e) => void onPlannerChange(e.target.value)}
            aria-label={t("video.plannerModelTitle")}
          >
            {plannerConfig.options.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        <select
          className="video-controls__pill"
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort)}
          aria-label={t("video.reasoningEffortTitle")}
        >
          {REASONING_EFFORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.shortLabel}</option>
          ))}
        </select>
      </div>
      <div className="provider-compat-note" role="note" style={{ marginTop: 8 }}>
        <strong>Active prompt</strong>
        <span>{ACTIVE_VIDEO_PROMPT_GUIDANCE}</span>
      </div>
    </div>
  );
}
