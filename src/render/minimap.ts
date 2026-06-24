// Minimap geometry — pure math, no DOM. The minimap is a whole-alignment overview
// strip: the entire content (cols×cellW by rows×cellH px) mapped onto a fixed
// miniW×miniH rectangle (fill-the-strip, NOT aspect-preserving — the strip is a
// fixed layout band, so the overview stretches to fill it). Two queries:
//
//   - `viewportRectInMinimap` — where the current visible window sits within the
//     strip (the "you are here" rectangle, redrawn each frame on scroll/zoom).
//   - `minimapToScroll` — inverse: a click/drag point in the strip → the scroll
//     offset that CENTERS the viewport there (for click-to-navigate).
//
// Keeping it pure makes the round-trip (scroll → rect → click its center →
// scroll) unit-testable without a canvas, a browser, or React — same discipline
// as `render/scrollbar.ts`. The minimap represents content px in its OWN space
// ([0, contentW] → [0, miniW]); it does not align to the grid's on-screen column
// positions, so the pinned name column to its left is irrelevant here.

import {
  type Dims,
  type Viewport,
  contentWidth,
  contentHeight,
} from "../state/viewport";

/** A rectangle within the minimap, CSS px (origin at the minimap's top-left). */
export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The visible window as a rectangle within a `miniW × miniH` minimap representing
 * the whole content. When the content fits an axis (small/zoomed-out alignment),
 * that axis's rect spans the full minimap extent (the viewport covers everything).
 * The rect is always fully inside the minimap (x/y clamped so a near-edge scroll
 * doesn't push it out).
 */
export function viewportRectInMinimap(
  vp: Viewport,
  dims: Dims,
  miniW: number,
  miniH: number,
): MinimapRect {
  const contentW = contentWidth(vp, dims);
  const contentH = contentHeight(vp, dims);
  if (contentW <= 0 || contentH <= 0 || miniW <= 0 || miniH <= 0) {
    return { x: 0, y: 0, w: miniW, h: miniH };
  }
  const sx = miniW / contentW;
  const sy = miniH / contentH;
  const w = clamp(vp.viewW * sx, 0, miniW);
  const h = clamp(vp.viewH * sy, 0, miniH);
  const x = clamp(vp.scrollX * sx, 0, miniW - w);
  const y = clamp(vp.scrollY * sy, 0, miniH - h);
  return { x, y, w, h };
}

/**
 * Inverse of `viewportRectInMinimap`: the scroll offset that CENTERS the viewport
 * on the content point under minimap pixel `(mx, my)`. The result is unclamped —
 * `GridStore.scrollTo` re-clamps it to the valid range, so a click near an edge
 * lands at the nearest reachable scroll (the same clamp every navigator shares).
 */
export function minimapToScroll(
  mx: number,
  my: number,
  vp: Viewport,
  dims: Dims,
  miniW: number,
  miniH: number,
): { x: number; y: number } {
  const contentW = contentWidth(vp, dims);
  const contentH = contentHeight(vp, dims);
  const fx = miniW > 0 ? mx / miniW : 0;
  const fy = miniH > 0 ? my / miniH : 0;
  return {
    x: fx * contentW - vp.viewW / 2,
    y: fy * contentH - vp.viewH / 2,
  };
}
