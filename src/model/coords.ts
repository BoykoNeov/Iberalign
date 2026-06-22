// Column → ungapped-position mapping, computed in JS from the render buffer so
// the hover/status readout needs no IPC during interaction (spec §3). This is a
// MIRROR of `align-core::coords` (`AlignedRow::col_to_seq_pos`), which Rust
// property-tests as the authority. The semantics MUST match exactly:
//   - a gap column maps to `null` (Rust: `None`);
//   - the count excludes gaps;
//   - positions are 0-based internally, surfaced 1-based.
// `coords.test.ts` cross-checks this against hand-worked values that encode
// those rules — the guard against silent drift from `coords.rs`.

import type { AlignmentView } from "./view";

const GAP_HYPHEN = 0x2d; // '-'
const GAP_DOT = 0x2e; // '.'

/**
 * Mirror of `align_core::coords::is_gap`: both `-` and `.` are gaps. (The engine
 * normalizes `.`→`-` at parse, so the buffer holds only `-`, but mirroring both
 * keeps the JS semantics identical to Rust regardless.)
 */
export function isGap(byte: number | undefined): boolean {
  return byte === GAP_HYPHEN || byte === GAP_DOT;
}

/**
 * Map an alignment column to the **1-based ungapped residue position** within
 * `row`, or `null` if the column holds a gap (or is out of range) for that row.
 *
 * O(width) — counts non-gap bytes up to `col`. Cheap at width ≈ thousands and
 * only called on coarse events (hover), honoring "no IPC during interaction".
 */
export function colToUngapped(
  view: AlignmentView,
  row: number,
  col: number,
): number | null {
  const here = view.cellAt(row, col);
  if (here === undefined || isGap(here)) {
    return null;
  }
  // Count residues strictly before `col` (Rust counts then assigns, so the
  // residue AT `col` is `pos`); excludes gaps. 0-based → +1 for the surface.
  let pos = 0;
  for (let c = 0; c < col; c++) {
    if (!isGap(view.cellAt(row, c))) {
      pos += 1;
    }
  }
  return pos + 1;
}
