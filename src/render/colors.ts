// Residue color schemes for the grid. A `ColorScheme` maps a residue byte to a
// cell fill and a contrasting glyph ink, plus the grid background and the single
// color the density tier ramps with occupancy. Schemes are SELECTABLE: pick one
// by id from the registry, or build a custom one with `makeScheme` and add it via
// `registerScheme` (this is the seam for "let the user choose / customize colors").
//
// Three ship now. Each carries the same shared 20-color amino-acid palette (see
// `AMINO_ACID_EXTRA`) so PROTEIN alignments get a distinct color per residue; the
// nucleotide A/C/G/T/U colors below win the merge, so DNA/RNA rendering is
// unchanged. The schemes differ in their nucleotide (and thus overall) look:
//   - `vivid` (DEFAULT) — bright, saturated red/yellow/green/blue for maximum
//     on-screen pop, paired with solid-black letters. The blue is a light azure
//     (not navy) so black glyphs stay legible on it.
//   - `colorblind` — Paul Tol's *bright* qualitative palette, published as
//     color-vision-deficiency safe; selectable for users who need it. (A CVD-
//     simulator pass is still the right final QA check — these hexes are chosen
//     from a documented-safe set, not eyeballed here.)
//   - `classic` — the conventional mapping: A green, T/U red, C cyan, G magenta.
//
// Every scheme inks residue glyphs solid black (see `GLYPH_INK`) — one ink reads
// as a single alphabet rather than flickering light/dark per residue.
//
// Lookups are O(1): `makeScheme` precomputes 256-entry CSS tables, so the hot
// draw path never parses a color. Case-insensitive (lowercase residues share
// their uppercase color); `-` and `.` are gaps.

/** An sRGB color as 0..255 channels. */
export type Rgb = readonly [number, number, number];

const GAP_HYPHEN = 0x2d; // '-'
const GAP_DOT = 0x2e; // '.'

/** Residue glyph ink — solid black for every residue in every scheme. With the
 *  vivid fills (and even the muted colorblind-safe ones) black stays legible, and
 *  a single ink keeps the letters reading as one alphabet. Scoped to residue
 *  glyphs only: ruler / name-column chrome text keeps its own colors. */
export const GLYPH_INK = "#000000";

export interface ColorScheme {
  readonly id: string;
  readonly label: string;
  /** Grid clear / background color (also shows through low-occupancy density). */
  readonly background: string;
  /** Solid color for density-tier occupancy bars; per-column occupancy is the
   *  alpha, so a fully-gapped column fades to the background. */
  readonly densityStyle: string;
  /** Cell fill for TRAILING gap padding (the run of gaps past a row's last residue).
   *  A clear grey — distinctly darker than the background so padding reads as "ragged
   *  right / no data here" rather than as empty space beyond the alignment. It sits at
   *  ~interior-gap lightness; the two are told apart by the GLYPH (interior gaps draw a
   *  `-`, trailing cells draw none) rather than by color, which leaves room for the
   *  background separation the eye actually needs. */
  readonly trailingStyle: string;
  /** Fill for a DE-EMPHASIZED (faded) residue cell in the consensus-comparison /
   *  by-conservation grid colorings — the "not highlighted" side. A light grey,
   *  recessive but lighter than the medium fallback; the black glyph still reads,
   *  so a faded residue stays identifiable (and is told from a real gap by the
   *  glyph: a faded residue keeps its letter, a gap shows `-`). */
  readonly mutedStyle: string;
  /** Single flat fill for a HIGHLIGHTED cell under the `uniform` highlight style
   *  (when the user opts out of per-residue color for the highlighted side). Light
   *  enough that the black glyph stays legible. */
  readonly accentStyle: string;
  /** Cell fill (CSS color) for a residue byte. Case-insensitive; gaps and
   *  unknown residues map to the scheme's gap / fallback color. */
  fillStyleFor(byte: number): string;
  /** Glyph ink (CSS color) contrasting *this residue's own* fill. */
  inkStyleFor(byte: number): string;
}

