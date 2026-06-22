// Level-of-detail tiers, chosen by cell size (CSS px). The renderer draws a
// different representation per tier so it stays legible and fast across the full
// zoom range (spec §12):
//   - `letter`  — cell fill + the residue glyph (atlas-blitted). Only legible
//     when the cell is big enough for a readable glyph.
//   - `block`   — cell fill only; too small for a glyph but still per-cell color.
//   - `density` — below per-cell resolution: draw an aggregate strip
//     (occupancy / gap density / averaged color), never one cell each.
//
// Pure and tiny so the thresholds are unit-pinned; `Canvas2DRenderer` switches
// on the result.

export type Lod = "letter" | "block" | "density";

/** Cell-size thresholds in CSS px (inclusive lower bounds). */
export const LETTER_MIN_PX = 8;
export const BLOCK_MIN_PX = 3;

export function lodFor(cellPx: number): Lod {
  if (cellPx >= LETTER_MIN_PX) return "letter";
  if (cellPx >= BLOCK_MIN_PX) return "block";
  return "density";
}
