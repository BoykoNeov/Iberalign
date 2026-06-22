// Pure screen-geometry derived from a `Viewport`: the cell ↔ pixel transforms
// and the visible-window computation that lets the renderer draw only the cells
// on screen (the virtualization that makes a millions-of-cells grid tractable).
//
// All coordinates are CSS px in the grid-canvas's local space (origin at its
// top-left, excluding the name column and ruler — see `state/viewport.ts`).
// These are read-only queries; viewport *transitions* live in `state/viewport.ts`.

import type { Dims, Viewport } from "../state/viewport";

/** Left edge (grid-canvas x, CSS px) of a column. May be negative / off-screen. */
export function colToX(vp: Viewport, col: number): number {
  return col * vp.cellW - vp.scrollX;
}

/** Top edge (grid-canvas y, CSS px) of a row. */
export function rowToY(vp: Viewport, row: number): number {
  return row * vp.cellH - vp.scrollY;
}

/** Column index containing grid-canvas x. May be out of `[0, cols)` — callers
 *  that need a real cell (hover) must range-check against `Dims`. */
export function xToCol(vp: Viewport, x: number): number {
  return Math.floor((x + vp.scrollX) / vp.cellW);
}

/** Row index containing grid-canvas y. May be out of range (see `xToCol`). */
export function yToRow(vp: Viewport, y: number): number {
  return Math.floor((y + vp.scrollY) / vp.cellH);
}

/** Inclusive `[first, last]` index range of a visible axis, padded by `overscan`
 *  cells each side and clamped to the content. Returns an empty range
 *  (`last < first`) when there are no cells on that axis. */
interface Range {
  first: number;
  last: number;
}

function visibleRange(
  scroll: number,
  view: number,
  cell: number,
  count: number,
  overscan: number,
): Range {
  if (count <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(scroll / cell) - overscan);
  const last = Math.min(count - 1, Math.floor((scroll + view) / cell) + overscan);
  return { first, last };
}

/** Columns to draw for the current viewport (virtualized window + overscan). */
export function visibleCols(vp: Viewport, dims: Dims, overscan = 0): Range {
  return visibleRange(vp.scrollX, vp.viewW, vp.cellW, dims.cols, overscan);
}

/** Rows to draw for the current viewport. */
export function visibleRows(vp: Viewport, dims: Dims, overscan = 0): Range {
  return visibleRange(vp.scrollY, vp.viewH, vp.cellH, dims.rows, overscan);
}
