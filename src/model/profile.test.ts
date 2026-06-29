import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import { columnProfiles, BASE_MASK, A, C, G, T } from "./profile";
import type { AlphabetLabel } from "./types";

// Build a tiny view from rows of equal-length residue strings.
function viewFrom(rows: string[], alphabet: AlphabetLabel = "DNA"): AlignmentView {
  const width = rows[0]?.length ?? 0;
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c++) buffer[r * width + c] = row.charCodeAt(c);
  });
  const names = rows.map((_, i) => `s${i}`);
  return new AlignmentView(buffer, { width, numRows: rows.length, names, alphabet });
}

const ch = (s: string) => s.charCodeAt(0);

describe("columnProfiles — counts and gaps", () => {
  it("counts non-gap and gap per column over the full range", () => {
    const p = columnProfiles(viewFrom(["A-C", "A-C", "G-C"]), 0, 2);
    expect([...p.nonGap]).toEqual([3, 0, 3]); // col1 all gap
    expect([...p.gap]).toEqual([0, 3, 0]);
  });

  it("treats both '-' and '.' as gaps", () => {
    const p = columnProfiles(viewFrom(["A.", "A-"]), 0, 1);
    expect([...p.nonGap]).toEqual([2, 0]);
    expect([...p.gap]).toEqual([0, 2]);
  });
});

describe("columnProfiles — top residue (plurality with smallest-byte tiebreak)", () => {
  it("picks the most common residue and its count, case-folded", () => {
    // col0: A,A,a → A(3) ; col1: K,K,R → K(2)
    const p = columnProfiles(viewFrom(["AK", "AK", "aR"], "Protein"), 0, 2);
    expect(String.fromCharCode(p.topByte[0])).toBe("A");
    expect(p.topCount[0]).toBe(3);
    expect(String.fromCharCode(p.topByte[1])).toBe("K");
    expect(p.topCount[1]).toBe(2);
  });

  it("breaks ties to the smallest byte, independent of row order", () => {
    const a = columnProfiles(viewFrom(["W", "A"], "Protein"), 0, 1);
    const b = columnProfiles(viewFrom(["A", "W"], "Protein"), 0, 1);
    expect(String.fromCharCode(a.topByte[0])).toBe("A");
    expect(String.fromCharCode(b.topByte[0])).toBe("A");
  });

  it("an all-gap column has topByte 0 and topCount 0", () => {
    const p = columnProfiles(viewFrom(["-", "-"]), 0, 1);
    expect(p.topByte[0]).toBe(0);
    expect(p.topCount[0]).toBe(0);
  });
});

describe("columnProfiles — distinct count", () => {
  it("counts distinct case-folded non-gap residues", () => {
    // col0: A,A,a → 1 distinct ; col1: A,C,G → 3
    const p = columnProfiles(viewFrom(["AA", "AC", "aG"]), 0, 2);
    expect(p.distinct[0]).toBe(1);
    expect(p.distinct[1]).toBe(3);
  });
});

describe("columnProfiles — base mask union", () => {
  it("ORs the base bits of the residues present", () => {
    // col0: A,G → A|G ; col1: C,T → C|T ; col2: A,C,G,T → all four
    const p = columnProfiles(viewFrom(["ACA", "GTC", "ACG", "GTT"]), 0, 3);
    expect(p.baseMask[0]).toBe(A | G);
    expect(p.baseMask[1]).toBe(C | T);
    expect(p.baseMask[2]).toBe(A | C | G | T);
  });

  it("expands ambiguity codes in the data", () => {
    // R = A|G, add C → A|C|G
    const p = columnProfiles(viewFrom(["R", "C"]), 0, 1);
    expect(p.baseMask[0]).toBe(A | C | G);
  });

  it("non-nucleotide residues contribute 0 to the mask", () => {
    expect(BASE_MASK[ch("*")]).toBe(0);
    expect(BASE_MASK[ch("X")]).toBe(0);
    const p = columnProfiles(viewFrom(["*", "*"]), 0, 1);
    expect(p.baseMask[0]).toBe(0);
    expect(p.nonGap[0]).toBe(2); // still counted as residues
  });
});

describe("columnProfiles — row range and clamping", () => {
  const v = viewFrom(["AAAA", "GGGG", "CCCC", "TTTT"]);

  it("scopes to the given row range", () => {
    const p = columnProfiles(v, 0, 1); // A,G rows
    expect(p.baseMask[0]).toBe(A | G);
    expect(p.nonGap[0]).toBe(2);
  });

  it("clamps and accepts reversed bounds", () => {
    const all = columnProfiles(v, -5, 99);
    expect(all.baseMask[0]).toBe(A | C | G | T);
    const rev = columnProfiles(v, 3, 0);
    expect(rev.baseMask[0]).toBe(A | C | G | T);
  });

  it("a zero-width view yields zero-length arrays", () => {
    const empty = new AlignmentView(new Uint8Array(0), {
      width: 0,
      numRows: 0,
      names: [],
      alphabet: "DNA",
    });
    const p = columnProfiles(empty, 0, 0);
    expect(p.width).toBe(0);
    expect(p.nonGap.length).toBe(0);
  });
});
