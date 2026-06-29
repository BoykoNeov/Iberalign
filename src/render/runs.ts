// Horizontal run-merging for the cell tiers. Within one visible row, adjacent
// columns that share a fill color are coalesced into a single `fillRect` span —
// a large win at the dense end of the block tier, where alignments have long gap
// runs and conserved stretches (worst case, all-distinct colors, is no worse than
// per-cell). This is the off-by-one-prone piece, so it lives here as a pure,
// allocation-free function the renderer drives and a unit test pins.
//
// VISITOR, not array-returning, on purpose: `emit` is called once per run with
// no intermediate objects, so the hot draw path allocates nothing per frame
// (returning `Run[]` would churn the GC against the fps target).
//
// Spans tile seamlessly: a run flushed at column `i` ends at `xs[i]` (the start
// of the differing cell), and the final run ends at `xs[nCols]`. Zero-width cells
// (`xs[i+1] <= xs[i]`, only reachable via degenerate edges) are skipped and thus
// absorbed into the surrounding run.

export type RunEmit = (x0: number, width: number, style: string) => void;

/**
 * Walk one row's visible columns, emitting one `(x0, width, style)` run per
 * maximal same-style span. `xs` holds the DEVICE-px left edges of the visible
 * columns plus a trailing right edge (`length === nCols + 1`); `bytes[base + colFirst + i]`
 * is column `i`'s residue; `styleFor(byte, col)` maps a residue at its ABSOLUTE
 * column to its fill color. (The column is passed so column-dependent colorings —
 * by-conservation, match/mismatch-consensus — can key on it; the per-residue
 * scheme ignores it. Adjacent same-style cells still coalesce: a binary highlight
 * merges well, a per-column ramp degrades to per-cell, the documented worst case.)
 */
export function forEachFillRun(
  bytes: Uint8Array,
  base: number,
  colFirst: number,
  nCols: number,
  xs: Int32Array,
  styleFor: (byte: number, col: number) => string,
  emit: RunEmit,
): void {
  let runStyle = "";
  let runX0 = 0;
  for (let i = 0; i < nCols; i++) {
    const xL = xs[i];
    const xR = xs[i + 1];
    if (xR <= xL) continue; // zero-width cell → absorbed into the current run
    const style = styleFor(bytes[base + colFirst + i], colFirst + i);
    if (style !== runStyle) {
      if (runStyle !== "") emit(runX0, xL - runX0, runStyle);
      runStyle = style;
      runX0 = xL;
    }
  }
  if (runStyle !== "") emit(runX0, xs[nCols] - runX0, runStyle);
}
