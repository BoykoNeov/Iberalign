// The grid toolbar: selection-scoped actions pinned above the grid. Today it
// holds the copy controls — the `Sel: C × R` readout, the Copy button, and the
// Raw|FASTA format toggle — plus an ephemeral status message ("Copied …" / a
// size warning). It is where the paste/cut controls will join (Batches C/D).
//
// Presentational: all state (the selection mirror, the chosen format, the
// message) lives in `Grid`; this renders props and calls handlers. It re-renders
// only on coarse events (a selection-rect change, a format toggle, a copy), never
// per frame — the canvas keeps drawing on its own rAF loop.

import type { CopyFormat } from "../model/copy";
import "./Toolbar.css";

interface ToolbarProps {
  /** The selection size for the readout, or `null` when nothing is selected. */
  selInfo: { rows: number; cols: number } | null;
  /** The active copy format (the Raw|FASTA toggle). */
  copyFormat: CopyFormat;
  onSetFormat: (format: CopyFormat) => void;
  /** Copy the current selection (a no-op upstream when nothing is selected). */
  onCopy: () => void;
  /** Ephemeral feedback ("Copied 3 × 12", a size warning), or `null`. */
  message: string | null;
}

export default function Toolbar({
  selInfo,
  copyFormat,
  onSetFormat,
  onCopy,
  message,
}: ToolbarProps) {
  const hasSel = selInfo !== null;
  return (
    <div className="grid-toolbar">
      <span className="toolbar-seg toolbar-sel">
        {hasSel ? (
          <>
            <span className="toolbar-label">sel</span> {selInfo.cols} cols × {selInfo.rows} seqs
          </>
        ) : (
          <span className="toolbar-muted">no selection</span>
        )}
      </span>

      <button
        type="button"
        className="toolbar-btn"
        onClick={onCopy}
        disabled={!hasSel}
        title="Copy the selected block to the clipboard (Ctrl/⌘+C)"
      >
        Copy
      </button>

      <span className="toolbar-toggle" role="group" aria-label="Copy format">
        <button
          type="button"
          className={copyFormat === "raw" ? "toggle-on" : ""}
          aria-pressed={copyFormat === "raw"}
          onClick={() => onSetFormat("raw")}
          title="Copy raw residues — one sequence per line, no headers"
        >
          Raw
        </button>
        <button
          type="button"
          className={copyFormat === "fasta" ? "toggle-on" : ""}
          aria-pressed={copyFormat === "fasta"}
          onClick={() => onSetFormat("fasta")}
          title="Copy as FASTA — a >name header before each sequence"
        >
          FASTA
        </button>
      </span>

      {message && (
        <span className="toolbar-msg" aria-live="polite">
          {message}
        </span>
      )}
    </div>
  );
}
