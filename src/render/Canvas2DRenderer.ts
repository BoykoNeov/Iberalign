// The Canvas2D grid renderer. Draws only the visible window (virtualized via
// `render/viewport.ts`) at the LOD tier the current zoom selects (`lod.ts`):
//
//   - letter  (cell ≥ 8px): run-merged color fills + a residue glyph per cell,
//     blitted from the offscreen `GlyphAtlas` (never `fillText` per cell).
//   - block   (3–8px): run-merged color fills only, no glyphs.
//   - density (< 3px): one occupancy bar per visible column (per-column gap
//     density precomputed once per load), never a draw per cell.
//
// Everything is computed in DEVICE pixels and snapped to integers with the
// `next - this` edge trick (`xs[i+1] - xs[i]`), so adjacent cells tile seamlessly
// with no sub-pixel cracks on HiDPI. CSS-px viewport math is multiplied by `dpr`
// here and nowhere else (the dpr is confined to this file, per `state/viewport`).
//
// Caches:
//   - glyph atlas: keyed by (scheme, dpr); rebuilt on scheme/dpr change only.
//   - column occupancy: keyed by view identity ONLY (occupancy is gap structure,
//     independent of the color scheme) — so switching schemes never staleness-
//     bugs the density tier; it just re-reads `densityStyle`.

import type { AlignmentView } from "../model/view";
import { type Dims, type Viewport } from "../state/viewport";
import { colToX, rowToY, visibleCols, visibleRows } from "./viewport";
import { lodFor } from "./lod";
import { forEachFillRun } from "./runs";
import { GlyphAtlas } from "./glyphs";
import { type ColorScheme, defaultScheme } from "./colors";
import { isGap } from "../model/coords";
import { trailingGapStarts } from "../model/trailing";
import type { Renderer } from "./Renderer";

// One cell of overscan so a partly-scrolled edge cell is fully drawn.
const OVERSCAN = 1;

// The glyph drawn for a gap cell at the letter tier: a unified `-` (the engine
// already normalizes `.`→`-` in memory, but any gap byte renders as `-` so a gap
// reads as a gap — and a deleted/masked cell is visibly a gap, not a blank).
const GAP_GLYPH = 0x2d; // '-'

