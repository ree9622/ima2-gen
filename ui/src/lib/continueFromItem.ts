import { useAppStore } from "../store/useAppStore";
import { isVideoItem, extractLastFrame } from "./videoMedia";
import { buildVideoContinuityFromItem, buildContinuityPromptChip } from "./videoContinuity";
import type { GenerateItem, VideoContinuityLineage } from "../types";

export type ContinueableItem = Pick<GenerateItem, "image"> & {
  url?: string;
  filename?: string;
  prompt?: string | null;
  userPrompt?: string | null;
  revisedPrompt?: string | null;
  createdAt?: number;
  videoContinuity?: VideoContinuityLineage | null;
  videoSeries?: { topic?: string } | null;
};

export type ContinueResult = {
  ok: boolean;
  isVideo: boolean;
  hasPrompt: boolean;
};

export async function continueFromItem(item: ContinueableItem): Promise<ContinueResult> {
  const store = useAppStore.getState();
  const isVideo = isVideoItem(item as Pick<GenerateItem, "filename" | "url" | "image">);
  const hasPrompt = Boolean(item.prompt);

  if (hasPrompt && !isVideo) {
    store.setPrompt(item.prompt as string);
  }

  if (isVideo) {
    const videoSrc = item.url || item.image;
    const frameDataUrl = await extractLastFrame(videoSrc);
    store.addReferenceDataUrl(frameDataUrl);
    const lineage = buildVideoContinuityFromItem(
      item as Pick<GenerateItem, "filename" | "userPrompt" | "revisedPrompt" | "createdAt" | "videoContinuity"> & { prompt?: string | null },
    );
    store.setVideoContinuityLineage(lineage);
    if (lineage) {
      store.insertPromptToComposer(buildContinuityPromptChip(lineage));
    }
    if (item.videoSeries?.topic) {
      store.setVideoTopic(item.videoSeries.topic);
    }
  } else {
    await store.useImageAsReference(item as GenerateItem);
  }

  return { ok: true, isVideo, hasPrompt };
}
