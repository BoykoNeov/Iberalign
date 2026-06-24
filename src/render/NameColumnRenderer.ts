// The pinned name column (left chrome). Draws each visible row's sequence name,
// vertically aligned to its grid row. Driven by the same `GridStore` + rAF loop
// as the grid, so it scroll-syncs vertically with no tearing.
//
// PIXEL ALIGNMENT. Row y's come from the grid's own `rowToY` put through the same
// `Math.round(y * dpr)` the grid uses for row edges, so a name sits centered on
// its row at every zoom. The name column shares the grid's `1fr` row, so screen
// y=0 matches — reusing `rowToY` is all that's needed.
//
// Long names are truncated by a CLIP REGION, not `fillText`'s `maxWidth` (which
// would squish the glyphs horizontally instead of cutting them off).

import type { AlignmentView } from "../model/view";
import type { Dims, Viewport } from "../state/viewport";
import { normalize, type Selection, type SelectionMode } from "../state/selection";
import { rowToY, visibleRows } from "./viewport";
import { CHROME, NAME_PAD } from "./chrome";

export class NameColumnRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  /**
   * @param getSelection / @param getMode  Optional accessors (same pattern as
   *   `SelectionLayer`) read each dirty frame. When a ROWS-mode selection is
   *   active, the selected rows' name bands invert (swap bg↔ink), so it's visible
   *   that whole sequences are selected. Cell-/cols-mode selections leave the
   *   names plain (the grid rectangle / the ruler show those).
   */
  constructor(
    canvas: HTMLCanvasElement,
    private readonly getSelection?: () => Selection | null,
    private readonly getMode?: () => SelectionMode,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("NameColumnRenderer: 2D context unavailable");
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

    // Right separator (flush against the grid).
    const lw = Math.max(1, Math.round(dpr));
    ctx.fillStyle = CHROME.line;
    ctx.fillRect(cw - lw, 0, lw, ch);

    const dims: Dims = { cols: view.width, rows: view.numRows };
    const rows = visibleRows(vp, dims, 1);
    if (rows.last < rows.first) return;

    // Row-mode selection → the selected rows' bands invert. `r0..r1` is the
    // selected row span (or an empty range when not in rows-mode).
    const sel = this.getMode?.() === "rows" ? (this.getSelection?.() ?? null) : null;
    const rect = sel ? normalize(sel) : null;
    const r0 = rect ? rect.r0 : -1;
    const r1 = rect ? rect.r1 : -1;
    const textW = cw - lw; // exclude the separator column

    // Paint the inverted (dark) band under the selected, visible names first.
    if (rect) {
      ctx.fillStyle = CHROME.ink;
      const from = Math.max(rows.first, r0);
      const to = Math.min(rows.last, r1);
      for (let row = from; row <= to; row++) {
        const yTop = Math.round(rowToY(vp, row) * dpr);
        const yBot = Math.round(rowToY(vp, row + 1) * dpr);
        ctx.fillRect(0, yTop, textW, yBot - yTop);
      }
    }

    const fontPx = Math.round(12 * dpr);
    ctx.font = `${fontPx}px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const padDev = Math.round(NAME_PAD * dpr);

    // Clip to the text area (excluding the separator) so long names truncate.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, textW, ch);
    ctx.clip();
    for (let row = rows.first; row <= rows.last; row++) {
      const yTop = Math.round(rowToY(vp, row) * dpr);
      const yBot = Math.round(rowToY(vp, row + 1) * dpr);
      // Selected rows draw their name in the bg color (light) over the dark band.
      ctx.fillStyle = row >= r0 && row <= r1 ? CHROME.bg : CHROME.ink;
      ctx.fillText(view.nameAt(row), padDev, Math.round((yTop + yBot) / 2));
    }
    ctx.restore();
  }

  dispose(): void {
    /* no retained resources */
  }
}