export class Canvas2DRenderer implements Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scheme: ColorScheme;
  private dpr = 1;
  private atlas: GlyphAtlas | null = null;

  // Per-column non-gap fraction (density tier), cached by view identity.
  private occView: AlignmentView | null = null;
  private occ: Float32Array | null = null;

  // Per-row trailing-gap start column (cell tiers): columns at/after it are blank
  // trailing padding, not real gaps. Cached by view identity like occupancy.
  private trailView: AlignmentView | null = null;
  private trailStart: Int32Array | null = null;

  constructor(canvas: HTMLCanvasElement, scheme: ColorScheme = defaultScheme()) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2DRenderer: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.scheme = scheme;
  }

  resize(cssW: number, cssH: number, dpr: number = globalThis.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(0, Math.round(cssW * dpr));
    this.canvas.height = Math.max(0, Math.round(cssH * dpr));
    // dpr change invalidates the atlas (tiles are device-resolution).
    if (this.atlas && !this.atlas.matches(this.scheme, dpr)) {
      this.atlas.dispose();
      this.atlas = null;
    }
  }

  setColorScheme(scheme: ColorScheme): void {
    this.scheme = scheme;
    // Re-ink lazily on the next letter-tier draw; occupancy is scheme-free.
    if (this.atlas) {
      this.atlas.dispose();
      this.atlas = null;
    }
  }

  draw(view: AlignmentView, vp: Viewport): void {
    const { ctx } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return; // a draw before the first resize

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.scheme.background;
    ctx.fillRect(0, 0, cw, ch);

    const dims: Dims = { cols: view.width, rows: view.numRows };
    const cols = visibleCols(vp, dims, OVERSCAN);
    const rows = visibleRows(vp, dims, OVERSCAN);
    if (cols.last < cols.first || rows.last < rows.first) return;

    // Square cells in M2 → one zoom scalar; tier off cell width.
    if (lodFor(vp.cellW) === "density") {
      this.drawDensity(view, vp, cols, rows);
    } else {
      this.drawCells(view, vp, cols, rows, lodFor(vp.cellW) === "letter");
    }
  }

  dispose(): void {
    this.atlas?.dispose();
    this.atlas = null;
    this.occ = null;
    this.occView = null;
    this.trailStart = null;
    this.trailView = null;
  }

  /**
   * Drop content-derived caches after an in-place edit. The cell tiers read
   * `view.buffer` fresh each draw, but the density tier's per-column occupancy is
   * memoized by view IDENTITY (`ensureOccupancy`) — an edit mutates the buffer in
   * place without changing the view object, so without this the zoomed-out tier
   * would render stale occupancy until the next load. Call after a buffer patch,
   * before marking the store dirty. (The glyph atlas is content-independent.)
   */
  invalidateContentCaches(): void {
    this.occ = null;
    this.occView = null;
    // Trailing-gap starts are buffer-derived too — an insert pads every other row,
    // so without this they'd render the old (shorter) padding boundary until reload.
    this.trailStart = null;
    this.trailView = null;
  }

  // ---- tiers -------------------------------------------------------------

  /**
   * Letter / block tiers. Per row, merge horizontally-adjacent same-color cells
   * into one `fillRect` (DNA has long gap and conserved runs — a big win at the
   * dense end of the block tier), then blit each non-gap glyph at the letter tier.
   */
  private drawCells(
    view: AlignmentView,
    vp: Viewport,
    cols: { first: number; last: number },
    rows: { first: number; last: number },
    letters: boolean,
  ): void {
    const { ctx } = this;
    const dpr = this.dpr;
    const scheme = this.scheme;
    const buf = view.buffer;
    const width = view.width;

    const atlas = letters ? this.ensureAtlas() : null;
    const trailStart = this.ensureTrailingStart(view);

    // Device-px column / row edges, computed once for this frame's window.
    const nCols = cols.last - cols.first + 1;
    const nRows = rows.last - rows.first + 1;
    const xs = new Int32Array(nCols + 1);
    for (let i = 0; i <= nCols; i++) xs[i] = Math.round(colToX(vp, cols.first + i) * dpr);
    const ys = new Int32Array(nRows + 1);
    for (let j = 0; j <= nRows; j++) ys[j] = Math.round(rowToY(vp, rows.first + j) * dpr);

    for (let j = 0; j < nRows; j++) {
      const yTop = ys[j];
      const h = ys[j + 1] - yTop;
      if (h <= 0) continue;
      const row = rows.first + j;
      const base = row * width;

      // TRAILING PADDING (gaps past this row's last residue) renders as a faint-grey
      // recessive fill with NO `-` glyph — so inserting a column into one sequence
      // doesn't make every other row look like it grew a real (interior) gap, and a
      // row reads "ragged right" past its content. Interior gaps stay full gaps.
      // Clamp the row's CONTENT columns to the span [cols.first, trailStart)
      // intersected with the visible window; the rest is the padding tail.
      const nContent = Math.max(0, Math.min(nCols, trailStart[row] - cols.first));

      // Fills: one rect per run-merged same-color span over the content columns only
      // (see `runs.ts`).
      forEachFillRun(buf, base, cols.first, nContent, xs, scheme.fillStyleFor, (x0, w, style) => {
        ctx.fillStyle = style;
        ctx.fillRect(x0, yTop, w, h);
      });

      // Padding tail: one faint-grey rect from the content edge to the window edge.
      if (nContent < nCols) {
        const xT = xs[nContent];
        const wT = xs[nCols] - xT;
        if (wT > 0) {
          ctx.fillStyle = scheme.trailingStyle;
          ctx.fillRect(xT, yTop, wT, h);
        }
      }

      // Glyphs (letter tier only): one atlas blit per content cell — residues as
      // themselves, INTERIOR gaps as a unified `-` (a masked/deleted cell shows the
      // dash rather than a blank fill); trailing-pad columns are skipped → no glyph.
      if (atlas) {
        for (let i = 0; i < nContent; i++) {
          const xL = xs[i];
          const w = xs[i + 1] - xL;
          if (w <= 0) continue;
          const byte = buf[base + cols.first + i];
          atlas.blit(ctx, isGap(byte) ? GAP_GLYPH : byte, xL, yTop, w, h);
        }
      }
    }
  }

  /**
   * Density tier. One bar per visible column spanning the visible row band, with
   * the column's non-gap fraction as alpha over the (opaque) background. A
   * whole-column aggregate by design — it ignores the vertical scroll band, which
   * is the documented behavior for this tier.
   */
  private drawDensity(
    view: AlignmentView,
    vp: Viewport,
    cols: { first: number; last: number },
    rows: { first: number; last: number },
  ): void {
    const { ctx } = this;
    const dpr = this.dpr;
    const occ = this.ensureOccupancy(view);

    const yTop = Math.round(rowToY(vp, rows.first) * dpr);
    const yBot = Math.round(rowToY(vp, rows.last + 1) * dpr);
    const h = yBot - yTop;
    if (h <= 0) return;

    ctx.fillStyle = this.scheme.densityStyle;
    for (let col = cols.first; col <= cols.last; col++) {
      const xL = Math.round(colToX(vp, col) * dpr);
      const xR = Math.round(colToX(vp, col + 1) * dpr);
      const w = xR - xL;
      if (w <= 0) continue;
      const a = occ[col];
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillRect(xL, yTop, w, h);
    }
    ctx.globalAlpha = 1;
  }

  // ---- caches ------------------------------------------------------------

  private ensureAtlas(): GlyphAtlas {
    if (this.atlas && this.atlas.matches(this.scheme, this.dpr)) return this.atlas;
    this.atlas?.dispose();
    this.atlas = new GlyphAtlas(this.scheme, this.dpr);
    return this.atlas;
  }

  /** Per-row trailing-gap start column, computed once per loaded view (cheap unless
   *  rows are mostly gaps; scans from the right). Drives drawing trailing padding as
   *  blank background; dropped by `invalidateContentCaches` after an in-place edit. */
  private ensureTrailingStart(view: AlignmentView): Int32Array {
    if (this.trailView === view && this.trailStart) return this.trailStart;
    this.trailStart = trailingGapStarts(view.buffer, view.width, view.numRows);
    this.trailView = view;
    return this.trailStart;
  }

  /** Per-column non-gap fraction, computed once per loaded view (O(width×rows)). */
  private ensureOccupancy(view: AlignmentView): Float32Array {
    if (this.occView === view && this.occ) return this.occ;
    const width = view.width;
    const rows = view.numRows;
    const buf = view.buffer;
    const occ = new Float32Array(width);
    for (let r = 0; r < rows; r++) {
      const base = r * width;
      for (let c = 0; c < width; c++) {
        if (!isGap(buf[base + c])) occ[c] += 1;
      }
    }
    if (rows > 0) {
      for (let c = 0; c < width; c++) occ[c] /= rows;
    }
    this.occ = occ;
    this.occView = view;
    return occ;
  }
}
