// Tests for the Phase-4 color resolvers — pure, so exercisable without a canvas.
// They pin the mode logic (highlight vs fade side, gaps-stay-gaps, case-folding,
// the missing-array fallback) that a manual smoke would catch far too late.

import { describe, it, expect } from "vitest";
import { makeGridStyleFor, trackFillFor } from "./coloring";
import { VIVID_SCHEME as S } from "./colors";

const ord = (ch: string) => ch.charCodeAt(0);
const A = ord("A");
const C = ord("C");
const GAP = ord("-");

const GREEN = S.fillStyleFor(A); // vivid A
const BLUE = S.fillStyleFor(C); // vivid C
const GAPCSS = S.fillStyleFor(GAP);
const MUTED = S.mutedStyle;
const ACCENT = S.accentStyle;

describe("makeGridStyleFor — by-residue (unchanged)", () => {
  it("returns the per-residue fill, ignoring the column", () => {
    const f = makeGridStyleFor("by-residue", S, "residue", null, null);
    expect(f(A, 0)).toBe(GREEN);
    expect(f(C, 99)).toBe(BLUE);
    expect(f(GAP, 0)).toBe(GAPCSS);
  });
});

describe("makeGridStyleFor — by-conservation", () => {
  const mask = Uint8Array.from([1, 0]); // col0 conserved, col1 not

  it("residue highlight: conserved keeps residue color, variable fades, gaps stay gaps", () => {
    const f = makeGridStyleFor("by-conservation", S, "residue", null, mask);
    expect(f(A, 0)).toBe(GREEN); // conserved column → residue color
    expect(f(A, 1)).toBe(MUTED); // variable column → faded
    expect(f(GAP, 1)).toBe(GAPCSS); // a gap is always a gap
  });

  it("uniform highlight: conserved → flat accent, variable → faded", () => {
    const f = makeGridStyleFor("by-conservation", S, "uniform", null, mask);
    expect(f(A, 0)).toBe(ACCENT);
    expect(f(C, 0)).toBe(ACCENT); // residue identity dropped under uniform
    expect(f(A, 1)).toBe(MUTED);
  });

  it("falls back to by-residue when the mask is missing", () => {
    const f = makeGridStyleFor("by-conservation", S, "residue", null, null);
    expect(f(A, 0)).toBe(GREEN);
  });
});

describe("makeGridStyleFor — match / mismatch-consensus", () => {
  const cons = Uint8Array.from([A, C]); // consensus A at col0, C at col1

  it("match-consensus highlights cells equal to the consensus, fades the rest", () => {
    const f = makeGridStyleFor("match-consensus", S, "residue", cons, null);
    expect(f(A, 0)).toBe(GREEN); // A == consensus A → highlighted
    expect(f(C, 0)).toBe(MUTED); // C != consensus A → faded
    expect(f(C, 1)).toBe(BLUE); // C == consensus C → highlighted
  });

  it("mismatch-consensus is the inverse (highlights the variants)", () => {
    const f = makeGridStyleFor("mismatch-consensus", S, "residue", cons, null);
    expect(f(A, 0)).toBe(MUTED); // matches → faded
    expect(f(C, 0)).toBe(BLUE); // differs → highlighted (its own color)
  });

  it("is case-insensitive (lowercase residue folds before comparing)", () => {
    const f = makeGridStyleFor("match-consensus", S, "residue", cons, null);
    expect(f(ord("a"), 0)).toBe(S.fillStyleFor(ord("a"))); // 'a' folds to A → match → residue color
  });

  it("gaps stay gaps in both modes", () => {
    const fm = makeGridStyleFor("match-consensus", S, "residue", cons, null);
    const fx = makeGridStyleFor("mismatch-consensus", S, "residue", cons, null);
    expect(fm(GAP, 0)).toBe(GAPCSS);
    expect(fx(GAP, 0)).toBe(GAPCSS);
  });

  it("falls back to by-residue when the consensus array is missing", () => {
    const f = makeGridStyleFor("match-consensus", S, "residue", null, null);
    expect(f(A, 0)).toBe(GREEN);
  });
});

describe("trackFillFor — consensus-track modes", () => {
  const N = "NEUTRAL"; // stand-in for the chrome background

  it("full colors every cell by its consensus byte", () => {
    expect(trackFillFor("full", S, N, A, false)).toBe(GREEN);
    expect(trackFillFor("full", S, N, A, true)).toBe(GREEN);
  });

  it("none is glyph-only (always neutral)", () => {
    expect(trackFillFor("none", S, N, A, true)).toBe(N);
  });

  it("consensus-only colors conserved columns, neutral otherwise", () => {
    expect(trackFillFor("consensus-only", S, N, A, true)).toBe(GREEN);
    expect(trackFillFor("consensus-only", S, N, A, false)).toBe(N);
  });

  it("nonconsensus-only colors variable columns, neutral otherwise", () => {
    expect(trackFillFor("nonconsensus-only", S, N, A, false)).toBe(GREEN);
    expect(trackFillFor("nonconsensus-only", S, N, A, true)).toBe(N);
  });
});
