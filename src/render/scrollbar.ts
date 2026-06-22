// Overlay-scrollbar geometry — pure math, no DOM. Given the viewport (scroll +
// zoom + visible extent) and the alignment dims, it derives whether each axis
// overflows and, if so, the thumb's length and position along its track. The
// inverse (`scrollForThumbPos`) maps a dragged thumb position back to a scroll
// offset. Keeping it pure makes the round-trip (scroll → thumb → scroll)
// unit-testable without a canvas, a browser, or React.
//
// The scrollbars FLOAT over the grid canvas (macOS overlay style): they don't
// reserve layout tracks, so the viewport extent (`viewW/viewH`) is unchanged and
// the careful chrome layout in `Grid.tsx` is untouched. When both axes overflow,
// each track is shortened by the other bar's thickness so the two thumbs share an
// L and never overlap in the corner.

import {
  type Dims,
  type Viewport,
  contentWidth,
  contentHeight,
} from "../state/viewport";

/** Overlay thumb thickness (the short axis), CSS px. */
export const SCROLLBAR_THICKNESS = 10;
/** Smallest thumb length so it stays grabbable even on a huge alignment, CSS px. */
export const SCROLLBAR_MIN_THUMB = 24;

/** One axis's scrollbar geometry, all in CSS px (the unit of pointer events). */
export interface AxisScrollbar {
  /** Whether the content overflows the view on this axis (bar is shown). */
  visible: boolean;
  /** Length of the track the thumb travels within. */
  trackLen: number;
  /** Thumb length along the track. */
  thumbLen: number;
  /** Thumb offset from the track start (0 .. trackLen − thumbLen). */
  thumbPos: number;
  /** Maximum scroll offset on this axis, `max(0, content − view)`. */
  maxScroll: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Geometry for one axis. `content` is the total content px, `view` the visible
 *  px, `trackLen` the px the thumb travels within (≤ view; shortened when the
 *  cross bar is present). */
export function axisScrollbar(
  scroll: number,
  content: number,
  view: number,
  trackLen: number,
  minThumb: number = SCROLLBAR_MIN_THUMB,
): AxisScrollbar {
  const maxScroll = Math.max(0, content - view);
  // No overflow (small or zoomed-out alignment), or no room to draw a thumb.
  if (maxScroll <= 0 || trackLen <= 0) {
    return { visible: false, trackLen: Math.max(0, trackLen), thumbLen: 0, thumbPos: 0, maxScroll };
  }
  // Thumb proportional to the visible fraction, floored so it stays grabbable and
  // capped so it never exceeds the track.
  const thumbLen = Math.min(trackLen, Math.max(minThumb, (trackLen * view) / content));
  const range = trackLen - thumbLen;
  const thumbPos = clamp01(scroll / maxScroll) * range;
  return { visible: true, trackLen, thumbLen, thumbPos, maxScroll };
}

/** Both axes at once, applying the corner-sharing track shortening. The vertical
 *  bar's visibility depends on the height extents alone (and vice-versa), so the
 *  cross-shortening introduces no circular dependency. */
export function layoutScrollbars(
  vp: Viewport,
  dims: Dims,
  thickness: number = SCROLLBAR_THICKNESS,
  minThumb: number = SCROLLBAR_MIN_THUMB,
): { v: AxisScrollbar; h: AxisScrollbar } {
  const contentW = contentWidth(vp, dims);
  const contentH = contentHeight(vp, dims);
  const vNeeded = contentH - vp.viewH > 0;
  const hNeeded = contentW - vp.viewW > 0;
  // Shorten each track by the OTHER bar's thickness only when that bar shows.
  const vTrack = vp.viewH - (hNeeded ? thickness : 0);
  const hTrack = vp.viewW - (vNeeded ? thickness : 0);
  return {
    v: axisScrollbar(vp.scrollY, contentH, vp.viewH, vTrack, minThumb),
    h: axisScrollbar(vp.scrollX, contentW, vp.viewW, hTrack, minThumb),
  };
}

/** Inverse of `axisScrollbar`: the scroll offset that places the thumb's start at
 *  `pos` px along the track. The exact inverse of `thumbPos` for the same
 *  `AxisScrollbar`, so a drag round-trips without drift. */
export function scrollForThumbPos(pos: number, sb: AxisScrollbar): number {
  const range = sb.trackLen - sb.thumbLen;
  if (range <= 0) return 0;
  return clamp01(pos / range) * sb.maxScroll;
}
