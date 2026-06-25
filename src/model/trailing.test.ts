import { describe, it, expect } from "vitest";
import { trailingGapStarts } from "./trailing";

// Build a flat row-major buffer from equal-length ASCII rows.
function buf(rows: string[]): { buffer: Uint8Array; width: number; numRows: number } {
  const width = rows.length ? rows[0].length : 0;
  const buffer = new Uint8Array(rows.length * width);
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c++) buffer[r * width + c] = row.charCodeAt(c);
  });
  return { buffer, width, numRows: rows.length };
}

const starts = (rows: string[]) => {
  const { buffer, width, numRows } = buf(rows);
  return Array.from(trailingGapStarts(buffer, width, numRows));
};

describe("trailingGapStarts", () => {
  it("a row ending in a residue has no trailing padding (start == width)", () => {
    expect(starts(["ACGT"])).toEqual([4]);
  });

  it("interior gaps with a residue in the LAST column still start at width", () => {
    expect(starts(["A--T"])).toEqual([4]);
  });

  it("trailing gaps start one past the last residue", () => {
    expect(starts(["AC--"])).toEqual([2]);
  });

  it("an all-gap row starts at 0 (renders fully blank)", () => {
    expect(starts(["----"])).toEqual([0]);
  });

  it("treats `.` as a gap too (the engine normalizes `.`→`-`, but be robust)", () => {
    expect(starts(["AC.."])).toEqual([2]);
  });

  it("computes each row independently", () => {
    expect(starts(["ACGT", "AC--", "----", "-CG-"])).toEqual([4, 2, 0, 3]);
  });

  it("handles a zero-width / zero-row buffer", () => {
    expect(starts([])).toEqual([]);
    expect(starts(["", ""])).toEqual([0, 0]);
  });
});
