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
  VIVID_SCHEME,
  DEFAULT_SCHEME_ID,
  GLYPH_INK,
  type Rgb,
} from "./colors";

const ord = (ch: string) => ch.charCodeAt(0);

describe("vivid scheme — the bright default mapping", () => {
  const fill = (ch: string) => VIVID_SCHEME.fillStyleFor(ord(ch));

  it("maps A green, T red, C blue, G yellow", () => {
    expect(fill("A")).toBe("rgb(34, 195, 42)"); // green
    expect(fill("T")).toBe("rgb(255, 42, 42)"); // red
    expect(fill("C")).toBe("rgb(46, 144, 255)"); // light azure blue
    expect(fill("G")).toBe("rgb(255, 210, 26)"); // yellow
  });

  it("colors U as T (RNA shares the pyrimidine)", () => {
    expect(fill("U")).toBe(fill("T"));
  });
});

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

describe("glyph ink — always black", () => {
  it("inks every residue solid black, regardless of fill or scheme", () => {
    for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
      for (const ch of ["A", "C", "G", "T", "U", "N"]) {
        expect(scheme.inkStyleFor(ord(ch))).toBe(GLYPH_INK);
      }
    }
  });

  it("inks gaps black too (uniform ink table)", () => {
    expect(VIVID_SCHEME.inkStyleFor(ord("-"))).toBe(GLYPH_INK);
  });
});

describe("trailing-padding fill", () => {
  it("is a faint grey distinct from BOTH the interior-gap fill and the background", () => {
    for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
      const gap = scheme.fillStyleFor(ord("-"));
      expect(scheme.trailingStyle).not.toBe(gap); // padding ≠ real gap
      expect(scheme.trailingStyle).not.toBe(scheme.background); // still reads as a cell
    }
  });

  it("defaults when a custom spec omits `trailing`", () => {
    const s = makeScheme({ id: "t", label: "T", residues: {}, gap: [1, 1, 1], fallback: [2, 2, 2] });
    expect(s.trailingStyle).toBe("rgb(241, 241, 241)");
  });

  it("honors an explicit `trailing` override", () => {
    const s = makeScheme({
      id: "t2",
      label: "T2",
      residues: {},
      gap: [1, 1, 1],
      fallback: [2, 2, 2],
      trailing: [9, 9, 9],
    });
    expect(s.trailingStyle).toBe("rgb(9, 9, 9)");
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
  it("defaults to the vivid scheme", () => {
    expect(DEFAULT_SCHEME_ID).toBe("vivid");
    expect(getScheme(DEFAULT_SCHEME_ID)).toBe(VIVID_SCHEME);
  });

  it("falls back to the default for an unknown id", () => {
    expect(getScheme("does-not-exist")).toBe(VIVID_SCHEME);
  });

  it("lists the built-in schemes", () => {
    const ids = listSchemes().map((s) => s.id);
    expect(ids).toContain("vivid");
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