/** A scheme definition; `makeScheme` bakes it into fast lookup tables. */
export interface SchemeSpec {
  id: string;
  label: string;
  /** Per-residue colors keyed by UPPERCASE residue letter (e.g. `"A"`). */
  residues: Record<string, Rgb>;
  /** Fill for `-` / `.` gap bytes. */
  gap: Rgb;
  /** Fill for trailing gap padding (default: a clear grey, well below the background). */
  trailing?: Rgb;
  /** Fill for a faded (de-emphasized) residue in the coloring modes (default: a
   *  light grey, lighter than `fallback`). */
  muted?: Rgb;
  /** Flat fill for a highlighted cell under the `uniform` highlight style (default:
   *  a light blue). */
  accent?: Rgb;
  /** Fill for residues not in `residues` (ambiguity codes, `*`, unknown). */
  fallback: Rgb;
  /** Grid background (default near-white). */
  background?: Rgb;
  /** Density occupancy bar color (default slate). */
  densityStyle?: Rgb;
}

function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** ASCII-uppercase a byte (`a`..`z` → `A`..`Z`); other bytes pass through. */
function toUpperByte(byte: number): number {
  return byte >= 0x61 && byte <= 0x7a ? byte - 0x20 : byte;
}

/**
 * Bake a `SchemeSpec` into a `ColorScheme` with 256-entry fill/ink tables. The
 * returned accessors are pure array reads — safe to call per cell in the draw
 * loop.
 */
export function makeScheme(spec: SchemeSpec): ColorScheme {
  const fill = new Array<string>(256);
  const ink = new Array<string>(256);
  for (let b = 0; b < 256; b++) {
    let rgb: Rgb;
    if (b === GAP_HYPHEN || b === GAP_DOT) {
      rgb = spec.gap;
    } else {
      const ch = String.fromCharCode(toUpperByte(b));
      rgb = spec.residues[ch] ?? spec.fallback;
    }
    fill[b] = rgbCss(rgb);
    ink[b] = GLYPH_INK;
  }
  return {
    id: spec.id,
    label: spec.label,
    background: rgbCss(spec.background ?? [250, 250, 250]),
    densityStyle: rgbCss(spec.densityStyle ?? [68, 97, 122]),
    trailingStyle: rgbCss(spec.trailing ?? [230, 230, 230]),
    mutedStyle: rgbCss(spec.muted ?? [224, 224, 224]),
    accentStyle: rgbCss(spec.accent ?? [173, 216, 230]),
    fillStyleFor: (byte) => fill[byte & 0xff],
    inkStyleFor: (byte) => ink[byte & 0xff],
  };
}

// Shared neutrals so every scheme treats gaps / unknowns / chrome consistently.
const GAP_RGB: Rgb = [232, 232, 232]; // light grey — interior gap, present but recessive
const TRAILING_RGB: Rgb = [230, 230, 230]; // clear grey — trailing padding; ~gap lightness, well below bg (told from interior gaps by the absent `-` glyph)
const MUTED_RGB: Rgb = [224, 224, 224]; // light grey — a faded (de-emphasized) residue in the coloring modes; black glyph still reads
const ACCENT_RGB: Rgb = [173, 216, 230]; // light blue — the uniform-highlight fill; light enough for black glyphs
const FALLBACK_RGB: Rgb = [158, 158, 158]; // medium grey — "uncertain", ≠ gap
const BG_RGB: Rgb = [250, 250, 250];
const DENSITY_RGB: Rgb = [68, 97, 122];

const neutrals = {
  gap: GAP_RGB,
  trailing: TRAILING_RGB,
  muted: MUTED_RGB,
  accent: ACCENT_RGB,
  fallback: FALLBACK_RGB,
  background: BG_RGB,
  densityStyle: DENSITY_RGB,
};

