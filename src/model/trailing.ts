// Per-row trailing-gap boundary. Used by the grid renderer to draw TRAILING
// padding (the run of gaps after a row's last residue) as bare background rather
// than as real gaps — so inserting a column into ONE sequence (which trailing-pads
// every other row to keep the matrix rectangular: the core trailing-pad-only
// invariant) doesn't make all the other rows look like they grew a `-`. Interior
// gaps (a gap with a residue still to its right in that row) stay visible as gaps.
//
// This is a pure, view-independent reduction of the flat buffer so it can be unit-
// tested at the boundaries the render correctness rides on; the renderer caches the
// result by view identity (like its per-column occupancy) and drops it on edit.

import { isGap } from "./coords";

/**
 * For each row, the column index where its TRAILING run of gaps begins — i.e. one
 * past the last non-gap byte. A cell `(r, c)` is trailing PADDING iff
 * `c >= trailingGapStarts(...)[r]`; everything to its left (including interior gaps)
 * is sequence content.
 *
 * Boundaries:
 *   - a row ending in a residue (or with a residue in the last column) → `width`
 *     (no trailing padding);
 *   - an all-gap row → `0` (the whole row is padding → it renders fully blank).
 *
 * Scans each row from the right, stopping at the first residue, so it's cheap when
 * trailing runs are short (O(width×rows) only in the all-gap worst case).
 */
export function trailingGapStarts(buffer: Uint8Array, width: number, numRows: number): Int32Array {
  const starts = new Int32Array(numRows);
  for (let r = 0; r < numRows; r++) {
    const base = r * width;
    let c = width - 1;
    while (c >= 0 && isGap(buffer[base + c])) c--;
    starts[r] = c + 1; // one past the last residue; 0 for an all-gap row
  }
  return starts;
}
