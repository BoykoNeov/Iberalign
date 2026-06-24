// `GridStore` — the mutable per-frame view state of the grid, deliberately
// OUTSIDE React (spec §3: "no per-frame React state"). It holds the current
// `Viewport` + alignment `Dims` + a `dirty` flag, and applies the pure reducers
// from `viewport.ts` on pan/zoom/resize. The grid component's requestAnimationFrame
// loop reads `getViewport()` each tick and redraws only when `consumeDirty()`
// reports a pending change.
//
// DIRTY / rAF CONTRACT (continuous-rAF-with-skip):
//   - The rAF loop runs every frame but draws only when `consumeDirty()` → true.
//   - EVERY state change sets `dirty`: load (`setDims`), `resize`, `pan`, `zoom`.
//     A missed dirty source is the classic "didn't repaint" bug, so all mutators
//     funnel through `mutate()` which always marks dirty.
//
// The store does NOT hold the `AlignmentView`/buffer: load is the only coarse
// event and it originates in a React handler, so `view` lives in App state and
// is handed to the renderer directly. The store owns only what changes per
// frame, which React must never re-render on.

import {
  type Dims,
  type Viewport,
  initViewport,
  clamp,
  pan,
  scrollTo,
  resize,
  zoomAbout,
  scrollIntoView,
} from "./viewport";
import {
  type Selection,
  setCursor as selSetCursor,
  setActive as selSetActive,
  moveCursor as selMoveCursor,
  extendActive as selExtendActive,
  selectAll as selSelectAll,
  collapseSelection as selCollapse,
  clampSelection as selClamp,
} from "./selection";

export class GridStore {
  private viewport: Viewport;
  private dims: Dims;
  private dirty: boolean;
  // The cursor + rectangular selection (store-only — no React mirror; the rAF
  // loop's SelectionLayer reads it each dirty frame). `null` ⇒ nothing selected.
  private selection: Selection | null;
  // Optional coarse listener fired on every selection change (set/extend/move/
  // clear/load). The grid uses it to mirror the selection into React for the
  // status readout ONLY — throttled there to rect identity, never per frame. The
  // rAF loop still reads `getSelection()` directly; this does not drive drawing.
  private onSelectionChange?: (sel: Selection | null) => void;

  constructor() {
    this.viewport = initViewport();
    this.dims = { cols: 0, rows: 0 };
    this.dirty = false;
    this.selection = null;
  }

  /** Snapshot of the current viewport (read by the rAF draw loop each tick). */
  getViewport(): Viewport {
    return this.viewport;
  }

  getDims(): Dims {
    return this.dims;
  }

  /** Return whether a redraw is pending and clear the flag. The rAF loop calls
   *  this once per tick and draws iff it returns true. */
  consumeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  /** Force a redraw on the next tick without a viewport change (e.g. a new
   *  alignment buffer with identical dims, a theme change). */
  markDirty(): void {
    this.dirty = true;
  }

  /** Snapshot of the current selection (read by the SelectionLayer each frame). */
  getSelection(): Selection | null {
    return this.selection;
  }

  /** Register the coarse selection-change listener (the React status readout).
   *  Replaces any previous listener; pass `undefined` to detach. */
  setSelectionListener(cb: ((sel: Selection | null) => void) | undefined): void {
    this.onSelectionChange = cb;
  }

  /** Set the loaded alignment's dimensions (call on load), reset the scroll to
   *  the origin, clear any selection (it pointed at the old alignment's rows),
   *  and re-clamp. Marks dirty so the new alignment paints. */
  setDims(cols: number, rows: number): void {
    this.dims = { cols, rows };
    this.selection = null;
    this.onSelectionChange?.(null);
    this.mutate(clamp({ ...this.viewport, scrollX: 0, scrollY: 0 }, this.dims));
  }

  /** Update the dimensions after a width-changing EDIT (paste-insert / cut /
   *  their undo/redo) — NOT a load. Unlike `setDims` this KEEPS the scroll and the
   *  selection (the edit didn't change what's loaded); it only re-clamps both to
   *  the new extent. A shrink can push the cursor past the new edge, so the
   *  selection is clamped and the listener fired (else the toolbar readout goes
   *  stale after an undo-shrink). Marks dirty. */
  updateDims(cols: number, rows: number): void {
    this.dims = { cols, rows };
    if (this.selection) {
      this.selection = selClamp(this.selection, this.dims);
      this.onSelectionChange?.(this.selection);
    }
    this.mutate(clamp(this.viewport, this.dims));
  }