/**
 * Per-residue colors for the 16 standard amino acids that are NOT also nucleotide
 * letters. A/C/G/T/U keep each scheme's *nucleotide* color (Ala/Cys/Gly/Thr share
 * those letters — "keep the letters that already have one"); this table colors the
 * rest, so a PROTEIN alignment gets a distinct color for every amino acid instead
 * of a sea of grey `fallback`. DNA/RNA sequences never contain these letters, so
 * merging this in leaves nucleotide rendering byte-for-byte unchanged.
 *
 * The palette is a single shared table spread into every scheme (nucleotide colors
 * win the merge). Values were machine-optimized (hill-climb) for two properties,
 * pinned by `colors.test.ts`:
 *   - black-glyph legibility: every fill's luma ≥ the darkest nucleotide we ship
 *     (T-red ≈106), so the always-black `GLYPH_INK` stays readable;
 *   - distinctness: within EACH scheme the full ~20-letter set is pairwise well
 *     separated (min RGB distance ≈64, checked against every scheme's nucleotide
 *     colors — incl. classic's magenta G and colorblind's muted set).
 *
 * NB per-letter distinctness is what the user asked for; it is NOT the same goal as
 * CVD-safety. 20 colors cannot all be color-vision-deficiency-distinct — see the
 * `colorblind` scheme note. This is a known, unavoidable limit of any 20-color
 * per-residue protein palette.
 */
const AMINO_ACID_EXTRA: Record<string, Rgb> = {
  D: [209, 123, 66], // Asp — orange-brown
  E: [236, 131, 7], // Glu — orange
  F: [234, 243, 132], // Phe — pale lime
  H: [101, 222, 30], // His — green
  I: [167, 233, 151], // Ile — light green
  K: [160, 246, 213], // Lys — mint
  L: [36, 191, 153], // Leu — teal
  M: [22, 244, 233], // Met — cyan
  N: [100, 146, 218], // Asn — blue
  P: [154, 161, 252], // Pro — periwinkle
  Q: [129, 83, 228], // Gln — indigo
  R: [222, 164, 240], // Arg — light violet
  S: [196, 108, 223], // Ser — purple
  V: [253, 77, 228], // Val — magenta
  W: [249, 44, 152], // Trp — pink
  Y: [239, 153, 173], // Tyr — rose
};

/**
 * Bake a scheme's two ALPHABET-SCOPED variants from its nucleotide palette. The
 * `protein` variant merges the shared 20-color amino palette (nucleotide colors
 * still win the merge); the `nucleotide` variant OMITS it, so a byte that is a
 * nucleotide IUPAC AMBIGUITY code (`R Y S W K M B D H V N` — all but `B` are also
 * amino one-letter codes) falls through to the grey `fallback` instead of taking a
 * PROTEIN color. This matters because the consensus track emits those ambiguity
 * codes for variable DNA/RNA columns; without scoping they'd render in amino colors
 * (the bug). `Grid` picks the variant by the loaded alphabet via `schemeForAlphabet`.
 * Both variants share the same public `id`: the glyph atlas keys on it, but glyph
 * inks are the uniform `GLYPH_INK` in BOTH variants (only fills differ), so the
 * shared id never mis-caches a glyph.
 */
function makeSchemeVariants(
  id: string,
  label: string,
  nuc: Record<string, Rgb>,
): { protein: ColorScheme; nucleotide: ColorScheme } {
  return {
    protein: makeScheme({ id, label, residues: { ...AMINO_ACID_EXTRA, ...nuc }, ...neutrals }),
    nucleotide: makeScheme({ id, label, residues: { ...nuc }, ...neutrals }),
  };
}

/**
 * Vivid nucleotide palette — bright, saturated red / yellow / green / blue. The
 * DEFAULT: chosen for maximum on-screen pop with solid-black letters. The blue is
 * a light azure (not navy) so black glyphs stay legible on it. For a palette
 * verified distinguishable under color-vision deficiency, switch to `colorblind`.
 */
