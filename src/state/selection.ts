// The spreadsheet-style selection model: a cursor (the `active` cell) plus an
// `anchor`, whose bounding rectangle is the selection. A single selected cell is
// `anchor === active`. These pure reducers are the only place selection
// transitions are defined; `GridStore` holds the current value and marks dirty,
// and `render/SelectionLayer.ts` paints it. Keeping them pure (no DOM/React/store)
// makes the off-by-one and flipped-rectangle bugs catchable in `selection.test.ts`.
//
// Mirrors `state/viewport.ts` in spirit: plain values in, a new value out, every
// cell clamped to the alignment `Dims`. `active` is the moving end (the cursor);
// `anchor` is the fixed corner a Shift-extend pivots on.

import type { Dims } from "./viewport";

/** A grid cell, 0-based. */
export interface Cell {
  row: number;
  col: number;
}

/** A selection: the rectangle bounding `anchor` and `active`. `active` is the
 *  cursor (the moving end). `null` (in the store) means nothing is selected. */
export interface Selection {
  anchor: Cell;
  active: Cell;
}

/** The selection as an inclusive, normalized rectangle (the copy/edit target). */
export interface CellRect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** Clamp a cell to `[0, rows-1] × [0, cols-1]`. Assumes `dims` has at least one
 *  cell per axis (callers only mutate selection once an alignment is loaded);
 *  empty dims clamp to `(0, 0)`. Large deltas (the `FAR` Home/End/corner idiom)
 *  saturate here rather than overflowing — clamping is pure Math.min/max. */
function clampCell(cell: Cell, dims: Dims): Cell {
  return {
    row: Math.min(Math.max(0, cell.row), Math.max(0, dims.rows - 1)),
    col: Math.min(Math.max(0, cell.col), Math.max(0, dims.cols - 1)),
  };
}

/** Collapse to a single clamped cell at `(row, col)` — a fresh cursor (a click,
 *  or seeding the initial cursor). */
export function setCursor(row: number, col: number, dims: Dims): Selection {
  const c = clampCell({ row, col }, dims);
  return { anchor: c, active: c };
}

/**
 * Move the cursor by `(dr, dc)` and COLLAPSE: the result is always a single cell
 * at `active + delta` (clamped), so a plain arrow over a live rectangle deselects
 * it down to the moved cursor (standard spreadsheet behavior). Defensive: with no
 * prior selection, base at `(0, 0)` so a `FAR` corner-jump still lands correctly
 * (`moveCursor(null, -FAR, -FAR)` → `(0,0)`; `(+FAR, +FAR)` → the last cell).
 */
export function moveCursor(sel: Selection | null, dr: number, dc: number, dims: Dims): Selection {
  const base = sel ? sel.active : { row: 0, col: 0 };
  const next = clampCell({ row: base.row + dr, col: base.col + dc }, dims);
  return { anchor: next, active: next };
}

/**
 * Extend the selection: keep `anchor`, move `active` by `(dr, dc)` clamped
 * (Shift+arrow / Shift+Page). With no prior selection, behaves like `moveCursor`
 * (seeds a collapsed cursor) so it can't throw on `null`.
 */
export function extendActive(
  sel: Selection | null,
  dr: number,
  dc: number,
  dims: Dims,
): Selection {
  if (!sel) return moveCursor(null, dr, dc, dims);
  const active = clampCell({ row: sel.active.row + dr, col: sel.active.col + dc }, dims);
  return { anchor: sel.anchor, active };
}

/**
 * Set `active` to an absolute clamped cell, keeping `anchor` (Shift+click). With
 * no prior selection, seed the anchor at the clicked cell (so a Shift+click with
 * nothing selected just places the cursor).
 */
export function setActive(sel: Selection | null, row: number, col: number, dims: Dims): Selection {
  const active = clampCell({ row, col }, dims);
  return { anchor: sel ? sel.anchor : active, active };
}

/** Select the whole alignment (Ctrl/⌘+A): anchor top-left, active bottom-right. */
export function selectAll(dims: Dims): Selection {
  return {
    anchor: { row: 0, col: 0 },
    active: { row: Math.max(0, dims.rows - 1), col: Math.max(0, dims.cols - 1) },
  };
}

/** Collapse the rectangle to its `active` cell (Esc), keeping the cursor put. */
export function collapseSelection(sel: Selection): Selection {
  return { anchor: sel.active, active: sel.active };
}

/** The selection as an inclusive, axis-aligned rectangle (anchor/active in any
 *  order). The shape downstream copy/edit (and the `SelectionLayer` fill) read. */
export function normalize(sel: Selection): CellRect {
  return {
    r0: Math.min(sel.anchor.row, sel.active.row),
    r1: Math.max(sel.anchor.row, sel.active.row),
    c0: Math.min(sel.anchor.col, sel.active.col),
    c1: Math.max(sel.anchor.col, sel.active.col),
  };
}

/** Cell count of a normalized rectangle (e.g. the Phase-2 `Sel: C × R` readout). */
export function rectDims(rect: CellRect): { rows: number; cols: number } {
  return { rows: rect.r1 - rect.r0 + 1, cols: rect.c1 - rect.c0 + 1 };
}