  /** Set the visible grid-canvas size in CSS px (from the ResizeObserver). */
  resize(viewW: number, viewH: number): void {
    this.mutate(resize(this.viewport, this.dims, viewW, viewH));
  }

  /** Translate the visible window by `(dx, dy)` CSS px. */
  pan(dx: number, dy: number): void {
    this.mutate(pan(this.viewport, this.dims, dx, dy));
  }

  /** Move the visible window to an ABSOLUTE scroll offset in CSS px (keyboard
   *  jumps, scrollbar thumb drag / track paging). */
  scrollTo(x: number, y: number): void {
    this.mutate(scrollTo(this.viewport, this.dims, x, y));
  }

  /** Zoom about a grid-canvas cursor point `(ax, ay)` in CSS px. */
  zoom(factor: number, ax: number, ay: number): void {
    this.mutate(zoomAbout(this.viewport, this.dims, factor, ax, ay));
  }

  // ---- selection ---------------------------------------------------------
  //
  // Each selection mutator runs the matching pure reducer against the current
  // `dims` and marks dirty (same discipline as the viewport mutators — a missed
  // dirty is the classic "didn't repaint" bug). `moveCursor`/`extendActive` ALSO
  // scroll the active (moving) end into view in the SAME mutation, so a key press
  // is one redraw with no flash. The pointer setters (`setCursor`/`setActive`) do
  // NOT scroll — the clicked cell is already under the cursor.

  /** Collapse to a single cursor at `(row, col)` — a click. No scroll. */
  setCursor(row: number, col: number): void {
    this.setSelection(selSetCursor(row, col, this.dims));
  }

  /** Extend the rectangle to `(row, col)` keeping the anchor — Shift+click. No
   *  scroll (the cell is under the cursor). */
  setActive(row: number, col: number): void {
    this.setSelection(selSetActive(this.selection, row, col, this.dims));
  }

  /** Move the cursor by `(dr, dc)`, collapsing the rectangle, and scroll the
   *  cursor into view — arrows / Page (and `FAR` deltas for Home/End/corner). */
  moveCursor(dr: number, dc: number): void {
    const next = selMoveCursor(this.selection, dr, dc, this.dims);
    this.setSelection(next, scrollIntoView(this.viewport, this.dims, next.active));
  }

  /** Extend the rectangle's active end by `(dr, dc)` and scroll it into view —
   *  Shift+arrows / Shift+Page (and `FAR` deltas for Shift+Home/End/corner). */
  extendActive(dr: number, dc: number): void {
    const next = selExtendActive(this.selection, dr, dc, this.dims);
    this.setSelection(next, scrollIntoView(this.viewport, this.dims, next.active));
  }

  /** Select the whole alignment (Ctrl/⌘+A). No scroll. */
  selectAll(): void {
    this.setSelection(selSelectAll(this.dims));
  }

  /** Collapse the rectangle to its active cell (Esc). No-op when nothing is
   *  selected. */
  collapseSelection(): void {
    if (!this.selection) return;
    this.setSelection(selCollapse(this.selection));
  }

  /** Drop the selection entirely. No-op (no redraw) when already empty. */
  clearSelection(): void {
    if (this.selection === null) return;
    this.selection = null;
    this.dirty = true;
    this.onSelectionChange?.(null);
  }

  /** The single selection write path: swap in the next selection (and optionally
   *  a scrolled viewport, for cursor moves), always mark dirty, and notify the
   *  coarse listener. */
  private setSelection(next: Selection, viewport?: Viewport): void {
    this.selection = next;
    if (viewport) this.viewport = viewport;
    this.dirty = true;
    this.onSelectionChange?.(next);
  }

  /** The single viewport write path: swap in the next viewport and always mark
   *  dirty. */
  private mutate(next: Viewport): void {
    this.viewport = next;
    this.dirty = true;
  }
}