const VIVID_NUC: Record<string, Rgb> = {
  A: [34, 195, 42], // green  #22C32A
  C: [46, 144, 255], // blue   #2E90FF — light azure, keeps black ink legible
  G: [255, 210, 26], // yellow #FFD21A
  T: [255, 42, 42], // red    #FF2A2A
  U: [255, 42, 42], // U shares T
};
const VIVID = makeSchemeVariants("vivid", "Vivid", VIVID_NUC);
/** The full (protein-inclusive) vivid scheme — the app default. `schemeForAlphabet`
 *  serves the nucleotide-scoped variant for DNA/RNA. */
export const VIVID_SCHEME: ColorScheme = VIVID.protein;

/**
 * Color-vision-deficiency-safe nucleotide palette — Paul Tol's *bright*
 * qualitative scheme (green/blue/yellow/red), documented distinguishable under
 * deuteranopia/protanopia. Selectable alongside the vivid default for users who
 * need it — the NUCLEOTIDE hexes are unchanged, so the label's promise holds for
 * DNA/RNA. CAVEAT: for PROTEIN it falls back to the shared 20-color amino palette,
 * which cannot be CVD-distinct (no 20-color set is) — the amino colors are chosen
 * for per-letter distinctness under normal vision, not CVD-safety.
 */
const COLORBLIND_NUC: Record<string, Rgb> = {
  A: [34, 136, 51], // green   #228833
  C: [68, 119, 170], // blue    #4477AA
  G: [204, 187, 68], // yellow  #CCBB44
  T: [238, 102, 119], // red     #EE6677
  U: [238, 102, 119], // U shares T
};
const COLORBLIND = makeSchemeVariants("colorblind", "Colorblind-safe", COLORBLIND_NUC);
export const COLORBLIND_SCHEME: ColorScheme = COLORBLIND.protein;

/**
 * Conventional vivid nucleotide palette: A green, T/U red, C cyan, G magenta.
 * The "standard" mapping most viewers ship; offered alongside the CVD-safe
 * default so users can switch.
 */
const CLASSIC_NUC: Record<string, Rgb> = {
  A: [44, 160, 44], // green   #2CA02C
  T: [227, 26, 28], // red     #E31A1C
  U: [227, 26, 28], // U shares T
  C: [0, 188, 212], // cyan    #00BCD4
  G: [204, 46, 201], // magenta #CC2EC9
};
const CLASSIC = makeSchemeVariants("classic", "Classic (vivid)", CLASSIC_NUC);
export const CLASSIC_SCHEME: ColorScheme = CLASSIC.protein;

// Registry — the selectable set. Built-ins register at module load; callers add
// custom schemes with `registerScheme` (e.g. from a color picker in the UI). Each
// built-in has TWO baked variants (see `makeSchemeVariants`): the full protein one
// lives in `registry` (what the dialog lists + `getScheme` returns); the
// nucleotide-scoped one lives in `nucRegistry`, served to DNA/RNA views by
// `schemeForAlphabet` so IUPAC ambiguity codes don't take amino colors.
const registry = new Map<string, ColorScheme>();
const nucRegistry = new Map<string, ColorScheme>();
for (const v of [VIVID, COLORBLIND, CLASSIC]) {
  registry.set(v.protein.id, v.protein);
  nucRegistry.set(v.nucleotide.id, v.nucleotide);
}

/** Id of the scheme used when none is chosen / an unknown id is requested. */
export const DEFAULT_SCHEME_ID = VIVID_SCHEME.id;

/** Register (or replace) a scheme so it appears in `listSchemes` and `getScheme`. */
export function registerScheme(scheme: ColorScheme): ColorScheme {
  registry.set(scheme.id, scheme);
  return scheme;
}

/** Look up a scheme by id, falling back to the default for an unknown id. */
export function getScheme(id: string): ColorScheme {
  return registry.get(id) ?? VIVID_SCHEME;
}

/** All registered schemes, in registration order — for a scheme selector. */
export function listSchemes(): ColorScheme[] {
  return [...registry.values()];
}

/** The default scheme (vivid). */
export function defaultScheme(): ColorScheme {
  return VIVID_SCHEME;
}

