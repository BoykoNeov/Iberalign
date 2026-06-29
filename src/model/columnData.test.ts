import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import { ColumnData } from "./columnData";
import { DEFAULT_COLORING, type ColoringConfig } from "./coloring";
import type { ConsensusConfig } from "./consensus";
import type { AlphabetLabel } from "./types";

function viewFrom(rows: string[], alphabet: AlphabetLabel = "DNA"): AlignmentView {
  const width = rows[0]?.length ?? 0;
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < width; c++) buffer[r * width + c] = row.charCodeAt(c);
  });
  const names = rows.map((_, i) => `s${i}`);
  return new AlignmentView(buffer, { width, numRows: rows.length, names, alphabet });
}

const str = (b: Uint8Array) => String.fromCharCode(...b);

const STRICT: ConsensusConfig = {
  gap: "ignore",
  rule: "strict-iupac",
  sameTypeDisplay: "ry-code",
  sameTypeMaxBases: 2,
  majorityThreshold: 0.5,
  noConsensus: "gap",
};

describe("ColumnData — profile sharing & view-identity caching", () => {
  it("returns the SAME profile object for the same view (built once)", () => {
    const cd = new ColumnData();
    const v = viewFrom(["ACGT", "ACGT"]);
    const a = cd.profiles(v);
    const b = cd.profiles(v);
    expect(a).toBe(b); // memoized by identity — not rebuilt
  });

  it("rebuilds for a different view object", () => {
    const cd = new ColumnData();
    const v1 = viewFrom(["AA"]);
    const v2 = viewFrom(["GG"]);
    const p1 = cd.profiles(v1);
    const p2 = cd.profiles(v2);
    expect(p1).not.toBe(p2);
  });

  it("invalidate() forces a rebuild even for the same view (post-edit)", () => {
    const cd = new ColumnData();
    const v = viewFrom(["AA"]);
    const before = cd.profiles(v);
    cd.invalidate();
    const after = cd.profiles(v);
    expect(after).not.toBe(before); // same view object, but recomputed
  });
});

describe("ColumnData — consensus bytes (config cascade)", () => {
  it("null config follows the alphabet default (strict-IUPAC for DNA)", () => {
    const cd = new ColumnData();
    const v = viewFrom(["AC", "GT"]); // col0 A|G=R, col1 C|T=Y
    expect(str(cd.consensus(v, null))).toBe("RY");
  });

  it("memoizes by config identity and recomputes when the config object changes", () => {
    const cd = new ColumnData();
    const v = viewFrom(["AC", "GT"]);
    const c1 = cd.consensus(v, STRICT);
    const c1again = cd.consensus(v, STRICT);
    expect(c1again).toBe(c1); // same config object → cached

    const majority: ConsensusConfig = { ...STRICT, rule: "majority", majorityThreshold: 0 };
    const c2 = cd.consensus(v, majority); // new object → recompute
    expect(c2).not.toBe(c1);
    expect(str(c2)).toBe("AC"); // plurality: top base per column (smallest-byte tie)
  });

  it("a config change after a null-default request recomputes (cascade reaches the grid)", () => {
    const cd = new ColumnData();
    const v = viewFrom(["AC", "GT"]);
    const dflt = cd.consensus(v, null); // R Y
    const allId = cd.consensus(v, { ...STRICT, rule: "all-identical" }); // both cols vary → '-' '-'
    expect(dflt).not.toBe(allId);
    expect(str(allId)).toBe("--");
  });
});

describe("ColumnData — conserved mask (coloring cascade)", () => {
  it("derives the mask from the coloring config and caches by its identity", () => {
    const cd = new ColumnData();
    const v = viewFrom(["AA", "AA", "GA"]); // col0: A 2/3 ; col1: A 3/3
    const m1 = cd.conserved(v, DEFAULT_COLORING); // threshold 0.5, all-rows
    expect([...m1].join("")).toBe("11"); // 0.667≥0.5 and 1.0≥0.5
    expect(cd.conserved(v, DEFAULT_COLORING)).toBe(m1); // same object → cached

    const strict: ColoringConfig = { ...DEFAULT_COLORING, conservationThreshold: 0.7 };
    const m2 = cd.conserved(v, strict); // new object → recompute
    expect(m2).not.toBe(m1);
    expect([...m2].join("")).toBe("01"); // 0.667<0.7, 1.0≥0.7
  });

  it("shares the one profile across consensus() and conserved()", () => {
    const cd = new ColumnData();
    const v = viewFrom(["AC", "GT"]);
    const p = cd.profiles(v);
    cd.consensus(v, null);
    cd.conserved(v, DEFAULT_COLORING);
    expect(cd.profiles(v)).toBe(p); // still the same single profile object
  });
});
