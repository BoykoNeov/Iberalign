// Overlay scrollbars as a `Drawable` layer. It owns no canvas — it positions two
// floating thumb <div>s over the grid (one per axis) by mutating their style each
// dirty frame, so they stay frame-synced with pan/zoom on the same rAF loop as
// the grid and chrome (no React re-render, no tearing). The thumbs FLOAT over the
// canvas edges (no reserved layout track), so the viewport extent is unchanged.
//
// Geometry is all in `render/scrollbar.ts` (pure, unit-tested); this layer is the
// thin DOM-applying adapter. Drag interaction lives in `Grid.tsx`, which recomputes
// the same `layoutScrollbars` against the live viewport — both sides share one
// geometry source so a drag round-trips exactly.

import type { AlignmentView } from "../model/view";
import type { Dims, Viewport } from "../state/viewport";
import type { Drawable } from "./Renderer";
import { layoutScrollbars, type AxisScrollbar } from "./scrollbar";

export class ScrollbarsLayer implements Drawable {
  constructor(
    private readonly vThumb: HTMLElement,
    private readonly hThumb: HTMLElement,
  ) {}

  draw(view: AlignmentView, vp: Viewport): void {
    const dims: Dims = { cols: view.width, rows: view.numRows };
    const { v, h } = layoutScrollbars(vp, dims);
    applyVertical(this.vThumb, v);
    applyHorizontal(this.hThumb, h);
  }
}

// Position the vertical thumb: it rides the right edge, travelling top→bottom. The
// track origin is the cell top, so `thumbPos` is the thumb's CSS top directly.
function applyVertical(el: HTMLElement, sb: AxisScrollbar): void {
  if (!sb.visible) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.style.height = `${sb.thumbLen}px`;
  el.style.transform = `translateY(${sb.thumbPos}px)`;
}

// Position the horizontal thumb: it rides the bottom edge, travelling left→right.
function applyHorizontal(el: HTMLElement, sb: AxisScrollbar): void {
  if (!sb.visible) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.style.width = `${sb.thumbLen}px`;
  el.style.transform = `translateX(${sb.thumbPos}px)`;
}