/**
 * The alphabet-SCOPED base scheme for `id` — the seam that keeps a DNA/RNA
 * consensus's IUPAC ambiguity codes (`R Y S W K M …`) from rendering in PROTEIN
 * colors. DNA/RNA (any non-`"Protein"` alphabet) get the nucleotide-only variant,
 * where those codes fall through to the grey `fallback`; `"Protein"` gets the full
 * 20-amino variant. Falls back to the default scheme for an unknown id, like
 * `getScheme`. `Grid` calls this (not `getScheme`) when building the effective
 * scheme it pushes to the renderers.
 */
export function schemeForAlphabet(id: string, alphabet: string): ColorScheme {
  if (alphabet === "Protein") return registry.get(id) ?? VIVID_SCHEME;
  return nucRegistry.get(id) ?? registry.get(id) ?? VIVID.nucleotide;
}

// ---------------------------------------------------------------------------
// Custom per-residue overrides (the "let the user choose custom colors" seam).
//
// A user palette is a base scheme + per-residue OVERRIDES: for any residue the
// user can set its cell FILL and/or its letter INK. `schemeWithOverrides` bakes a
// base `ColorScheme` + overrides into a fresh scheme (returns the base untouched
// when there are no overrides, so an un-customized alphabet renders byte-for-byte
// like the built-in). Grid keeps a separate override set per alphabet class (DNA /
// RNA / Protein) — see `Grid.tsx`; this module is the pure color math.
// ---------------------------------------------------------------------------

/** A per-residue color override. Either field may be set independently: `fill`
 *  recolors the cell, `ink` recolors the letter. An absent field falls back (fill →
 *  the base scheme's color; ink → auto-contrast over the effective fill). */
export interface ResidueOverride {
  fill?: Rgb;
  ink?: Rgb;
}

/** Per-residue overrides for one palette, keyed by UPPERCASE residue letter
 *  (`"A"`, `"K"`, …). Lowercase bytes share their uppercase letter's override. */
export type PaletteOverrides = Record<string, ResidueOverride>;

/** Rec.601 luma of an sRGB color, 0..255. The same weighting the built-in palette's
 *  glyph-legibility floor uses. */
export function luma([r, g, b]: Rgb): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const BLACK_INK: Rgb = [0, 0, 0];
const WHITE_INK: Rgb = [255, 255, 255];

/** Auto-contrast letter ink for a cell fill: black on a light fill, white on a dark
 *  one, so a user-chosen color keeps a legible letter without the user having to also
 *  pick an ink. The cutoff (luma ≥ 140) sits a touch above mid. NB this only applies
 *  to CUSTOM fills — the built-in schemes' own colors keep their designed black ink
 *  (they bypass `autoInk`), so a mid-luma built-in fill is unaffected by this cutoff. */
export function autoInk(fill: Rgb): Rgb {
  return luma(fill) >= 140 ? BLACK_INK : WHITE_INK;
}

