import { describe, it, expect } from "vitest";
import { niceLabelStep } from "./ticks";

// minLabelPx fixed at 48 (the chrome default). Each case pins a boundary of the
// 1/2/5×10ⁿ ladder so a regression in the step choice (overlapping or jumping
// ruler labels) fails here rather than only being visible on screen.
const MIN = 48;

describe("niceLabelStep", () => {
  it("is 1 when a single column already clears the spacing", () => {
    expect(niceLabelStep(48, MIN)).toBe(1); // minCols == 1 exactly
    expect(niceLabelStep(64, MIN)).toBe(1); // minCols < 1
    expect(niceLabelStep(200, MIN)).toBe(1);
  });

  it("climbs the 1/2/5 ladder within a decade", () => {
    expect(niceLabelStep(32, MIN)).toBe(2); // minCols 1.5  -> 2
    expect(niceLabelStep(24, MIN)).toBe(2); // minCols 2.0  -> 2
    expect(niceLabelStep(20, MIN)).toBe(5); // minCols 2.4  -> 5
    expect(niceLabelStep(10, MIN)).toBe(5); // minCols 4.8  -> 5
    expect(niceLabelStep(9, MIN)).toBe(10); // minCols 5.33 -> 10
  });

  it("crosses decade boundaries (2, 5, 10 × 10ⁿ)", () => {
    expect(niceLabelStep(4, MIN)).toBe(20); // minCols 12   -> 20
    expect(niceLabelStep(2, MIN)).toBe(50); // minCols 24   -> 50
    expect(niceLabelStep(1, MIN)).toBe(50); // minCols 48   -> 50
    expect(niceLabelStep(0.5, MIN)).toBe(100); // minCols 96 -> 100
  });

  it("guards non-positive cell sizes", () => {
    expect(niceLabelStep(0, MIN)).toBe(1);
    expect(niceLabelStep(-5, MIN)).toBe(1);
  });

  it("always returns a positive integer", () => {
    for (let cell = 0.5; cell <= 40; cell += 0.5) {
      const step = niceLabelStep(cell, MIN);
      expect(Number.isInteger(step)).toBe(true);
      expect(step).toBeGreaterThanOrEqual(1);
      // The chosen step must actually clear the spacing (or be the floor of 1).
      expect(step === 1 || step * cell >= MIN).toBe(true);
    }
  });
});
