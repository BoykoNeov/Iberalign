// The status bar: the persistent readout strip pinned at the bottom of the grid
// shell. It shows two things:
//   - the hovered cell across the two coordinate spaces the spec surfaces for M2
//     — the alignment **column** (1-based) and the per-sequence **ungapped
//     position** (1-based, `—` at a gap) — plus the sequence name and residue. It
//     is deliberately NOT labelled "length": the gapped width is the column
//     count, never a length (see the `position-readout-coordinates` memo).
//   - a persistent **zoom** control + readout, pinned to the right: the cell size
//     in CSS px, then a slider. The slider is the pointer-free way to zoom
//     (ctrl/⌘+scroll is the other); it is logarithmic so equal travel is equal
//     zoom *ratio*, matching the wheel's exponential feel, and it is controlled by
//     the live `zoom` so wheel-zoom moves the thumb too. The slider is rendered
//     LAST so it sits hard against the bar's right edge: its screen position is
//     then independent of the readout text width (which changes as digits tick),
//     so dragging it never makes it jump out from under the cursor.
//
// Presentational. The hover segments re-render only when the hovered cell changes
// (Grid throttles `setHover` to cell identity); the zoom segment re-renders on a
// zoom change (rounded px from the wheel, every input from the slider drag so the
// thumb tracks exactly) — coarse, user-event-driven, never per frame. The grid
// canvas keeps drawing on its own rAF loop regardless.

import type { HoverInfo } from "./hover";
import { MIN_CELL, MAX_CELL } from "../state/viewport";

// The zoom slider is logarithmic: equal travel = equal zoom *ratio*. Endpoints
// are the cell-size bounds from `viewport.ts`. MIN_CELL = 1 ⇒ log 0 sits at the
// LEFT end = most zoomed out; the right end is the largest cell = most zoomed in.
const LOG_MIN = Math.log(MIN_CELL);
const LOG_MAX = Math.log(MAX_CELL);

const ZOOM_HELP =
  "Zoom — how many screen pixels each alignment cell uses. " +
  "Drag the slider, or hold Ctrl/⌘ and scroll over the grid, to zoom.";

interface StatusBarProps {
  /** The hovered cell, or `null` when the pointer is off the grid. */
  hover: HoverInfo | null;
  /** Current cell size in CSS px (the zoom level); see `state/viewport.ts`. */
  zoom: number;
  /** Zoom to a target cell size in CSS px (the slider); anchored at the viewport
   *  centre by `Grid`. */
  onZoomTo: (cellW: number) => void;
}

export default function StatusBar({ hover, zoom, onZoomTo }: StatusBarProps) {
  const zoomPx = Math.round(zoom * 10) / 10;
  // Clamp before log so a hair past the bounds can't push the thumb off-track.
  const sliderValue = Math.log(Math.min(MAX_CELL, Math.max(MIN_CELL, zoom)));

  // Readout first, slider last — see the file header: slider-last pins the slider
  // to the right edge so the readout's changing width can't shift it.
  const zoomGroup = (
    <span className="status-zoom-group">
      <span className="status-seg status-zoom" title={ZOOM_HELP}>
        <span className="status-label">zoom</span> {zoomPx} px/cell
      </span>
      <input
        type="range"
        className="status-zoom-slider"
        min={LOG_MIN}
        max={LOG_MAX}
        step={0.001}
        value={sliderValue}
        onChange={(e) => onZoomTo(Math.exp(Number(e.currentTarget.value)))}
        aria-label="Zoom"
        title={ZOOM_HELP}
      />
    </span>
  );

  if (!hover) {
    return (
      <div className="grid-status">
        <span className="status-seg grid-status-idle">
          Hover a cell for its column, position, and residue.
        </span>
        {zoomGroup}
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
      {zoomGroup}
    </div>
  );
}
