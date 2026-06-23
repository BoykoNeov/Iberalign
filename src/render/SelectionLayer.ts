// The selection overlay as a `Drawable` layer. It owns its OWN `<canvas>`,
// stacked above the grid canvas inside `.grid-canvas-cell` (z-index between the
// grid and the scrollbar thumbs; `pointer-events:none` so clicks fall through to
// the grid). Painting the selection on a separate alpha canvas — rather than
// threading it into `Canvas2DRenderer`, whose `draw(view, vp)` has no selection
// slot — keeps the two concerns apart (Decision 5).
//
// HONESTY: this overlay does NOT save grid redraws. Any selection change marks
// the store dirty, so the grid canvas repaints that frame too; the overlay is for
// layering/separation, not perf. Cost is negligible (a few fills across two
// overlay canvases).
//
// PIXEL ALIGNMENT: both canvases are sized from the SAME ResizeObserver entry /
// dpr as the grid canvas (in `Grid.tsx`), and they reuse `colToX`/`rowToY` with the
// same `round(* dpr)` snapping the grid uses, so the rectangle can't drift a
// sub-pixel off the cells.
//
// LOOK: two stacked overlay canvases this one Drawable owns and paints together.
//   1) INVERT canvas — carries CSS `mix-blend-mode: difference` (and
//      `.grid-canvas-cell` is `isolation: isolate`, so the blend is confined to the
//      grid canvas directly below). Solid white painted over the rectangle
//      composites to `255 − backdrop` per channel — a true photographic negative
//      that reads as "selected" on any color scheme and at any zoom. The active
//      cell (the cursor) is marked Excel-style: its white is CLEARED so the one
//      cell shows its true, "live" color inside the inverted block — but ONLY when
//      the selection spans more than one cell, since clearing a lone single-cell
//      cursor would erase the only inverted pixels and it would vanish.
//   2) BORDER canvas — a SEPARATE, non-blending canvas stacked ABOVE the invert
//      canvas (z-index 2, no blend mode), so a thick accent border holds a CONSTANT
//      color instead of inverting against the residues. (A border drawn on the
//      difference-blend canvas would itself invert against the backdrop and could
//      not hold one color — hence the second canvas.) It sits above the invert
//      canvas but BELOW the scrollbar thumbs (bumped to z-index 3).
// Both canvases are owned and sized by this single Drawable (one `resize`), so they
// can't desync — the `Renderer.ts` resize contract is met by that one call, and the
// loop drives one `draw()` that paints both.
//
// Rectangle edges (and the border strips) are snapped to device px with the same
// `round(* dpr)` the grid uses (the `next - this` edge trick), so neither the
// inverted block nor the border can drift a sub-pixel off the cells.

import type { AlignmentView } from "../model/view";
import type { Viewport } from "../state/viewport";
import type { Drawable } from "./Renderer";
import { type Selection, normalize } from "../state/selection";
import { colToX, rowToY } from "./viewport";

// Solid white painted through the invert canvas's CSS `mix-blend-mode: difference`
// inverts the backdrop: result = `255 − backdrop` per channel, a true negative.
// Full alpha = full inversion.
const INVERT = "#ffffff";

// Thick border, drawn on the SEPARATE non-blending border canvas above the invert
// canvas so it shows this constant color (not an inversion). Thickness is in CSS px
// (scaled by dpr at draw time); both are tunable. Black reads as a hard outline
// against both the inverted interior and the normal residues just outside.
const BORDER = "#000000";
const BORDER_PX = 3;

