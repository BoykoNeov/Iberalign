// The hover pipeline: a grid-canvas cursor point → the cell under it → its
// readout (sequence name, alignment column, ungapped position, residue). The
// status bar renders from one `HoverInfo`, so this is the single place the
// pointer → cell → ungapped mapping happens.
//
// PURE on purpose. `computeHover` takes the cursor px, the `Viewport`, and the
// `AlignmentView` and returns a plain value — no canvas, no React, no store. That
// keeps it unit-testable (`hover.test.ts`) and, more importantly, makes this the
// first place the col→ungapped parity logic (`colToUngapped`, mirror of
// `coords.rs`) is exercised by the actual UI pipeline rather than in isolation.

import type { AlignmentView } from "../model/view";
import type { Viewport } from "../state/viewport";
import { xToCol, yToRow } from "../render/viewport";
import { colToUngapped, isGap } from "../model/coords";

/**
 * The cell under the cursor, resolved across all three coordinate spaces (spec
 * §4): screen pixel → alignment column → ungapped position.
 */
export interface HoverInfo {
  /** 0-based row (sequence) index. */
  readonly row: number;
  /** 0-based alignment column; surfaced 1-based as `col + 1`. */
  readonly col: number;
  /** The row's display name. */
  readonly name: string;
  /** 1-based ungapped residue position, or `null` at a gap column. */
  readonly pos: number | null;
  /** The cell byte as a display character (`""` only if out of range). */
  readonly residue: string;
  /** Whether the cell holds a gap (`pos` is then `null`). */
  readonly isGap: boolean;
}

/**
 * Resolve the cell under a grid-canvas cursor point `(ax, ay)` (CSS px, local to
 * the grid canvas — origin excludes the name column + ruler) to a `HoverInfo`,
 * or `null` when the cursor is outside the drawing area or off the content
 * (e.g. in the overscan past the last row/column).
 *
 * The ungapped position comes from `colToUngapped`, which mirrors the engine's
 * gap/position semantics (gap → `null`, gaps excluded, 1-based) — so the readout
 * agrees with `align-core::coords` by construction.
 */
export function computeHover(
  view: AlignmentView,
  vp: Viewport,
  ax: number,
  ay: number,
): HoverInfo | null {
  // Outside the drawing area entirely (e.g. the pointer is over the chrome, or a
  // stale coordinate during resize). xToCol/yToRow would still return an index,
  // so guard the box explicitly.
  if (ax < 0 || ay < 0 || ax >= vp.viewW || ay >= vp.viewH) return null;

  const col = xToCol(vp, ax);
  const row = yToRow(vp, ay);
  // Off the content — overscan/empty space past the last row or column.
  if (row < 0 || row >= view.numRows || col < 0 || col >= view.width) return null;

  const byte = view.cellAt(row, col);
  return {
    row,
    col,
    name: view.nameAt(row),
    pos: colToUngapped(view, row, col),
    residue: byte === undefined ? "" : String.fromCharCode(byte),
    isGap: isGap(byte),
  };
}
