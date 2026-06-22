// Pure ruler/track tick math: how many columns to skip between labels so they do
// not collide at the current zoom. Shared by the ruler now and the track lane
// later (both map columns the same way via `colToX`). Callers anchor labels to
// the ABSOLUTE column index — drawing where `(col + 1) % step === 0`, not relative
// to the first visible column — which is what keeps labels from renumbering or
// jittering as you pan.

/**
 * Smallest "nice" column step (1, 2, 5 × 10ⁿ) such that `step * cellW >=
 * minLabelPx` — i.e. consecutive labels land at least `minLabelPx` apart. Always
 * returns a positive integer; collapses to 1 when every column already clears the
 * spacing (or `cellW` is non-positive, a guard against div-by-zero / Infinity).
 */
export function niceLabelStep(cellW: number, minLabelPx: number): number {
  if (cellW <= 0) return 1;
  const minCols = minLabelPx / cellW;
  if (minCols <= 1) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(minCols)));
  for (const m of [1, 2, 5]) {
    const step = m * base;
    if (step >= minCols) return step;
  }
  return 10 * base;
}
