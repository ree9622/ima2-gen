import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComparisonCells,
  comparisonCellCount,
  MAX_COMPARISON_CELLS,
  toggleComparisonValue,
} from "../ui/src/lib/comparisonMatrix.js";

test("comparison matrix builds the cartesian product in stable axis order", () => {
  const axes = {
    models: ["gpt-5.4", "gpt-5.5"] as const,
    reasoningEfforts: ["low"] as const,
    qualities: ["low", "high"] as const,
    sizes: ["1024x1024"] as const,
  };
  assert.equal(comparisonCellCount(axes), 4);
  assert.deepEqual(
    buildComparisonCells(axes).map((cell) => [cell.model, cell.quality]),
    [
      ["gpt-5.4", "low"],
      ["gpt-5.4", "high"],
      ["gpt-5.5", "low"],
      ["gpt-5.5", "high"],
    ],
  );
});

test("comparison matrix rejects more than nine generated cells", () => {
  const axes = {
    models: ["gpt-5.4", "gpt-5.5"] as const,
    reasoningEfforts: ["low", "medium"] as const,
    qualities: ["low", "medium", "high"] as const,
    sizes: ["1024x1024"] as const,
  };
  assert.equal(comparisonCellCount(axes), 12);
  assert.throws(() => buildComparisonCells(axes), new RegExp(String(MAX_COMPARISON_CELLS)));
});

test("comparison selection toggles values without mutating the input", () => {
  const original = ["low", "medium"] as const;
  assert.deepEqual(toggleComparisonValue(original, "medium"), ["low"]);
  assert.deepEqual(toggleComparisonValue(original, "high"), ["low", "medium", "high"]);
  assert.deepEqual(original, ["low", "medium"]);
});
