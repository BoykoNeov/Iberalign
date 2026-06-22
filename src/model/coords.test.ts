// Parity guard for `colToUngapped` against `align-core::coords`
// (`AlignedRow::col_to_seq_pos`). The expected values below are hand-worked
// straight from that algorithm: walk the row, a gap column yields no position
// (`null`), a residue column yields the count of preceding residues (0-based),
// surfaced 1-based. If the JS mirror drifts (off-by-one, 0-based surface, gaps
// counted, `.` not treated as a gap), these literals fail. The Rust side is the
// authority — its round-trip is property-tested in `coords_proptest.rs`.

import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import { colToUngapped, isGap } from "./coords";
import type { AlignmentMeta } from "./types";

/** Build a view from row strings (must be equal length). */
function viewOf(rows: string[]): AlignmentView {
  const width = rows[0]?.length ?? 0;
  for (const r of rows) {
    if (r.length !== width) throw new Error(`ragged fixture row: "${r}"`);
  }
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((r, i) => buffer.set(new TextEncoder().encode(r), i * width));
  const meta: AlignmentMeta = {
    width,
    numRows: rows.length,
    names: rows.map((_, i) => `r${i}`),
    alphabet: "DNA",
  };
  return new AlignmentView(buffer, meta);
}

describe("colToUngapped — parity with coords.rs", () => {
  // Rows exercising interior, leading, and trailing gaps, plus a gapless row.
  //                col:  0    1    2    3    4    5
  const view = viewOf([
    "A-CG-T", // r0: interior gaps
    "--AC--", // r1: leading + trailing gaps
    "ACGTTG", // r2: no gaps
  ]);

  // Expected 1-based ungapped position per column; null at a gap.
  const expected: Array<Array<number | null>> = [
    [1, null, 2, 3, null, 4], // r0
    [null, null, 1, 2, null, null], // r1
    [1, 2, 3, 4, 5, 6], // r2
  ];

  it("maps every (row, col) to the hand-worked position", () => {
    for (let row = 0; row < view.numRows; row++) {
      for (let col = 0; col < view.width; col++) {
        expect(colToUngapped(view, row, col)).toBe(expected[row][col]);
      }
    }
  });

  it("non-null count per row equals the row's residue (non-gap) count", () => {
    for (let row = 0; row < view.numRows; row++) {
      const nonNull = expected[row].filter((p) => p !== null).length;
      const residues = [...view.rowSlice(row)].filter((b) => !isGap(b)).length;
      expect(nonNull).toBe(residues);
    }
  });

  it("returns null for out-of-range columns", () => {
    expect(colToUngapped(view, 0, -1)).toBeNull();
    expect(colToUngapped(view, 0, 6)).toBeNull();
    expect(colToUngapped(view, 9, 0)).toBeNull();
  });
});

describe("isGap — mirrors align-core::coords::is_gap", () => {
  it("treats both '-' and '.' as gaps", () => {
    expect(isGap("-".charCodeAt(0))).toBe(true);
    expect(isGap(".".charCodeAt(0))).toBe(true);
  });

  it("treats residues and undefined as non-gaps", () => {
    expect(isGap("A".charCodeAt(0))).toBe(false);
    expect(isGap("n".charCodeAt(0))).toBe(false);
    expect(isGap(undefined)).toBe(false);
  });
});
