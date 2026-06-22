// The status bar: the persistent readout strip pinned at the bottom of the grid
// shell. It shows the hovered cell across the two coordinate spaces the spec
// surfaces for M2 — the alignment **column** (1-based) and the per-sequence
// **ungapped position** (1-based, `—` at a gap) — plus the sequence name and the
// residue. It is deliberately NOT labelled "length": the gapped width is the
// column count, never a length (see the `position-readout-coordinates` memo).
//
// Presentational + per-cell. It re-renders only when the hovered cell changes
// (Grid throttles `setHover` to cell identity), so this is "re-render on a
// readout value change", not per frame — the grid canvas keeps drawing on its
// own rAF loop regardless.

import type { HoverInfo } from "./hover";

interface StatusBarProps {
  /** The hovered cell, or `null` when the pointer is off the grid. */
  hover: HoverInfo | null;
}

export default function StatusBar({ hover }: StatusBarProps) {
  if (!hover) {
    return (
      <div className="grid-status grid-status-idle">
        Hover a cell for its column, position, and residue.
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
    </div>
  );
}