/** `[r,g,b]` → `#rrggbb` (for an `<input type="color">` value). */
export function rgbToHex([r, g, b]: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** `#rgb` / `#rrggbb` → `[r,g,b]`. Unparseable input → black (a safe default; the
 *  native color input only ever emits `#rrggbb`). */
export function hexToRgb(hex: string): Rgb {
  const s = hex.trim().replace(/^#/, "");
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return [r, g, b];
  }
  if (s.length === 6) {
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  return [0, 0, 0];
}

/** Parse a `rgb(r, g, b)` CSS string (what `makeScheme` bakes) back to `[r,g,b]`.
 *  Used to read a base scheme's effective color for a residue when building the
 *  Colors dialog swatches. Non-matching input → black. */
export function parseRgbCss(css: string): Rgb {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** Uppercase-letter byte for a residue char (`"a"`→`0x41`, `"A"`→`0x41`). */
function upperByteOf(ch: string): number {
  return toUpperByte(ch.charCodeAt(0));
}

/**
 * The EFFECTIVE cell fill + letter ink for one residue under `base` + `overrides`,
 * as `Rgb` (for the dialog swatches). Fill = the override's fill, else the base
 * scheme's color. Ink = the override's ink, else — when the FILL was overridden —
 * auto-contrast over that fill, else the base scheme's ink (black for the built-ins).
 */
export function resolveResidue(
  base: ColorScheme,
  overrides: PaletteOverrides,
  ch: string,
): { fill: Rgb; ink: Rgb } {
  const byte = upperByteOf(ch);
  const ov = overrides[String.fromCharCode(byte)];
  const fill = ov?.fill ?? parseRgbCss(base.fillStyleFor(byte));
  let ink: Rgb;
  if (ov?.ink) ink = ov.ink;
  else if (ov?.fill) ink = autoInk(ov.fill);
  else ink = parseRgbCss(base.inkStyleFor(byte));
  return { fill, ink };
}

/** Stable djb2 hash of the overrides, so a scheme's id changes iff its colors do
 *  (glyph atlases key their re-ink on `scheme.id`). Keys sorted for determinism. */
function hashOverrides(overrides: PaletteOverrides): string {
  const parts: string[] = [];
  for (const key of Object.keys(overrides).sort()) {
    const o = overrides[key];
    parts.push(`${key}:${o.fill ? o.fill.join(",") : "-"}/${o.ink ? o.ink.join(",") : "-"}`);
  }
  const s = parts.join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Bake a base scheme + per-residue overrides into a fresh `ColorScheme`. Returns
 * `base` UNCHANGED when there are no overrides (so an un-customized alphabet is
 * byte-identical to the built-in). Otherwise builds new 256-entry fill/ink tables:
 * a residue's fill/ink is its override, falling back to the base; an overridden fill
 * with no ink override takes auto-contrast ink. The id embeds a content hash so the
 * grid/track glyph atlases (keyed on `scheme.id`) rebuild on any color change and
 * reuse on none. Neutrals (gap/background/trailing/muted/accent/density) pass
 * through from the base.
 */
export function schemeWithOverrides(base: ColorScheme, overrides: PaletteOverrides): ColorScheme {
  const active = Object.keys(overrides).filter((k) => overrides[k].fill || overrides[k].ink);
  if (active.length === 0) return base;

  const fill = new Array<string>(256);
  const ink = new Array<string>(256);
  for (let b = 0; b < 256; b++) {
    fill[b] = base.fillStyleFor(b);
    ink[b] = base.inkStyleFor(b);
  }
  // Apply each override to BOTH the uppercase and lowercase byte of the residue
  // (lowercase residues share their uppercase color, matching `makeScheme`).
  for (const key of active) {
    const upper = upperByteOf(key);
    const lower = upper + 0x20;
    const ov = overrides[key];
    const effFill = ov.fill ?? parseRgbCss(base.fillStyleFor(upper));
    let effInk: Rgb;
    if (ov.ink) effInk = ov.ink;
    else if (ov.fill) effInk = autoInk(ov.fill);
    else effInk = parseRgbCss(base.inkStyleFor(upper));
    const fillCss = rgbCss(effFill);
    const inkCss = rgbCss(effInk);
    for (const byte of [upper, lower]) {
      if (byte < 0 || byte > 255) continue;
      fill[byte] = fillCss;
      ink[byte] = inkCss;
    }
  }
  return {
    ...base,
    id: `custom-${base.id}-${hashOverrides(overrides)}`,
    fillStyleFor: (byte) => fill[byte & 0xff],
    inkStyleFor: (byte) => ink[byte & 0xff],
  };
}

/** Residue letters shown in the Colors dialog for a given alphabet class. */
export const NUCLEOTIDE_RESIDUES: readonly string[] = ["A", "C", "G", "T", "U"];
export const AMINO_ACID_RESIDUES: readonly string[] = [
  "A", "R", "N", "D", "C", "Q", "E", "G", "H", "I",
  "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V",
];
