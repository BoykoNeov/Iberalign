// Tests for the residue color schemes — the one pure, headless-testable surface
// of the Canvas core (drawing itself needs a real canvas, forbidden in CI). These
// catch real defects: a wrong residue→color mapping, case-sensitivity creeping
// in, the gap/fallback paths swapping, ink contrast inverting, or the registry
// default drifting.

import { describe, it, expect } from "vitest";
import {
  makeScheme,
  getScheme,
  registerScheme,
  listSchemes,
  CLASSIC_SCHEME,
  COLORBLIND_SCHEME,
  DEFAULT_SCHEME_ID,
  INK_DARK,
  INK_LIGHT,
  type Rgb,
} from "./colors";

const ord = (ch: string) => ch.charCodeAt(0);

describe("classic scheme — the conventional vivid mapping", () => {
  const fill = (ch: string) => CLASSIC_SCHEME.fillStyleFor(ord(ch));

  it("maps A green, T red, C cyan, G magenta", () => {
    expect(fill("A")).toBe("rgb(44, 160, 44)"); // green
    expect(fill("T")).toBe("rgb(227, 26, 28)"); // red
    expect(fill("C")).toBe("rgb(0, 188, 212)"); // cyan
    expect(fill("G")).toBe("rgb(204, 46, 201)"); // magenta
  });

  it("colors U as T (RNA shares the pyrimidine)", () => {
    expect(fill("U")).toBe(fill("T"));
  });

  it("is case-insensitive (lowercase residues share their color)", () => {
    for (const ch of ["A", "C", "G", "T", "U"]) {
      expect(fill(ch.toLowerCase())).toBe(fill(ch));
    }
  });

  it("maps both gap bytes to the gap color, distinct from residues", () => {
    expect(fill("-")).toBe(fill("."));
    expect(fill("-")).not.toBe(fill("A"));
  });

  it("maps unknown residues / ambiguity codes to the fallback, ≠ gap", () => {
    expect(fill("N")).toBe(fill("Z")); // both fall through to fallback
    expect(fill("N")).not.toBe(fill("-")); // fallback grey ≠ gap grey
  });
});

describe("glyph ink contrast", () => {
  it("inks light fills dark and dark fills light", () => {
    // classic C (cyan) is light → dark ink; A (green) is dark → light ink.
    expect(CLASSIC_SCHEME.inkStyleFor(ord("C"))).toBe(INK_DARK);
    expect(CLASSIC_SCHEME.inkStyleFor(ord("A"))).toBe(INK_LIGHT);
  });

  it("derives ink from the residue's own fill (lowercase matches uppercase)", () => {
    expect(CLASSIC_SCHEME.inkStyleFor(ord("c"))).toBe(CLASSIC_SCHEME.inkStyleFor(ord("C")));
  });
});

describe("makeScheme", () => {
  it("bakes a custom palette with gap and fallback handling", () => {
    const red: Rgb = [255, 0, 0];
    const s = makeScheme({
      id: "test",
      label: "Test",
      residues: { A: red },
      gap: [1, 1, 1],
      fallback: [2, 2, 2],
    });
    expect(s.fillStyleFor(ord("A"))).toBe("rgb(255, 0, 0)");
    expect(s.fillStyleFor(ord("a"))).toBe("rgb(255, 0, 0)");
    expect(s.fillStyleFor(ord("-"))).toBe("rgb(1, 1, 1)");
    expect(s.fillStyleFor(ord("X"))).toBe("rgb(2, 2, 2)");
  });
});

describe("scheme registry (selectability)", () => {
  it("defaults to the colorblind-safe scheme", () => {
    expect(DEFAULT_SCHEME_ID).toBe("colorblind");
    expect(getScheme(DEFAULT_SCHEME_ID)).toBe(COLORBLIND_SCHEME);
  });

  it("falls back to the default for an unknown id", () => {
    expect(getScheme("does-not-exist")).toBe(COLORBLIND_SCHEME);
  });

  it("lists the built-in schemes", () => {
    const ids = listSchemes().map((s) => s.id);
    expect(ids).toContain("colorblind");
    expect(ids).toContain("classic");
  });

  it("registers a custom scheme so it becomes selectable", () => {
    const custom = makeScheme({
      id: "custom-test",
      label: "Custom",
      residues: { A: [10, 20, 30] },
      gap: [0, 0, 0],
      fallback: [0, 0, 0],
    });
    registerScheme(custom);
    expect(getScheme("custom-test")).toBe(custom);
    expect(listSchemes().map((s) => s.id)).toContain("custom-test");
  });
});
