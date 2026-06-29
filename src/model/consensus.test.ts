import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import {
  columnConsensus,
  consensusBytes,
  consensusControlsEnabled,
  type ConsensusConfig,
} from "./consensus";
import { columnProfiles } from "./profile";
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

// ── The configurable pipeline (Phase 2 engine) ───────────────────────────────

// Base config: strict-IUPAC, gaps ignored — equivalent to today's DNA default.
const STRICT: ConsensusConfig = {
  gap: "ignore",
  rule: "strict-iupac",
  sameTypeDisplay: "ry-code",
  sameTypeMaxBases: 2,
  majorityThreshold: 0.5,
  noConsensus: "gap",
};

// Run the pipeline for an explicit config over the full row range.
function cons(rows: string[], cfg: Partial<ConsensusConfig>, alphabet: AlphabetLabel = "DNA"): string {
  const v = viewFrom(rows, alphabet);
  const p = columnProfiles(v, 0, v.numRows - 1);
  return str(consensusBytes(p, { ...STRICT, ...cfg }, alphabet));
}

describe("consensusBytes — gap handling (step 1, short-circuit first)", () => {
  it("gap-priority: any gap in a column → '-'", () => {
    // col0 A/A → A ; col1 A/- → gap present → '-' (overrides the rule)
    expect(cons(["AA", "A-"], { gap: "gap-priority" })).toBe("A-");
  });

  it("star-if-gap: any gap in a column → '*', including an all-gap column", () => {
    // col0 A/A → A ; col1 -/- → all gap → '*' (NOT '-': short-circuit beats the
    // nonGap==0 guard — the ordering the pipeline pins).
    expect(cons(["A-", "A-"], { gap: "star-if-gap" })).toBe("A*");
  });

  it("ignore (default) leaves gapped-but-present columns to the rule", () => {
    expect(cons(["AA", "A-"], { gap: "ignore" })).toBe("AA"); // col1 A only → A
  });
});

describe("consensusBytes — all-identical", () => {
  it("one distinct residue → that residue; any variation → fallback", () => {
    // col0 A/A → A ; col1 A/G → 2 distinct → fallback '-'
    expect(cons(["AA", "AG"], { rule: "all-identical" })).toBe("A-");
  });

  it("gaps are ignored, so identical-around-gaps still agrees", () => {
    expect(cons(["A", "-", "A"], { rule: "all-identical" })).toBe("A");
  });

  it("noConsensus: star emits '*' on disagreement", () => {
    expect(cons(["AA", "AG"], { rule: "all-identical", noConsensus: "star" })).toBe("A*");
  });
});

describe("consensusBytes — same-type", () => {
  it("ry-code: all-purine → R, all-pyrimidine → Y, mixed → fallback", () => {
    // col0 A/G purine → R ; col1 C/T pyrimidine → Y ; col2 A/C mixed → '-'
    expect(cons(["ACA", "GTC"], { rule: "same-type", sameTypeDisplay: "ry-code" })).toBe("RY-");
  });

  it("ry-code: a conserved single base is still classed by type", () => {
    // all-A → purine → R ; all-C → pyrimidine → Y
    expect(cons(["AC", "AC"], { rule: "same-type", sameTypeDisplay: "ry-code" })).toBe("RY");
  });

  it("majority-base: same purine/pyrimidine test, but shows the top base", () => {
    // col0 A,A,G purine → top A ; col1 C,T,T pyrimidine → top T ; col2 A,C mixed → '-'
    expect(
      cons(["ACA", "ATC", "GTC"], { rule: "same-type", sameTypeDisplay: "majority-base" }),
    ).toBe("AT-");
  });

  it("iupac-class: ≤2 distinct bases → their code; 3+ bases → fallback (default cutoff 2)", () => {
    // col0 C/G → S (2 bases) ; col1 A/C/G → 3 bases → fallback '-'
    expect(cons(["CA", "GC", "GG"], { rule: "same-type", sameTypeDisplay: "iupac-class" })).toBe(
      "S-",
    );
  });

  it("iupac-class cutoff 3: a 3-base column → its B/D/H/V code; 4 bases still fall back", () => {
    // col0 A/C/G → V (3 bases, admitted at cutoff 3) ; col1 A/C/G/T → 4 bases → '-'
    expect(
      cons(["AA", "CC", "GG", "AT"], {
        rule: "same-type",
        sameTypeDisplay: "iupac-class",
        sameTypeMaxBases: 3,
      }),
    ).toBe("V-");
  });

  it("iupac-class cutoff is ignored under ry-code / majority-base display", () => {
    // A/C/G is 3 distinct bases but not all one R/Y group → fallback regardless of cutoff.
    expect(
      cons(["A", "C", "G"], {
        rule: "same-type",
        sameTypeDisplay: "ry-code",
        sameTypeMaxBases: 3,
      }),
    ).toBe("-");
  });

  it("non-nucleotide residues have no type → fallback", () => {
    expect(cons(["*", "*"], { rule: "same-type", sameTypeDisplay: "ry-code" })).toBe("-");
  });

  it("iupac-class rewrites a pure-T class to U under RNA", () => {
    // col0 T/T (RNA) → mask is the T-bit → IUPAC 'T' → rewritten 'U'
    expect(cons(["T", "T"], { rule: "same-type", sameTypeDisplay: "iupac-class" }, "RNA")).toBe(
      "U",
    );
  });
});

