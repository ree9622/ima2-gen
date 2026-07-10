import type { OpenAIImageModel, Quality } from "../types";
import type { ReasoningEffort } from "./reasoning";

export const MAX_COMPARISON_CELLS = 9;

export type ComparisonAxes = {
  models: readonly OpenAIImageModel[];
  reasoningEfforts: readonly ReasoningEffort[];
  qualities: readonly Quality[];
  sizes: readonly string[];
};

export type ComparisonCellConfig = {
  id: string;
  model: OpenAIImageModel;
  reasoningEffort: ReasoningEffort;
  quality: Quality;
  size: string;
};

export function comparisonCellCount(axes: ComparisonAxes): number {
  return axes.models.length
    * axes.reasoningEfforts.length
    * axes.qualities.length
    * axes.sizes.length;
}

export function buildComparisonCells(axes: ComparisonAxes): ComparisonCellConfig[] {
  const count = comparisonCellCount(axes);
  if (count === 0) return [];
  if (count > MAX_COMPARISON_CELLS) {
    throw new RangeError(`Comparison matrix supports up to ${MAX_COMPARISON_CELLS} cells`);
  }

  const cells: ComparisonCellConfig[] = [];
  for (const model of axes.models) {
    for (const reasoningEffort of axes.reasoningEfforts) {
      for (const quality of axes.qualities) {
        for (const size of axes.sizes) {
          cells.push({
            id: `${model}:${reasoningEffort}:${quality}:${size}`,
            model,
            reasoningEffort,
            quality,
            size,
          });
        }
      }
    }
  }
  return cells;
}

export function toggleComparisonValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}
