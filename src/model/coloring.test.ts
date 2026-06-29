import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import { columnProfiles } from "./profile";
import {
  conservedColumns,
  coloringControlsEnabled,
  DEFAULT_COLORING,
  type ColoringConfig,
  type ConservationDenominator,
} from "./coloring";
import type { AlphabetLabel } from "./types";

// Build a tiny view from rows of equal-length residue strings (mirrors the helper
// in consensus.test.ts / profile tests).
function viewFrom(rows: string[], alphabet: AlphabetLabel = "DNA"): AlignmentView {
  const width = rows[0]?.length ?? 0;
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c++) buffer[r * width + c] = row.charCodeAt(c);
  });
  const names = rows.map((_, i) => `s${i}`);
  return new AlignmentView(buffer, { width, numRows: rows.length, names, alphabet });
}

// Conserved mask as a "10" string for readable assertions.
function conserved(
  rows: string[],
  threshold: number,
  denominator: ConservationDenominator,
): string {
  const v = viewFrom(rows);
  const p = columnProfiles(v, 0, v.numRows - 1);
  return [...conservedColumns(p, threshold, denominator)].join("");
}

describe("conservedColumns — all-rows denominator (gaps dilute)", () => {
  it("a fully-identical column is conserved at any threshold ≤ 100%", () => {
    expect(conserved(["AA", "AA", "AA"], 1.0, "all-rows")).toBe("11");
  });

  it("gaps count against conservation: half-gap all-agree is 50%, not 100%", () => {
    // col0: A,A,- → top A count 2 of 3 rows = 0.667 ; col1: A,-,- → 1 of 3 = 0.333
    expect(conserved(["AA", "A-", "--"], 0.6, "all-rows")).toBe("10"); // 0.667≥0.6, 0.333<0.6
    expect(conserved(["AA", "A-", "--"], 0.7, "all-rows")).toBe("00"); // 0.667<0.7
  });

  it("the ≥ boundary is inclusive and integer-exact (exactly 50% counts)", () => {
    // col0: A,A,G,G → top count 2 of 4 = exactly 0.5
    expect(conserved(["A", "A", "G", "G"], 0.5, "all-rows")).toBe("1"); // 0.5 ≥ 0.5
    expect(conserved(["A", "A", "G", "G"], 0.51, "all-rows")).toBe("0"); // 0.5 < 0.51
  });
});

describe("conservedColumns — non-gap denominator (agreement among present)", () => {
  it("half-gap all-agree columns read as fully conserved (gaps don't count)", () => {
    // col0: A,A,- → top A 2 of 2 non-gap = 1.0 ; col1: A,-,- → 1 of 1 non-gap = 1.0
    // (the SAME data is only 0.667 / 0.333 under all-rows — the denominator matters)
    expect(conserved(["AA", "A-", "--"], 1.0, "non-gap")).toBe("11");
    expect(conserved(["AA", "A-", "--"], 1.0, "all-rows")).toBe("00");
  });

  it("disagreement among present residues lowers the fraction", () => {
    // col0: A,C,- → top count 1 of 2 non-gap = 0.5
    expect(conserved(["A", "C", "-"], 0.5, "non-gap")).toBe("1");
    expect(conserved(["A", "C", "-"], 0.6, "non-gap")).toBe("0");
  });
});

describe("conservedColumns — all-gap column is never conserved", () => {
  it("an all-gap column → 0 under both denominators, even at threshold 0", () => {
    expect(conserved(["-", "-"], 0, "all-rows")).toBe("0");
    expect(conserved(["-", "-"], 0, "non-gap")).toBe("0");
  });

  it("threshold 0 marks every NON-all-gap column conserved", () => {
    // col0 has a residue → conserved at ≥0% ; col1 all-gap → never
    expect(conserved(["A-", "G-"], 0, "all-rows")).toBe("10");
  });
});

describe("coloringControlsEnabled — dialog disabled-state map", () => {
  it("by-residue grid + full track: neither conservation nor highlight matters", () => {
    expect(coloringControlsEnabled(DEFAULT_COLORING)).toEqual({
      conservation: false,
      highlightStyle: false,
    });
  });

  it("by-conservation grid turns on conservation AND highlight style", () => {
    const cfg: ColoringConfig = { ...DEFAULT_COLORING, grid: "by-conservation" };
    expect(coloringControlsEnabled(cfg)).toEqual({ conservation: true, highlightStyle: true });
  });

  it("match-consensus grid uses highlight style but not conservation", () => {
    const cfg: ColoringConfig = { ...DEFAULT_COLORING, grid: "match-consensus" };
    expect(coloringControlsEnabled(cfg)).toEqual({ conservation: false, highlightStyle: true });
  });

  it("a consensus-only/nonconsensus-only track turns on conservation (grid by-residue)", () => {
    expect(coloringControlsEnabled({ ...DEFAULT_COLORING, track: "consensus-only" })).toEqual({
      conservation: true,
      highlightStyle: false,
    });
    expect(coloringControlsEnabled({ ...DEFAULT_COLORING, track: "nonconsensus-only" })).toEqual({
      conservation: true,
      highlightStyle: false,
    });
  });
});
