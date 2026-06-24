import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import { columnConsensus } from "./consensus";
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

// Decode a consensus byte array to a string for readable assertions.
function str(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function consAll(rows: string[], alphabet: AlphabetLabel = "DNA"): string {
  const v = viewFrom(rows, alphabet);
  return str(columnConsensus(v, 0, v.numRows - 1));
}

describe("columnConsensus — strict IUPAC (DNA)", () => {
  it("conserved columns collapse to the single base", () => {
    expect(consAll(["ACGT", "ACGT", "ACGT"])).toBe("ACGT");
  });

  it("two bases → the IUPAC pair code; all four → N", () => {
    // col0 A/A/A → A; col1 A/G → R; col2 C/T → Y; col3 A/C/G/T → N
    expect(consAll(["AACA", "AATC", "AGCG", "AGTT"])).toBe("ARYN");
  });

  it("every two-base pair maps to its IUPAC code", () => {
    // pairs: A|C=M, A|G=R, A|T=W, C|G=S, C|T=Y, G|T=K
    const rows = [
      "AAACCG", // row 0
      "CGTGTT", // row 1
    ];
    // col: A/C=M, A/G=R, A/T=W, C/G=S, C/T=Y, G/T=K
    expect(consAll(rows)).toBe("MRWSYK");
  });

  it("gaps are ignored (a column with gaps + one base → that base)", () => {
    expect(consAll(["A-", "--", "A-"])).toBe("A-"); // col0 A; col1 all gap → -
  });

  it("an all-gap column → '-'", () => {
    expect(consAll(["-A-", "-C-"])).toBe("-M-");
  });

  it("ambiguity codes in the data expand to their bases", () => {
    // R = A|G; adding C → A|G|C = V. Y = C|T; adding it to col1.
    expect(consAll(["RC", "CY"])).toBe("VY");
    // col0: R(A|G) + C = A|C|G = V ; col1: C + Y(C|T) = C|T = Y
  });

  it("N in the data forces N", () => {
    expect(consAll(["A", "N"])).toBe("N");
  });
});

describe("columnConsensus — RNA", () => {
  it("a pure-T (uracil) column reads U, but mixed codes keep their IUPAC letter", () => {
    // col0 T/T → U ; col1 G/T → K (unchanged) ; col2 A/A → A
    expect(consAll(["TGA", "TTA"], "RNA")).toBe("UKA");
  });

  it("U in the data is treated as T-bit and rendered U when alone", () => {
    expect(consAll(["U", "U"], "RNA")).toBe("U");
  });
});

describe("columnConsensus — Protein plurality", () => {
  it("most common residue wins; case-folded", () => {
    // col0: M,M,m → M (3) ; col1: K,K,R → K (2 vs 1)
    expect(consAll(["MK", "MK", "mR"], "Protein")).toBe("MK");
  });

  it("ties break to the smallest byte (order-independent)", () => {
    // col0: W then A, one each → tie → smallest byte 'A'
    expect(consAll(["W", "A"], "Protein")).toBe("A");
    expect(consAll(["A", "W"], "Protein")).toBe("A");
  });

  it("an all-gap column → '-'", () => {
    expect(consAll(["-K", "-R"], "Protein")).toBe("-K");
  });
});

describe("columnConsensus — row range + clamping", () => {
  const v = viewFrom(["AAAA", "GGGG", "CCCC", "TTTT"]);

  it("scopes to the given row range", () => {
    expect(str(columnConsensus(v, 0, 1))).toBe("RRRR"); // A|G
    expect(str(columnConsensus(v, 2, 3))).toBe("YYYY"); // C|T
    expect(str(columnConsensus(v, 1, 1))).toBe("GGGG"); // single row
  });

  it("clamps out-of-range and reversed bounds", () => {
    expect(str(columnConsensus(v, -5, 99))).toBe("NNNN"); // clamps to all rows
    expect(str(columnConsensus(v, 3, 0))).toBe("NNNN"); // reversed == all rows
  });

  it("a zero-width view yields an empty array", () => {
    const empty = new AlignmentView(new Uint8Array(0), {
      width: 0,
      numRows: 0,
      names: [],
      alphabet: "DNA",
    });
    expect(columnConsensus(empty, 0, 0).length).toBe(0);
  });
});
