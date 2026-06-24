// The pinned track lane (chrome between the ruler and the grid). It hosts the
// CONSENSUS row: one IUPAC consensus byte per alignment column, COLUMN-ALIGNED to
// the grid and scroll-synced under it. The consensus is computed over ALL rows
// (Batch 2 is a whole-alignment overview; selection-scoped consensus is Batch 3's
// copy concern), so it is independent of the cursor/selection and never recomputes
// during a drag.
//
// PIXEL ALIGNMENT. The lane shares the grid's `1fr` column, so screen x=0 matches
// the grid and `colToX(vp, col)` put through the grid's `Math.round(x * dpr)` snaps
// each consensus cell dead on its column at every zoom — the same contract the
// ruler uses.
//
// LOD. Like the grid: at the letter tier each cell gets a color fill + the
// consensus glyph (blitted from a `GlyphAtlas`, never `fillText` per cell); at the
// block/density tiers just the color fill (one `fillRect` per visible column), so
// the conserved/variable structure still reads when zoomed out.
//
// CACHE. The consensus array is memoized by view IDENTITY (a new load = a new view
// ⇒ recompute). An in-place edit mutates the buffer without changing the view
// object, so `invalidate()` must be called after an edit (mirrors the renderer's
// occupancy cache + the minimap aggregate).

import type { AlignmentView } from "../model/view";
import { type Dims, type Viewport } from "../state/viewport";
import { colToX, visibleCols } from "./viewport";
import { lodFor } from "./lod";
import { columnConsensus } from "../model/consensus";
import { GlyphAtlas } from "./glyphs";
import { type ColorScheme, defaultScheme } from "./colors";
import { CHROME } from "./chrome";

// One cell of overscan so a partly-scrolled edge cell is fully drawn.
const OVERSCAN = 1;

export class TrackLaneRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scheme: ColorScheme;
  private dpr = 1;
  private atlas: GlyphAtlas | null = null;

  // Consensus bytes (length = view.width), memoized by view identity.
  private consView: AlignmentView | null = null;
  private cons: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement, scheme: ColorScheme = defaultScheme()) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("TrackLaneRenderer: 2D context unavailable");
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

  /** Drop the cached consensus after an in-place edit (same view object, mutated
   *  buffer). Call before marking the store dirty, mirroring the renderer's
   *  `invalidateContentCaches` and the minimap's `invalidate`. */
  invalidate(): void {
    this.cons = null;
    this.consView = null;
  }

  draw(view: AlignmentView, vp: Viewport): void {
    const { ctx, dpr } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CHROME.bg;
    ctx.fillRect(0, 0, cw, ch);

    // Bottom separator (flush against the grid below), matching the ruler's edge.
    const lw = Math.max(1, Math.round(dpr));
    const sepY = ch - lw;
    ctx.fillStyle = CHROME.line;
    ctx.fillRect(0, sepY, cw, lw);

    if (view.width === 0 || view.numRows === 0) return; // nothing to summarize

    const cons = this.ensureConsensus(view);
    const dims: Dims = { cols: view.width, rows: view.numRows };
    const cols = visibleCols(vp, dims, OVERSCAN);
    if (cols.last < cols.first) return;

    const letters = lodFor(vp.cellW) === "letter";
    const atlas = letters ? this.ensureAtlas() : null;

    const h = sepY; // the consensus row fills the lane above the separator
    for (let col = cols.first; col <= cols.last; col++) {
      const xL = Math.round(colToX(vp, col) * dpr);
      const xR = Math.round(colToX(vp, col + 1) * dpr);
      const w = xR - xL;
      if (w <= 0) continue;
      const byte = cons[col];
      // Color fill: A/C/G/T → their vivid base color; ambiguity codes (R/Y/N…) →
      // the scheme's grey fallback (reads as "mixed"); `-` → gap grey.
      ctx.fillStyle = this.scheme.fillStyleFor(byte);
      ctx.fillRect(xL, 0, w, h);
      // Glyph (letter tier): a square tile centered in the cell so the letter is
      // not stretched by the lane's non-square cells (cellW wide × ~18px tall).
      if (atlas) {
        const s = Math.min(w, h);
        const gx = xL + Math.round((w - s) / 2);
        const gy = Math.round((h - s) / 2);
        atlas.blit(ctx, byte, gx, gy, s, s);
      }
    }
  }

  dispose(): void {
    this.atlas?.dispose();
    this.atlas = null;
    this.cons = null;
    this.consView = null;
  }

  private ensureAtlas(): GlyphAtlas {
    if (this.atlas && this.atlas.matches(this.scheme, this.dpr)) return this.atlas;
    this.atlas?.dispose();
    this.atlas = new GlyphAtlas(this.scheme, this.dpr);
    return this.atlas;
  }

  private ensureConsensus(view: AlignmentView): Uint8Array {
    if (this.consView === view && this.cons) return this.cons;
    this.cons = columnConsensus(view, 0, view.numRows - 1);
    this.consView = view;
    return this.cons;
  }
}
