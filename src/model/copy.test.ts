import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import { buildCopyText } from "./copy";
import type { CellRect } from "../state/selection";

// Build a tiny view from rows of equal-length residue strings.
function viewFrom(rows: string[], names: string[]): AlignmentView {
  const width = rows[0].length;
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c++) buffer[r * width + c] = row.charCodeAt(c);
  });
  return new AlignmentView(buffer, { width, numRows: rows.length, names, alphabet: "DNA" });
}

describe("buildCopyText", () => {
  const view = viewFrom(["ACGTACGT", "AC-TACGT", "ACGTACG-"], ["seq1", "seq2", "seq3"]);

  it("raw: selected columns only, one row per line, gaps kept", () => {
    const rect: CellRect = { r0: 0, r1: 2, c0: 1, c1: 3 };
    expect(buildCopyText(view, rect, "raw")).toBe("CGT\nC-T\nCGT");
  });

  it("fasta: >name then the selected residues, per row", () => {
    const rect: CellRect = { r0: 0, r1: 1, c0: 0, c1: 2 };
    expect(buildCopyText(view, rect, "fasta")).toBe(">seq1\nACG\n>seq2\nAC-");
  });

  it("single cell (a gap)", () => {
    const rect: CellRect = { r0: 1, r1: 1, c0: 2, c1: 2 };
    expect(buildCopyText(view, rect, "raw")).toBe("-");
    expect(buildCopyText(view, rect, "fasta")).toBe(">seq2\n-");
  });

  it("full width of one row", () => {
    const rect: CellRect = { r0: 2, r1: 2, c0: 0, c1: 7 };
    expect(buildCopyText(view, rect, "raw")).toBe("ACGTACG-");
  });

  it("missing name falls back to empty header", () => {
    const v = viewFrom(["AC", "GT"], ["only"]); // row 1 has no name
    const rect: CellRect = { r0: 1, r1: 1, c0: 0, c1: 1 };
    expect(buildCopyText(v, rect, "fasta")).toBe(">\nGT");
  });
});
