// Shared layout + palette constants for the pinned grid chrome (ruler + name
// column now; the track lane and minimap reuse these next). NAME_W / RULER_H are
// the SINGLE SOURCE OF TRUTH for both the CSS grid track sizes and the canvas
// backing stores — `Grid.tsx` sets the `--name-w` / `--ruler-h` CSS vars from
// these constants, so the layout tracks and the painters can never drift apart.

/** Pinned name-column width, px (fixed in M2; derive-from-longest-name later). */
export const NAME_W = 140;
/** Pinned column-ruler height, px. */
export const RULER_H = 22;
/** Pinned track-lane height, px. Laid out + scroll-synced now; M4 fills it with
 *  the consensus row / conservation track. Empty in M2 (the painter draws only
 *  the chrome background + a separator — no data). Slim so the empty band reads as
 *  reserved chrome, not wasted space. */
export const TRACK_H = 18;
/** Whole-alignment minimap strip height, px (sits below the grid, above the
 *  status bar; spans the full shell width). */
export const MINIMAP_H = 56;
/** Left text inset in the name column, px. */
export const NAME_PAD = 8;

/** Minimum horizontal px between ruler labels — the nice-step thinning keeps
 *  labels at least this far apart so multi-digit column numbers never collide. */
export const MIN_LABEL_PX = 48;

/** Chrome palette — harmonized with the (light) default grid background. Fixed in
 *  M2; a later pass can derive it from the active `ColorScheme`. */
export interface ChromePalette {
  readonly bg: string;
  readonly ink: string;
  readonly line: string;
}

export const CHROME: ChromePalette = {
  bg: "#eef0f2",
  ink: "#33373b",
  line: "#cdd2d6",
};
