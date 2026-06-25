// Residue color schemes for the grid. A `ColorScheme` maps a residue byte to a
// cell fill and a contrasting glyph ink, plus the grid background and the single
// color the density tier ramps with occupancy. Schemes are SELECTABLE: pick one
// by id from the registry, or build a custom one with `makeScheme` and add it via
// `registerScheme` (this is the seam for "let the user choose / customize colors").
//
// Three ship now (all nucleotide; protein schemes are later):
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
    fillStyleFor: (byte) => fill[byte & 0xff],
    inkStyleFor: (byte) => ink[byte & 0xff],
  };
}

// Shared neutrals so every scheme treats gaps / unknowns / chrome consistently.
const GAP_RGB: Rgb = [232, 232, 232]; // light grey — interior gap, present but recessive
const TRAILING_RGB: Rgb = [230, 230, 230]; // clear grey — trailing padding; ~gap lightness, well below bg (told from interior gaps by the absent `-` glyph)
const FALLBACK_RGB: Rgb = [158, 158, 158]; // medium grey — "uncertain", ≠ gap
const BG_RGB: Rgb = [250, 250, 250];
const DENSITY_RGB: Rgb = [68, 97, 122];

const neutrals = {
  gap: GAP_RGB,
  trailing: TRAILING_RGB,
  fallback: FALLBACK_RGB,
  background: BG_RGB,
  densityStyle: DENSITY_RGB,
};

/**
 * Vivid nucleotide palette — bright, saturated red / yellow / green / blue. The
 * DEFAULT: chosen for maximum on-screen pop with solid-black letters. The blue is
 * a light azure (not navy) so black glyphs stay legible on it. For a palette
 * verified distinguishable under color-vision deficiency, switch to `colorblind`.
 */
export const VIVID_SCHEME: ColorScheme = makeScheme({
  id: "vivid",
  label: "Vivid",
  residues: {
    A: [34, 195, 42], // green  #22C32A
    C: [46, 144, 255], // blue   #2E90FF — light azure, keeps black ink legible
    G: [255, 210, 26], // yellow #FFD21A
    T: [255, 42, 42], // red    #FF2A2A
    U: [255, 42, 42], // U shares T
  },
  ...neutrals,
});

/**
 * Color-vision-deficiency-safe nucleotide palette — Paul Tol's *bright*
 * qualitative scheme (green/blue/yellow/red), documented distinguishable under
 * deuteranopia/protanopia. Selectable alongside the vivid default for users who
 * need it (its hexes are unchanged — the label's promise stays true).
 */
export const COLORBLIND_SCHEME: ColorScheme = makeScheme({
  id: "colorblind",
  label: "Colorblind-safe",
  residues: {
    A: [34, 136, 51], // green   #228833
    C: [68, 119, 170], // blue    #4477AA
    G: [204, 187, 68], // yellow  #CCBB44
    T: [238, 102, 119], // red     #EE6677
    U: [238, 102, 119], // U shares T
  },
  ...neutrals,
});

/**
 * Conventional vivid nucleotide palette: A green, T/U red, C cyan, G magenta.
 * The "standard" mapping most viewers ship; offered alongside the CVD-safe
 * default so users can switch.
 */
export const CLASSIC_SCHEME: ColorScheme = makeScheme({
  id: "classic",
  label: "Classic (vivid)",
  residues: {
    A: [44, 160, 44], // green   #2CA02C
    T: [227, 26, 28], // red     #E31A1C
    U: [227, 26, 28], // U shares T
    C: [0, 188, 212], // cyan    #00BCD4
    G: [204, 46, 201], // magenta #CC2EC9
  },
  ...neutrals,
});

// Registry — the selectable set. Built-ins register at module load; callers add
// custom schemes with `registerScheme` (e.g. from a color picker in the UI).
const registry = new Map<string, ColorScheme>();
registry.set(VIVID_SCHEME.id, VIVID_SCHEME);
registry.set(COLORBLIND_SCHEME.id, COLORBLIND_SCHEME);
registry.set(CLASSIC_SCHEME.id, CLASSIC_SCHEME);

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
