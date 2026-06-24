// The pinned track lane (chrome between the ruler and the grid). In M4 it hosts
// the consensus row + conservation/entropy track, COLUMN-ALIGNED to the grid and
// scroll-synced under it. In M2 there is no analysis data, so this paints only the
// chrome background + separators — but it is a FULL `Drawable` on the shared rAF
// loop, sized and driven exactly like the ruler, so M4 drops its track drawing in
// here with the scroll-sync + pixel alignment already wired.
//
// PIXEL ALIGNMENT (ready for M4). The lane shares the grid's `1fr` column, so
// screen x=0 matches the grid and `colToX(vp, col)` put through the grid's
// `Math.round(x * dpr)` snaps any future per-column track mark dead on its column
// at every zoom — the same contract the ruler uses. M2 draws nothing per column,
// but the seam is the point of building the painter now.

import type { AlignmentView } from "../model/view";
import type { Viewport } from "../state/viewport";
import { CHROME } from "./chrome";

export class TrackLaneRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("TrackLaneRenderer: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, dpr: number = globalThis.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(0, Math.round(cssW * dpr));
    this.canvas.height = Math.max(0, Math.round(cssH * dpr));
  }

  // `view`/`vp` are unused while the lane is empty, but kept in the signature: the
  // loop calls every `Drawable` with them, and M4's track drawing reads both (the
  // buffer for consensus/conservation, the viewport for `colToX` alignment).
  draw(_view: AlignmentView, _vp: Viewport): void {
    const { ctx, dpr } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CHROME.bg;
    ctx.fillRect(0, 0, cw, ch);

    // Bottom separator (flush against the grid below), matching the ruler's edge.
    const lw = Math.max(1, Math.round(dpr));
    ctx.fillStyle = CHROME.line;
    ctx.fillRect(0, ch - lw, cw, lw);
  }

  dispose(): void {
    /* no retained resources */
  }
}
