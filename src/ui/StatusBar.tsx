// The status bar: the persistent readout strip pinned at the bottom of the grid
// shell. It shows two things:
//   - the hovered cell across the two coordinate spaces the spec surfaces for M2
//     — the alignment **column** (1-based) and the per-sequence **ungapped
//     position** (1-based, `—` at a gap) — plus the sequence name and residue. It
//     is deliberately NOT labelled "length": the gapped width is the column
//     count, never a length (see the `position-readout-coordinates` memo).
//   - a persistent **zoom** readout (cell size in CSS px + the current LOD tier),
//     pinned to the right. The tier name (`letter`/`block`/`density`) tells the
//     user which representation is on screen; `density` is the aggregate strip
//     drawn below 3 px/cell, where there is no per-cell glyph or color (the
//     "blue" seen when fully zoomed out).
//
// Presentational. The hover segments re-render only when the hovered cell changes
// (Grid throttles `setHover` to cell identity); the zoom segment only when the
// rounded px or the tier changes (Grid throttles `setZoom` on the same key) —
// both coarse, never per frame. The grid canvas keeps drawing on its own rAF loop
// regardless.

import type { HoverInfo } from "./hover";
import { lodFor } from "../render/lod";

interface StatusBarProps {
  /** The hovered cell, or `null` when the pointer is off the grid. */
  hover: HoverInfo | null;
  /** Current cell size in CSS px (the zoom level); see `state/viewport.ts`. */
  zoom: number;
}

export default function StatusBar({ hover, zoom }: StatusBarProps) {
  // Round for display, but derive the tier from the TRUE cell size so the label
  // stays honest with what the renderer drew (a value rounding to 3 may still be
  // density).
  const zoomPx = Math.round(zoom * 10) / 10;
  const tier = lodFor(zoom);
  const zoomSeg = (
    <span
      className="status-seg status-zoom"
      title="Cell size in CSS pixels (zoom). Below 3 px/cell the grid drops to the density tier: an aggregate strip, no per-cell glyph or color."
    >
      <span className="status-label">zoom</span> {zoomPx} px/cell · {tier}
    </span>
  );

  if (!hover) {
    return (
      <div className="grid-status">
        <span className="status-seg grid-status-idle">
          Hover a cell for its column, position, and residue.
        </span>
        {zoomSeg}
      </div>
    );
  }

  // Gap → no ungapped position; em dash, never a fabricated number.
  const position = hover.pos === null ? "—" : hover.pos;
  const residue = hover.isGap ? "gap" : hover.residue;

  return (
    <div className="grid-status">
      <span className="status-seg">
        <span className="status-label">column</span> {hover.col + 1}
      </span>
      <span className="status-seg">
        <span className="status-label">pos</span> {position}
      </span>
      <span className="status-seg status-name" title={hover.name}>
        {hover.name}
      </span>
      <span className="status-seg">
        <span className="status-label">residue</span> {residue}
      </span>
      {zoomSeg}
    </div>
  );
}
