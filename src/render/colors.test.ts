// Tests for the residue color schemes — the one pure, headless-testable surface
// of the Canvas core (drawing itself needs a real canvas, forbidden in CI). These
// catch real defects: a wrong residue→color mapping, case-sensitivity creeping
// in, the gap/fallback paths swapping, ink contrast inverting, or the registry
// default drifting.

import { describe, it, expect } from "vitest";
import {
  makeScheme,
  getScheme,
  schemeForAlphabet,
  registerScheme,
  listSchemes,
  CLASSIC_SCHEME,
  COLORBLIND_SCHEME,
  VIVID_SCHEME,
  DEFAULT_SCHEME_ID,
  GLYPH_INK,
  schemeWithOverrides,
  resolveResidue,
  autoInk,
  rgbToHex,
  hexToRgb,
  parseRgbCss,
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
    // B (Asx), Z (Glx) are ambiguity codes, not among the 20 standard amino acids,
    // so both fall through to fallback. (Standard amino acids like N are now colored
    // — see the protein-palette test below.)
    expect(fill("B")).toBe(fill("Z")); // both fall through to fallback
    expect(fill("B")).not.toBe(fill("-")); // fallback grey ≠ gap grey
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

// `rgb(n, n, n)` → n. Our neutrals are pure greys, so the first channel is the value.
const greyOf = (css: string): number => {
  const m = css.match(/\d+/);
  return m ? Number(m[0]) : NaN;
};

describe("trailing-padding fill", () => {
  it("is distinct from the interior-gap fill (told apart by the absent glyph at the same lightness)", () => {
    for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
      const gap = scheme.fillStyleFor(ord("-"));
      expect(scheme.trailingStyle).not.toBe(gap); // a different value, even if near the gap's lightness
    }
  });

  it("is PERCEPTIBLY darker than the background, not merely ≠ it", () => {
    // The earlier `!== background` passed at an invisible Δ9 (241 vs 250) — inequality
    // is not perceptibility. Require a real luminance gap so padding can't silently
    // shrink back into "looks like empty space beyond the alignment".
    for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
      expect(greyOf(scheme.background) - greyOf(scheme.trailingStyle)).toBeGreaterThanOrEqual(12);
    }
  });

  it("defaults when a custom spec omits `trailing`", () => {
    const s = makeScheme({ id: "t", label: "T", residues: {}, gap: [1, 1, 1], fallback: [2, 2, 2] });
    expect(s.trailingStyle).toBe("rgb(230, 230, 230)");
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

describe("coloring fills (muted / accent)", () => {
  it("every built-in exposes a muted (faded) and an accent (uniform-highlight) fill", () => {
    for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
      expect(scheme.mutedStyle).toBe("rgb(224, 224, 224)");
      expect(scheme.accentStyle).toBe("rgb(173, 216, 230)");
    }
  });

  it("the muted fill is distinct from gap and trailing (a faded residue ≠ a gap)", () => {
    const gap = VIVID_SCHEME.fillStyleFor(ord("-"));
    expect(VIVID_SCHEME.mutedStyle).not.toBe(gap);
    expect(VIVID_SCHEME.mutedStyle).not.toBe(VIVID_SCHEME.trailingStyle);
  });

  it("honors explicit muted / accent overrides", () => {
    const s = makeScheme({
      id: "m",
      label: "M",
      residues: {},
      gap: [1, 1, 1],
      fallback: [2, 2, 2],
      muted: [3, 3, 3],
      accent: [4, 5, 6],
    });
    expect(s.mutedStyle).toBe("rgb(3, 3, 3)");
    expect(s.accentStyle).toBe("rgb(4, 5, 6)");
  });
});

describe("protein amino-acid palette (per scheme)", () => {
  // The 20 standard amino acids. A/C/G/T reuse the scheme's nucleotide color
  // (Ala/Cys/Gly/Thr); the other 16 come from the shared `AMINO_ACID_EXTRA` table.
  const AMINO = "ACDEFGHIKLMNPQRSTVWY".split("");
  // The 16 amino-only letters we introduce here (A/C/G/T are excluded: they inherit
  // each scheme's pre-existing nucleotide color, some of which are legitimately
  // darker than our new-color floor — e.g. classic T-red, colorblind A-green).
  const AMINO_EXTRA = "DEFHIKLMNPQRSVWY".split("");
  // rgb() → [r,g,b]; luma is Rec.601 (matches the glyph-legibility floor we design to).
  const rgb = (css: string): [number, number, number] => {
    const m = css.match(/\d+/g)!;
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  };
  const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;
  const distSq = (a: number[], b: number[]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // Floor = the darkest nucleotide fill we already ship (vivid T-red, luma ≈105.7):
  // any amino color at least this light keeps the always-black glyph legible.
  const LUMA_FLOOR = 105;
  // Every amino pair must be clearly separated; the palette was optimized to ≈64,
  // so 40 is a comfortable guard that still catches a real collision.
  const MIN_DIST = 40;

  for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
    it(`[${scheme.id}] colors every new amino acid legibly for black glyphs`, () => {
      for (const ch of AMINO_EXTRA) {
        const c = rgb(scheme.fillStyleFor(ord(ch)));
        expect(luma(c)).toBeGreaterThanOrEqual(LUMA_FLOOR);
      }
    });

    it(`[${scheme.id}] gives every amino acid a distinct color`, () => {
      const fills = AMINO.map((ch) => rgb(scheme.fillStyleFor(ord(ch))));
      for (let i = 0; i < fills.length; i++) {
        for (let j = i + 1; j < fills.length; j++) {
          expect(distSq(fills[i], fills[j])).toBeGreaterThanOrEqual(MIN_DIST * MIN_DIST);
        }
      }
    });
  }

  it("colors a standard amino acid that is not a nucleotide (regression: not grey fallback)", () => {
    // D (Asp), W (Trp) are amino-acid-only letters — previously grey fallback.
    for (const scheme of [VIVID_SCHEME, CLASSIC_SCHEME, COLORBLIND_SCHEME]) {
      expect(scheme.fillStyleFor(ord("D"))).not.toBe(scheme.fillStyleFor(ord("B"))); // B = fallback
      expect(scheme.fillStyleFor(ord("W"))).not.toBe(scheme.fillStyleFor(ord("B")));
    }
  });
});

describe("schemeForAlphabet — nucleotide scoping (regression: no protein colors on DNA/RNA)", () => {
  // IUPAC nucleotide ambiguity codes the consensus track emits for variable columns.
  // All but `B` are ALSO amino one-letter codes — the exact overlap that leaked
  // protein colors into a DNA/RNA consensus before scoping (the `2e948fe` bug).
  const AMBIG = "RYSWKMDHVN".split("");

  for (const id of ["vivid", "classic", "colorblind"]) {
    const nuc = schemeForAlphabet(id, "DNA");
    const prot = schemeForAlphabet(id, "Protein");
    // `B` (Asx) is not one of the 20 amino acids, so it is the fallback grey in
    // every variant — use it as the reference "grey" without hardcoding an rgb.
    const fallback = nuc.fillStyleFor(ord("B"));

    it(`[${id}] nucleotide variant paints ambiguity codes grey, not amino colors`, () => {
      for (const ch of AMBIG) {
        expect(nuc.fillStyleFor(ord(ch))).toBe(fallback); // grey fallback
        expect(nuc.fillStyleFor(ord(ch))).not.toBe(prot.fillStyleFor(ord(ch))); // ≠ protein color
      }
    });

    it(`[${id}] protein variant still colors those letters as amino acids`, () => {
      for (const ch of AMBIG) {
        expect(prot.fillStyleFor(ord(ch))).not.toBe(fallback);
      }
    });

    it(`[${id}] RNA scopes like DNA (nucleotide), not protein`, () => {
      const rna = schemeForAlphabet(id, "RNA");
      for (const ch of AMBIG) expect(rna.fillStyleFor(ord(ch))).toBe(fallback);
    });

    it(`[${id}] A/C/G/T/U keep the same nucleotide color in both variants`, () => {
      for (const ch of "ACGTU".split("")) {
        expect(nuc.fillStyleFor(ord(ch))).toBe(prot.fillStyleFor(ord(ch)));
      }
    });
  }
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

describe("hex / rgb helpers", () => {
  it("round-trips rgb ↔ hex", () => {
    expect(rgbToHex([34, 195, 42])).toBe("#22c32a");
    expect(hexToRgb("#22c32a")).toEqual([34, 195, 42]);
    expect(hexToRgb("#FFF")).toEqual([255, 255, 255]); // 3-digit shorthand
  });

  it("parses the `rgb(r, g, b)` CSS `makeScheme` bakes", () => {
    expect(parseRgbCss("rgb(46, 144, 255)")).toEqual([46, 144, 255]);
    expect(parseRgbCss("not-a-color")).toEqual([0, 0, 0]);
  });
});

describe("autoInk — auto-contrast letter over a custom fill", () => {
  it("picks black on a light fill, white on a dark fill", () => {
    expect(autoInk([255, 255, 255])).toEqual([0, 0, 0]);
    expect(autoInk([0, 0, 0])).toEqual([255, 255, 255]);
    expect(autoInk([255, 210, 26])).toEqual([0, 0, 0]); // vivid yellow — black
    expect(autoInk([40, 40, 120])).toEqual([255, 255, 255]); // dark navy — white
  });
});

describe("schemeWithOverrides — user custom colors", () => {
  it("returns the base UNCHANGED when there are no overrides", () => {
    expect(schemeWithOverrides(VIVID_SCHEME, {})).toBe(VIVID_SCHEME);
    // an override object with no actual fill/ink is still a no-op
    expect(schemeWithOverrides(VIVID_SCHEME, { A: {} })).toBe(VIVID_SCHEME);
  });

  it("overrides a residue's fill (upper and lower byte) and keeps the base id stable per content", () => {
    const s = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [10, 20, 30] } });
    expect(s.fillStyleFor(ord("A"))).toBe("rgb(10, 20, 30)");
    expect(s.fillStyleFor(ord("a"))).toBe("rgb(10, 20, 30)"); // lowercase shares
    expect(s.fillStyleFor(ord("C"))).toBe(VIVID_SCHEME.fillStyleFor(ord("C"))); // others untouched
    // same content → same id (safe for atlas memo); different content → different id
    const same = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [10, 20, 30] } });
    expect(same.id).toBe(s.id);
    const diff = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [11, 20, 30] } });
    expect(diff.id).not.toBe(s.id);
  });

  it("gives a fresh id different from the base so glyph atlases rebuild", () => {
    const s = schemeWithOverrides(VIVID_SCHEME, { A: { ink: [255, 0, 0] } });
    expect(s.id).not.toBe(VIVID_SCHEME.id);
  });

  it("auto-contrasts the letter when a fill is overridden but no ink is set", () => {
    const dark = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [10, 10, 10] } });
    expect(dark.inkStyleFor(ord("A"))).toBe("rgb(255, 255, 255)"); // white on dark
    const light = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [240, 240, 240] } });
    expect(light.inkStyleFor(ord("A"))).toBe("rgb(0, 0, 0)"); // black on light
  });

  it("honors an explicit ink override over auto-contrast", () => {
    const s = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [10, 10, 10], ink: [255, 210, 0] } });
    expect(s.inkStyleFor(ord("A"))).toBe("rgb(255, 210, 0)");
  });

  it("leaves un-overridden residues inking solid black (built-in behavior preserved)", () => {
    const s = schemeWithOverrides(VIVID_SCHEME, { A: { fill: [10, 10, 10] } });
    expect(s.inkStyleFor(ord("C"))).toBe(GLYPH_INK);
  });
});

describe("resolveResidue — effective color for the dialog swatches", () => {
  it("reads the base color when un-overridden", () => {
    const { fill, ink } = resolveResidue(VIVID_SCHEME, {}, "A");
    expect(fill).toEqual([34, 195, 42]); // vivid green
    expect(ink).toEqual([0, 0, 0]); // base black
  });

  it("reflects a fill override with auto-contrast ink", () => {
    const { fill, ink } = resolveResidue(VIVID_SCHEME, { G: { fill: [10, 10, 10] } }, "G");
    expect(fill).toEqual([10, 10, 10]);
    expect(ink).toEqual([255, 255, 255]);
  });

  it("reflects an explicit ink override", () => {
    const { ink } = resolveResidue(VIVID_SCHEME, { G: { ink: [1, 2, 3] } }, "G");
    expect(ink).toEqual([1, 2, 3]);
  });
});
