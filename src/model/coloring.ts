// Coloring configuration for the consensus track and the main grid, plus the pure
// per-column "is this column conserved?" derivation both share. The actual COLORS
// live in the render layer (`colors.ts` schemes + the renderers); this module is
// pure model — it decides WHICH columns/cells are highlighted, never what shade.
// Everything is derived off the shared `ColumnProfiles` (see `profile.ts`), the
// same backbone the consensus bytes come from, so a column's conservation is
// computed once per (view, config) and reused by both renderers (see `ColumnData`).

import type { ColumnProfiles } from "./profile";

/** Consensus-track coloring mode.
 *  - `full` — color every consensus cell by its byte (today's behavior).
 *  - `none` — glyph only, on a neutral chrome fill (no per-byte color).
 *  - `consensus-only` — color only CONSERVED columns; the rest draw neutral.
 *  - `nonconsensus-only` — color only VARIABLE columns; conserved draw neutral.
 *  "Conserved" = the column's top-residue fraction meets `conservationThreshold`
 *  (see `conservedColumns`) — the SAME notion the grid's by-conservation uses. */
export type TrackColoring = "full" | "none" | "consensus-only" | "nonconsensus-only";

/** Main-grid coloring mode.
 *  - `by-residue` — today's per-residue palette.
 *  - `by-conservation` — keep the residue color in CONSERVED columns, fade the
 *    rest to grey (a custom-% highlight, request #8).
 *  - `match-consensus` — highlight cells EQUAL to their column's consensus byte;
 *    fade the rest.
 *  - `mismatch-consensus` — highlight cells that DIFFER from the consensus (the
 *    "show me the variants" view); fade the matches. */
export type GridColoring = "by-residue" | "by-conservation" | "match-consensus" | "mismatch-consensus";

/** Denominator for a column's conservation fraction.
 *  - `all-rows` — divide the top residue's count by EVERY row, so gaps dilute
 *    conservation (a half-gap column never reads as fully conserved).
 *  - `non-gap` — divide by the non-gap rows only, so conservation measures
 *    agreement among the residues actually present (gaps don't count against it).
 *  Both are offered (user, 2026-06-29); the choice changes what a given threshold
 *  percentage means. */
export type ConservationDenominator = "all-rows" | "non-gap";

/** How a HIGHLIGHTED cell renders in the consensus-comparison / by-conservation
 *  grid modes.
 *  - `residue` — keep the per-residue palette color (A green, C blue…), so the
 *    residue identity stays readable.
 *  - `uniform` — paint one flat highlight color (residue identity lost, flatter).
 *  The non-highlighted cells fade to grey either way. Both offered (user). */
export type HighlightStyle = "residue" | "uniform";

/** Coloring pipeline configuration. Track mode and grid mode are independent; the
 *  conservation threshold/denominator and the highlight style are shared inputs the
 *  relevant modes read (see `coloringControlsEnabled` for which mode reads what). */
export interface ColoringConfig {
  /** Consensus-track coloring mode. */
  track: TrackColoring;
  /** Main-grid coloring mode. */
  grid: GridColoring;
  /** Fraction in `[0, 1]`. A column is "conserved" iff its top-residue fraction is
   *  `≥` this (integer-exact, see `conservedColumns`). Shared by the grid's
   *  by-conservation mode AND the track's consensus-only / nonconsensus-only. */
  conservationThreshold: number;
  /** Denominator for that fraction (see `ConservationDenominator`). */
  conservationDenominator: ConservationDenominator;
  /** How highlighted cells render in the consensus-comparison / conservation grid
   *  modes (see `HighlightStyle`). */
  highlightStyle: HighlightStyle;
}

/** Default coloring: today's look — per-residue grid, fully-colored track. The
 *  conservation controls carry sensible defaults (≥50%, gaps dilute, residue
 *  palette) for when the user switches into a conservation/consensus mode. */
export const DEFAULT_COLORING: ColoringConfig = {
  track: "full",
  grid: "by-residue",
  conservationThreshold: 0.5,
  conservationDenominator: "all-rows",
  highlightStyle: "residue",
};

// Conservation threshold granularity — an integer-exact `≥` so a "50%" cutoff has
// a predictable boundary (fp `topCount/denom ≥ threshold` mis-rounds, the same trap
// `consensus.ts` avoids for the majority rule). 0.1% is finer than any % UI needs.
// NB conservation uses an INCLUSIVE `≥` ("at least X% conserved"), distinct from the
// consensus majority rule's exclusive `>` — a deliberate, more-inclusive notion.
const CONSERVATION_SCALE = 1000;

/**
 * Per-column "is this column conserved?" mask (`1` = conserved, `0` = not), length
 * `profiles.width`. A column is conserved iff its top-residue fraction meets
 * `threshold` under `denominator`. An all-gap column (no residues) is NEVER
 * conserved, regardless of threshold. Pure; the caller caches (see `ColumnData`).
 */
export function conservedColumns(
  profiles: ColumnProfiles,
  threshold: number,
  denominator: ConservationDenominator,
): Uint8Array {
  const { width, nonGap, gap, topCount } = profiles;
  const out = new Uint8Array(width);
  const thr = Math.round(threshold * CONSERVATION_SCALE);
  for (let c = 0; c < width; c++) {
    const ng = nonGap[c];
    if (ng === 0) continue; // all-gap column → no residues → never conserved
    const denom = denominator === "non-gap" ? ng : ng + gap[c];
    // conserved iff topCount / denom ≥ threshold, compared integer-exactly.
    if (topCount[c] * CONSERVATION_SCALE >= thr * denom) out[c] = 1;
  }
  return out;
}

/** Which optional sub-controls a coloring config actually consults — the dialog
 *  disables (not hides) the rest so an irrelevant toggle can't read as active.
 *  Mirrors what the renderers read for each mode. */
export interface ColoringControlsEnabled {
  /** The conservation threshold/denominator drive by-conservation (grid) and the
   *  consensus-only / nonconsensus-only track modes. */
  conservation: boolean;
  /** The highlight style applies to the three non-`by-residue` grid modes (the
   *  ones with a highlighted vs faded split). */
  highlightStyle: boolean;
}

/** The set of coloring sub-controls the current `track`/`grid` modes consult. Pure;
 *  the dialog drives its disabled states from this so they can't drift from the
 *  renderers. */
export function coloringControlsEnabled(config: ColoringConfig): ColoringControlsEnabled {
  const trackUsesConservation =
    config.track === "consensus-only" || config.track === "nonconsensus-only";
  const gridUsesConservation = config.grid === "by-conservation";
  return {
    conservation: trackUsesConservation || gridUsesConservation,
    highlightStyle: config.grid !== "by-residue",
  };
}
