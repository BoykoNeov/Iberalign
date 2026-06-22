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
  resize,
  zoomAbout,
} from "./viewport";

export class GridStore {
  private viewport: Viewport;
  private dims: Dims;
  private dirty: boolean;

  constructor() {
    this.viewport = initViewport();
    this.dims = { cols: 0, rows: 0 };
    this.dirty = false;
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

  /** Set the loaded alignment's dimensions (call on load), reset the scroll to
   *  the origin, and re-clamp. Marks dirty so the new alignment paints. */
  setDims(cols: number, rows: number): void {
    this.dims = { cols, rows };
    this.mutate(clamp({ ...this.viewport, scrollX: 0, scrollY: 0 }, this.dims));
  }

  /** Set the visible grid-canvas size in CSS px (from the ResizeObserver). */
  resize(viewW: number, viewH: number): void {
    this.mutate(resize(this.viewport, this.dims, viewW, viewH));
  }

  /** Translate the visible window by `(dx, dy)` CSS px. */
  pan(dx: number, dy: number): void {
    this.mutate(pan(this.viewport, this.dims, dx, dy));
  }

  /** Zoom about a grid-canvas cursor point `(ax, ay)` in CSS px. */
  zoom(factor: number, ax: number, ay: number): void {
    this.mutate(zoomAbout(this.viewport, this.dims, factor, ax, ay));
  }

  /** The single write path: swap in the next viewport and always mark dirty. */
  private mutate(next: Viewport): void {
    this.viewport = next;
    this.dirty = true;
  }
}