export class SelectionLayer implements Drawable {
  private readonly canvas: HTMLCanvasElement; // invert (mix-blend-mode: difference)
  private readonly ctx: CanvasRenderingContext2D;
  private readonly border: HTMLCanvasElement; // accent border (no blend), stacked above
  private readonly bctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    canvas: HTMLCanvasElement,
    borderCanvas: HTMLCanvasElement,
    // Read each dirty frame — the store owns the selection (no React mirror).
    private readonly getSelection: () => Selection | null,
  ) {
    // Default alpha:true on both — each overlay must show what's beneath it through
    // its transparent pixels (clearRect leaves them transparent), unlike the opaque
    // grid canvas.
    const ctx = canvas.getContext("2d");
    const bctx = borderCanvas.getContext("2d");
    if (!ctx || !bctx) throw new Error("SelectionLayer: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.border = borderCanvas;
    this.bctx = bctx;
  }

  /** Size BOTH backing stores (CSS px × dpr) in one call, so the invert and border
   *  canvases can't desync. Call with the SAME cssW/cssH/dpr as the grid canvas's
   *  `resize` (the contract in `Renderer.ts`). */
  resize(cssW: number, cssH: number, dpr: number = globalThis.devicePixelRatio || 1): void {
    this.dpr = dpr;
    const w = Math.max(0, Math.round(cssW * dpr));
    const h = Math.max(0, Math.round(cssH * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.border.width = w;
    this.border.height = h;
  }

  // The grid `view` isn't needed (the selection carries its own cell coords); the
  // signature matches `Drawable` so the loop can drive it alongside the others.
  draw(_view: AlignmentView, vp: Viewport): void {
    const { ctx, bctx } = this;
    const cw = this.canvas.width; // both canvases are sized identically in resize()
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return; // a draw before the first resize

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, cw, ch);

    const sel = this.getSelection();
    if (!sel) return;

    const dpr = this.dpr;
    // Device-px rectangle edges, snapped to integers with the `next - this` edge
    // trick (matches the grid, so no sub-pixel crack).
    const rect = normalize(sel);
    const xL = Math.round(colToX(vp, rect.c0) * dpr);
    const xR = Math.round(colToX(vp, rect.c1 + 1) * dpr);
    const yT = Math.round(rowToY(vp, rect.r0) * dpr);
    const yB = Math.round(rowToY(vp, rect.r1 + 1) * dpr);
    const w = xR - xL;
    const h = yB - yT;
    if (w <= 0 || h <= 0) return;

    // (1) Invert the whole rectangle: white through the difference blend → negative.
    ctx.fillStyle = INVERT;
    ctx.fillRect(xL, yT, w, h);

    // Active cell (the cursor): in a MULTI-cell selection, clear its white so the
    // one cell shows its true, "live" color inside the inverted block (Excel/Sheets
    // idiom — locatable as the lone non-inverted cell). Skipped for a single-cell
    // cursor: clearing it would erase the only inverted pixels and the cursor would
    // vanish, so a lone cell just inverts.
    const single = rect.r0 === rect.r1 && rect.c0 === rect.c1;
    if (!single) {
      const aL = Math.round(colToX(vp, sel.active.col) * dpr);
      const aR = Math.round(colToX(vp, sel.active.col + 1) * dpr);
      const aT = Math.round(rowToY(vp, sel.active.row) * dpr);
      const aB = Math.round(rowToY(vp, sel.active.row + 1) * dpr);
      const aw = aR - aL;
      const ah = aB - aT;
      if (aw > 0 && ah > 0) ctx.clearRect(aL, aT, aw, ah);
    }

    // (2) Thick accent border on the SEPARATE non-blending canvas above. Four inset
    // strips (not strokeRect) so every edge lands on whole device px and sits fully
    // INSIDE the rectangle — no bleed into neighbors, no sub-pixel AA fuzz. The
    // thickness is capped to half the smaller side, so a tiny selection (a lone cell
    // zoomed out) fills solid accent rather than overdrawing past its own edges.
    const bw = Math.max(1, Math.min(Math.round(BORDER_PX * dpr), Math.floor(Math.min(w, h) / 2)));
    bctx.fillStyle = BORDER;
    bctx.fillRect(xL, yT, w, bw); // top
    bctx.fillRect(xL, yB - bw, w, bw); // bottom
    bctx.fillRect(xL, yT, bw, h); // left
    bctx.fillRect(xR - bw, yT, bw, h); // right
  }

  /** No GPU/atlas resources to free; the backing store is released with the DOM
   *  node. Present so the container's cleanup can call it uniformly. */
  dispose(): void {}
}
