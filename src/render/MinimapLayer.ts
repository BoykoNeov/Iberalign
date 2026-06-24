// The minimap — a whole-alignment overview strip below the grid. A
// DOWNSAMPLED AGGREGATE of the entire matrix (NOT a scaled full draw, which would
// be as expensive as the grid itself): per bucket, the non-gap OCCUPANCY drawn as
// the density-tier color blended over the background — the same reduction the
// density LOD tier uses (occupancy over averaged-color: gap structure is the
// honest, scheme-independent overview; conservation/identity coloring is M4 data).
//
// The aggregate is built ONCE per loaded view into a small offscreen canvas, then
// `drawImage`-scaled to fill the strip each frame — so per-frame cost is one
// blit + one rectangle, independent of alignment size. Only the viewport
// rectangle (the "you are here" box) actually changes per frame; it follows
// scroll/zoom because the layer is a `Drawable` on the shared rAF loop and every
// store mutation marks dirty.
//
// Interaction (click/drag to navigate) lives in `Grid.tsx`, which maps a pointer
// point back to a scroll offset through `minimap.ts::minimapToScroll` — the pure
// inverse of the rectangle this layer draws, so a drag round-trips exactly.

import type { AlignmentView } from "../model/view";
import type { Dims, Viewport } from "../state/viewport";
import type { Drawable } from "./Renderer";
import { type ColorScheme, defaultScheme } from "./colors";
import { isGap } from "../model/coords";
import { viewportRectInMinimap } from "./minimap";

// Offscreen aggregate resolution caps. Bucket COUNT only sizes the small offscreen
// ImageData — the O(width×rows) accumulation that fills it is the same cost at any
// cap — so these are generous: fine detail when down-scaled to the strip, never
// more buckets than there are columns/rows (a small alignment maps 1:1).
const MAX_AGG_COLS = 2048;
const MAX_AGG_ROWS = 256;

// Viewport-rectangle look: a translucent accent wash inside + a solid accent
// border, so the visible window reads as "here" over both the pale background and
// the slate occupancy. Accent matches the app (`#396cd8`).
const RECT_FILL = "rgba(57, 108, 216, 0.22)";
const RECT_STROKE = "rgba(57, 108, 216, 0.95)";

/** Parse a `rgb(r, g, b)` string (the exact form `colors.ts::makeScheme` emits)
 *  into numeric channels for the ImageData blend. Falls back to mid-grey. */
function parseRgb(css: string): [number, number, number] {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
}

export class MinimapLayer implements Drawable {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scheme: ColorScheme;
  private dpr = 1;

  // The offscreen aggregate, memoized by view IDENTITY (rebuilt on load / after an
  // in-place edit via `invalidate`). Null until the first draw with a view.
  private aggCanvas: HTMLCanvasElement | null = null;
  private aggView: AlignmentView | null = null;

  constructor(canvas: HTMLCanvasElement, scheme: ColorScheme = defaultScheme()) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("MinimapLayer: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.scheme = scheme;
  }

  resize(cssW: number, cssH: number, dpr: number = globalThis.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(0, Math.round(cssW * dpr));
    this.canvas.height = Math.max(0, Math.round(cssH * dpr));
    // Resize only rescales the blit + rect — the aggregate is resolution-fixed and
    // survives, so a window resize never rebuilds it.
  }

  setColorScheme(scheme: ColorScheme): void {
    this.scheme = scheme;
    this.aggCanvas = null; // colors (bg + density) are baked into the aggregate
    this.aggView = null;
  }

  /** Drop the cached aggregate after an in-place edit (the buffer/dims changed but
   *  the view object is reused, so identity memoization wouldn't notice). Mirrors
   *  `Canvas2DRenderer.invalidateContentCaches`; call it alongside that one. */
  invalidate(): void {
    this.aggCanvas = null;
    this.aggView = null;
  }

  draw(view: AlignmentView, vp: Viewport): void {
    const { ctx } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.scheme.background;
    ctx.fillRect(0, 0, cw, ch);

    // Aggregate overview (skipped for an empty alignment — nothing to summarize).
    const agg = this.ensureAggregate(view);
    if (agg) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(agg, 0, 0, agg.width, agg.height, 0, 0, cw, ch);
    }

    // The "you are here" rectangle, in device px (pass the device-px strip size as
    // the minimap extent so the pure geometry returns device coordinates directly).
    const dims: Dims = { cols: view.width, rows: view.numRows };
    const r = viewportRectInMinimap(vp, dims, cw, ch);
    ctx.fillStyle = RECT_FILL;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const lw = Math.max(1, Math.round(1.5 * this.dpr));
    ctx.strokeStyle = RECT_STROKE;
    ctx.lineWidth = lw;
    // Inset by half the line width so the stroke stays inside the strip at the edges.
    const half = lw / 2;
    ctx.strokeRect(
      r.x + half,
      r.y + half,
      Math.max(0, r.w - lw),
      Math.max(0, r.h - lw),
    );
  }

  dispose(): void {
    this.aggCanvas = null;
    this.aggView = null;
  }

  // ---- aggregate ---------------------------------------------------------

  /** Build (once per view) the offscreen occupancy aggregate, or return the cached
   *  one. `null` for an empty alignment. */
  private ensureAggregate(view: AlignmentView): HTMLCanvasElement | null {
    if (this.aggView === view && this.aggCanvas) return this.aggCanvas;
    const width = view.width;
    const rows = view.numRows;
    if (width === 0 || rows === 0) {
      this.aggCanvas = null;
      this.aggView = view;
      return null;
    }

    const aggCols = Math.min(width, MAX_AGG_COLS);
    const aggRows = Math.min(rows, MAX_AGG_ROWS);
    const buf = view.buffer;

    // Per-bucket non-gap count + cell total → occupancy. Precompute each column's
    // bucket once (the inner loop runs width×rows times).
    const counts = new Float32Array(aggCols * aggRows);
    const totals = new Float32Array(aggCols * aggRows);
    const bcOf = new Int32Array(width);
    for (let c = 0; c < width; c++) bcOf[c] = Math.floor((c * aggCols) / width);
    for (let r = 0; r < rows; r++) {
      const br = Math.floor((r * aggRows) / rows);
      const brBase = br * aggCols;
      const rowBase = r * width;
      for (let c = 0; c < width; c++) {
        const idx = brBase + bcOf[c];
        totals[idx] += 1;
        if (!isGap(buf[rowBase + c])) counts[idx] += 1;
      }
    }

    // Blend occupancy over the background into an opaque image (opaque avoids
    // alpha fringing when `drawImage` smooths the scale).
    const [br0, bg0, bb0] = parseRgb(this.scheme.background);
    const [dr, dg, db] = parseRgb(this.scheme.densityStyle);
    const off = document.createElement("canvas");
    off.width = aggCols;
    off.height = aggRows;
    const offCtx = off.getContext("2d");
    if (!offCtx) {
      this.aggCanvas = null;
      this.aggView = view;
      return null;
    }
    const img = offCtx.createImageData(aggCols, aggRows);
    const px = img.data;
    for (let i = 0; i < counts.length; i++) {
      const t = totals[i];
      const occ = t > 0 ? counts[i] / t : 0;
      const o = i * 4;
      px[o] = Math.round(br0 + (dr - br0) * occ);
      px[o + 1] = Math.round(bg0 + (dg - bg0) * occ);
      px[o + 2] = Math.round(bb0 + (db - bb0) * occ);
      px[o + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);

    this.aggCanvas = off;
    this.aggView = view;
    return off;
  }
}