describe("consensusBytes — majority (integer-exact threshold)", () => {
  it("default >50% is exclusive: a 3/6 tie fails, 4/6 passes", () => {
    // col0 A×4,G×2 → 4/6 > 50% → A ; col1 A×3,G×3 → 3/6 == 50%, not > → '-'
    expect(cons(["AA", "AA", "AA", "AG", "GG", "GG"], { rule: "majority" })).toBe("A-");
  });

  it("a 3/5 column at a 0.6 threshold reads as no-consensus (exact boundary)", () => {
    // 3/5 == 0.6 exactly; strict '>' must reject it (fp would wrongly accept).
    expect(cons(["A", "A", "A", "G", "G"], { rule: "majority", majorityThreshold: 0.6 })).toBe("-");
    // 3/5 just over a 0.59 threshold → accepted.
    expect(cons(["A", "A", "A", "G", "G"], { rule: "majority", majorityThreshold: 0.59 })).toBe(
      "A",
    );
  });

  it("threshold 0 ≡ plurality: always emits the top residue (smallest-byte tie)", () => {
    expect(cons(["AG", "GA"], { rule: "majority", majorityThreshold: 0 })).toBe("AA"); // A,G tie → A
  });
});

describe("consensusBytes — strict-iupac keeps the all-non-nucleotide '-' quirk", () => {
  it("a column of only non-nucleotide residues → '-' under strict-iupac", () => {
    // mask 0 with nonGap>0 → IUPAC[0] = '-' (deliberately kept; new rules fall back).
    expect(cons(["*", "*"], { rule: "strict-iupac" })).toBe("-");
  });
});

describe("consensusControlsEnabled — dialog disabled-state map mirrors the pipeline", () => {
  it("strict-iupac: only gap handling matters (fallback + sub-modes off)", () => {
    expect(consensusControlsEnabled({ ...STRICT, rule: "strict-iupac" })).toEqual({
      sameTypeDisplay: false,
      sameTypeMaxBases: false,
      majorityThreshold: false,
      noConsensus: false, // strict always yields a code → no fallback
    });
  });

  it("majority: threshold + fallback on, same-type sub-modes off", () => {
    expect(consensusControlsEnabled({ ...STRICT, rule: "majority" })).toEqual({
      sameTypeDisplay: false,
      sameTypeMaxBases: false,
      majorityThreshold: true,
      noConsensus: true,
    });
  });

  it("same-type: display on, fallback on, threshold off; maxBases gated on iupac-class", () => {
    expect(
      consensusControlsEnabled({ ...STRICT, rule: "same-type", sameTypeDisplay: "ry-code" }),
    ).toEqual({
      sameTypeDisplay: true,
      sameTypeMaxBases: false, // only under iupac-class
      majorityThreshold: false,
      noConsensus: true,
    });
    expect(
      consensusControlsEnabled({ ...STRICT, rule: "same-type", sameTypeDisplay: "iupac-class" }),
    ).toEqual({
      sameTypeDisplay: true,
      sameTypeMaxBases: true,
      majorityThreshold: false,
      noConsensus: true,
    });
  });

  it("all-identical: fallback on, every same-type/majority sub-control off", () => {
    expect(consensusControlsEnabled({ ...STRICT, rule: "all-identical" })).toEqual({
      sameTypeDisplay: false,
      sameTypeMaxBases: false,
      majorityThreshold: false,
      noConsensus: true,
    });
  });
});
