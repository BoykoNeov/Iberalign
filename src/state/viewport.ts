// The `Viewport` — the mutable per-frame view state of the grid (scroll offset
// and zoom), plus the pure reducers that move it. These functions are the only
// place viewport transitions are defined; `GridStore` holds the current value
// and `render/viewport.ts` derives screen geometry from it. Keeping them pure
// makes pan/zoom/clamp unit-testable without a canvas or React.
//
// UNITS: every field here is CSS *logical* pixels (the unit of mouse events),
// never device pixels. `devicePixelRatio` is confined to `Canvas2DRenderer`
// (backing-store scaling); viewport math never sees it, so the zoom anchor and
// visible-window counts can't drift on a HiDPI display.
//
// ORIGIN: the viewport is local to the *grid canvas*, which excludes the pinned
// name column and the ruler. So `scrollX === 0` puts column 0 at the grid
// canvas's left edge (not the window's), and those chrome elements never enter
// this math.

// Type-only import (erased at emit, so no runtime cycle with `selection.ts`,
// which imports `Dims` from here): `scrollIntoView` follows a selection `Cell`.
import type { Cell } from "./selection";

/** Alignment dimensions in cells. Content size is derived from these + cell px. */
export interface Dims {
  cols: number;
  rows: number;
}

/** Scroll offset (top-left of the visible window into the content) + zoom. */
export interface Viewport {
  /** Content px hidden to the left/top of the visible window (>= 0). */
  scrollX: number;
  scrollY: number;
  /** Cell size in CSS px (the zoom level). `cellW === cellH` in M2. */
  cellW: number;
  cellH: number;
  /** Visible grid-canvas size in CSS px. */
  viewW: number;
  viewH: number;
}

/** Cell-size (zoom) bounds in CSS px. Spans the LOD tiers (see `lod.ts`): MAX
 *  is comfortably in the letter tier, MIN is deep in the density tier. */
export const MIN_CELL = 1;
export const MAX_CELL = 32;
export const DEFAULT_CELL = 14;

/** A fresh viewport at the default zoom, scrolled to the origin. */
export function initViewport(viewW = 0, viewH = 0): Viewport {
  return {
    scrollX: 0,
    scrollY: 0,
    cellW: DEFAULT_CELL,
    cellH: DEFAULT_CELL,
    viewW,
    viewH,
  };
}

export function contentWidth(vp: Viewport, dims: Dims): number {
  return dims.cols * vp.cellW;
}

export function contentHeight(vp: Viewport, dims: Dims): number {
  return dims.rows * vp.cellH;
}

function clampCell(px: number): number {
  return Math.min(MAX_CELL, Math.max(MIN_CELL, px));
}

/** Clamp a scroll offset to `[0, max(0, content - view)]`. When the content is
 *  smaller than the view (small alignment, or zoomed out), the only valid
 *  offset is 0. */
function clampScroll(offset: number, content: number, view: number): number {
  const max = Math.max(0, content - view);
  return Math.min(max, Math.max(0, offset));
}

/** Re-clamp scroll to the current content/view extents (call after any change
 *  to zoom, dims, or view size). Pure: returns a new viewport. */
export function clamp(vp: Viewport, dims: Dims): Viewport {
  return {
    ...vp,
    scrollX: clampScroll(vp.scrollX, contentWidth(vp, dims), vp.viewW),
    scrollY: clampScroll(vp.scrollY, contentHeight(vp, dims), vp.viewH),
  };
}

/** Translate the visible window by `(dx, dy)` CSS px, then re-clamp. */
export function pan(vp: Viewport, dims: Dims, dx: number, dy: number): Viewport {
  return clamp({ ...vp, scrollX: vp.scrollX + dx, scrollY: vp.scrollY + dy }, dims);
}

/** Set the scroll offset to an ABSOLUTE `(x, y)` CSS px, then re-clamp. The
 *  pointer-free navigators (keyboard Home/End/corner jumps, scrollbar thumb
 *  drag, track paging) target a position rather than a delta — this is their one
 *  write path, so the same clamp guards every entry. */
export function scrollTo(vp: Viewport, dims: Dims, x: number, y: number): Viewport {
  return clamp({ ...vp, scrollX: x, scrollY: y }, dims);
}

/** Set the visible grid-canvas size (CSS px) and re-clamp (a smaller alignment
 *  may now fit entirely, a larger view may expose past the old max scroll). */
export function resize(vp: Viewport, dims: Dims, viewW: number, viewH: number): Viewport {
  return clamp({ ...vp, viewW, viewH }, dims);
}

/**
 * Minimal scroll so a cell's box is fully inside the visible window, then clamp.
 * Used by the cursor movers (`GridStore.moveCursor`/`extendActive`) so the
 * active end stays on screen as it moves — in the SAME mutation as the selection
 * change, one dirty mark, one redraw. Only scrolls the axes where the cell is
 * outside the view (so an already-visible cursor doesn't jolt the view), and
 * follows the cell that's passed (the caller follows `active`, the moving end).
 */
export function scrollIntoView(vp: Viewport, dims: Dims, cell: Cell): Viewport {
  const left = cell.col * vp.cellW;
  const right = left + vp.cellW;
  const top = cell.row * vp.cellH;
  const bottom = top + vp.cellH;
  let { scrollX, scrollY } = vp;
  if (left < scrollX) scrollX = left;
  else if (right > scrollX + vp.viewW) scrollX = right - vp.viewW;
  if (top < scrollY) scrollY = top;
  else if (bottom > scrollY + vp.viewH) scrollY = bottom - vp.viewH;
  return clamp({ ...vp, scrollX, scrollY }, dims);
}

/**
 * Zoom about a cursor point `(ax, ay)` given in grid-canvas CSS px: scale the
 * cell size by `factor` (clamped to `[MIN_CELL, MAX_CELL]`) while keeping the
 * content point currently under the cursor under the cursor afterward.
 *
 * The anchor is preserved exactly for the cell-size clamp (we re-derive scroll
 * from the *clamped* cell size); the final `clamp` may still move scroll near a
 * content edge, which is correct — you cannot scroll past the edge.
 */
export function zoomAbout(
  vp: Viewport,
  dims: Dims,
  factor: number,
  ax: number,
  ay: number,
): Viewport {
  const cellW = clampCell(vp.cellW * factor);
  const cellH = clampCell(vp.cellH * factor);
  // Content coordinate under the cursor, in cell units (pre-zoom).
  const colF = (vp.scrollX + ax) / vp.cellW;
  const rowF = (vp.scrollY + ay) / vp.cellH;
  // Re-derive scroll so that same content point lands back under (ax, ay):
  //   colF * cellW' - scrollX' = ax  ⇒  scrollX' = colF * cellW' - ax.
  const scrollX = colF * cellW - ax;
  const scrollY = rowF * cellH - ay;
  return clamp({ scrollX, scrollY, cellW, cellH, viewW: vp.viewW, viewH: vp.viewH }, dims);
}
