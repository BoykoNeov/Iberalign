// The pinned column ruler (top chrome). Draws 1-based ALIGNMENT-COLUMN numbers
// for the visible window — never ungapped positions (that mapping is the status
// bar's job). Driven by the same `GridStore` + rAF loop as the grid, so it stays
// frame-synced under pan/zoom with no tearing.
//
// PIXEL ALIGNMENT. Tick x's come from the grid's own `colToX` put through the
// same `Math.round(x * dpr)` the grid uses for column edges, so a tick sits dead
// on the column it labels at every zoom (a locally-rolled transform would drift a
// pixel). The ruler shares the grid's `1fr` column, so screen x=0 is the same in
// both — reusing `colToX` is all that's needed.
//
// LABEL THINNING is anchored to the ABSOLUTE column index (`(col + 1) % step`),
// not to the first visible column, so numbers don't renumber/jitter as you pan.

import type { AlignmentView } from "../model/view";
import type { Dims, Viewport } from "../state/viewport";
import { colToX, visibleCols } from "./viewport";
import { niceLabelStep } from "./ticks";
import { CHROME, MIN_LABEL_PX } from "./chrome";

export class RulerRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("RulerRenderer: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, dpr: number = globalThis.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(0, Math.round(cssW * dpr));
    this.canvas.height = Math.max(0, Math.round(cssH * dpr));
  }

  draw(view: AlignmentView, vp: Viewport): void {
    const { ctx, dpr } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CHROME.bg;
    ctx.fillRect(0, 0, cw, ch);

    // Bottom separator (sits flush against the grid).
    const lw = Math.max(1, Math.round(dpr));
    const sepY = ch - lw;
    ctx.fillStyle = CHROME.line;
    ctx.fillRect(0, sepY, cw, lw);

    const dims: Dims = { cols: view.width, rows: view.numRows };
    const cols = visibleCols(vp, dims, 1);
    if (cols.last < cols.first) return;

    const step = niceLabelStep(vp.cellW, MIN_LABEL_PX);
    const tickLen = Math.round(4 * dpr);
    const fontPx = Math.round(11 * dpr);
    ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = Math.round((ch - tickLen) / 2);

    for (let col = cols.first; col <= cols.last; col++) {
      if ((col + 1) % step !== 0) continue;
      // Column center in device px, from the SAME transform as the grid cells.
      const xCenter = Math.round((colToX(vp, col) + vp.cellW / 2) * dpr);
      ctx.fillStyle = CHROME.line;
      ctx.fillRect(xCenter - Math.floor(lw / 2), sepY - tickLen, lw, tickLen);
      ctx.fillStyle = CHROME.ink;
      ctx.fillText(String(col + 1), xCenter, labelY);
    }
  }

  dispose(): void {
    /* no retained resources */
  }
}
