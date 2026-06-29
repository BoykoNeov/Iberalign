// Color resolvers for the Phase-4 coloring modes — pure functions that turn a
// `ColoringConfig` mode + the per-column derived arrays (consensus bytes,
// conserved mask) into a fill lookup the draw loop calls per cell. Kept here (not
// in the renderers) so they're exercisable without a canvas, the same discipline
// as `runs.ts` and `colors.ts`. No per-cell allocation: every branch returns a
// precomputed CSS string from the scheme's baked tables.

import { type ColorScheme } from "./colors";
import { type GridColoring, type TrackColoring, type HighlightStyle } from "../model/coloring";
import { isGap } from "../model/coords";
import { toUpperByte } from "../model/profile";

/**
 * Build the main-grid fill resolver `(byte, col) => css` for `mode`. The column is
 * the ABSOLUTE alignment column (so it indexes `cons` / `mask`, both length =
 * view.width). Gaps always keep their gap color (a gap reads as a gap in every
 * mode); the trailing-pad tail is drawn separately by the renderer and never
 * reaches here. For the consensus-comparison and by-conservation modes the
 * HIGHLIGHTED side renders either per-residue (`residue`) or as one flat accent
 * (`uniform`), and the other side fades to the scheme's muted grey.
 *
 * `cons` is required for match/mismatch-consensus, `mask` for by-conservation; if
 * the needed array is missing the resolver falls back to plain by-residue (a safe
 * no-op rather than a crash — the renderer always supplies it in practice).
 */
export function makeGridStyleFor(
  mode: GridColoring,
  scheme: ColorScheme,
  highlight: HighlightStyle,
  cons: Uint8Array | null,
  mask: Uint8Array | null,
): (byte: number, col: number) => string {
  const byResidue = (byte: number) => scheme.fillStyleFor(byte);
  if (mode === "by-residue") return byResidue;

  // The highlighted side: the residue's own color, or one flat accent.
  const hi = highlight === "uniform" ? () => scheme.accentStyle : byResidue;
  const lo = scheme.mutedStyle; // the faded side

  if (mode === "by-conservation") {
    if (!mask) return byResidue;
    return (byte, col) => (isGap(byte) ? byResidue(byte) : mask[col] ? hi(byte) : lo);
  }

  // match-consensus / mismatch-consensus.
  if (!cons) return byResidue;
  const wantMatch = mode === "match-consensus";
  return (byte, col) => {
    if (isGap(byte)) return byResidue(byte);
    const matches = toUpperByte(byte) === cons[col];
    return matches === wantMatch ? hi(byte) : lo;
  };
}

/**
 * The consensus-track cell fill for one column under `mode`. `neutral` is the
 * chrome background the lane clears to (passed in so this stays render-chrome
 * agnostic); `conserved` is the column's bit from the shared conserved mask
 * (ignored by `full`/`none`). `full` colors every cell by its consensus byte;
 * `none` is glyph-only; `consensus-only` colors only conserved columns;
 * `nonconsensus-only` colors only the variable ones.
 */
export function trackFillFor(
  mode: TrackColoring,
  scheme: ColorScheme,
  neutral: string,
  consByte: number,
  conserved: boolean,
): string {
  switch (mode) {
    case "full":
      return scheme.fillStyleFor(consByte);
    case "none":
      return neutral;
    case "consensus-only":
      return conserved ? scheme.fillStyleFor(consByte) : neutral;
    case "nonconsensus-only":
      return conserved ? neutral : scheme.fillStyleFor(consByte);
  }
}
