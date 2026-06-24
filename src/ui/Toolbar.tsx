// The grid toolbar: selection-scoped actions pinned above the grid. It holds the
// copy controls — the `Sel: C × R` readout, the Copy button, the Raw|FASTA copy-
// format toggle — the paste controls — the Paste button, an Insert|Overwrite mode
// toggle, and (for Insert) a shift-scope toggle: shift the Pasted rows only vs All
// rows — and the cut controls — the Cut button and a Shorten|Mask mode toggle —
// plus an ephemeral status message ("Copied …" / "Inserted …" / "Cut …" / a
// warning).
//
// Presentational: all state (the selection mirror, the chosen format/mode, the
// message) lives in `Grid`; this renders props and calls handlers. It re-renders
// only on coarse events (a selection-rect change, a toggle, a copy/paste/cut),
// never per frame — the canvas keeps drawing on its own rAF loop.

import type { CopyFormat } from "../model/copy";
import "./Toolbar.css";

/** Raw block paste mode: insert (shift columns right) or overwrite cells in place. */
export type PasteMode = "insert" | "overwrite";

/** Cut mode: shorten (delete columns + shift the cut rows left) or mask (clear to
 *  gaps). Default shorten. */
export type CutMode = "shorten" | "mask";

interface ToolbarProps {
  /** The selection size for the readout, or `null` when nothing is selected. */
  selInfo: { rows: number; cols: number } | null;
  /** The active copy format (the Raw|FASTA toggle). */
  copyFormat: CopyFormat;
  onSetFormat: (format: CopyFormat) => void;
  /** The active raw-paste mode (the Insert|Overwrite toggle). */
  pasteMode: PasteMode;
  onSetPasteMode: (mode: PasteMode) => void;
  /** Insert shift scope: `true` shifts all rows (keeps columns aligned), `false`
   *  (default) shifts only the pasted rows. Only applies in Insert mode. */
  shiftAll: boolean;
  onSetShiftAll: (v: boolean) => void;
  /** The active cut mode (the Shorten|Mask toggle). */
  cutMode: CutMode;
  onSetCutMode: (mode: CutMode) => void;
  /** Copy the current selection (a no-op upstream when nothing is selected). */
  onCopy: () => void;
  /** Paste the clipboard (FASTA ⇒ new sequences; else a block in the paste mode). */
  onPaste: () => void;
  /** Cut the current selection to the clipboard (no-op upstream when nothing is
   *  selected) — copy then remove, in the cut mode. */
  onCut: () => void;
  /** Ephemeral feedback with a tone (`warn` ⇒ bold red, lingers), or `null`. */
  message: { text: string; tone: "info" | "warn" } | null;
}

export default function Toolbar({
  selInfo,
  copyFormat,
  onSetFormat,
  pasteMode,
  onSetPasteMode,
  shiftAll,
  onSetShiftAll,
  cutMode,
  onSetCutMode,
  onCopy,
  onPaste,
  onCut,
  message,
}: ToolbarProps) {
  const hasSel = selInfo !== null;
  // The shift-scope toggle only applies to an Insert paste; disable (don't hide,
  // to avoid reflowing the strip) it in Overwrite mode.
  const shiftDisabled = pasteMode !== "insert";
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

      <button
        type="button"
        className="toolbar-btn"
        onClick={onPaste}
        title="Paste the clipboard (Ctrl/⌘+V) — FASTA inserts new sequences; a raw block uses the mode at right"
      >
        Paste
      </button>

      <span className="toolbar-toggle" role="group" aria-label="Raw paste mode">
        <button
          type="button"
          className={pasteMode === "insert" ? "toggle-on" : ""}
          aria-pressed={pasteMode === "insert"}
          onClick={() => onSetPasteMode("insert")}
          title="Insert a pasted block — the alignment grows in width (use the shift toggle to keep all rows aligned)"
        >
          Insert
        </button>
        <button
          type="button"
          className={pasteMode === "overwrite" ? "toggle-on" : ""}
          aria-pressed={pasteMode === "overwrite"}
          onClick={() => onSetPasteMode("overwrite")}
          title="Overwrite cells in place; grow the width only if the block runs past the right edge"
        >
          Overwrite
        </button>
      </span>

      <span className="toolbar-label">shift</span>
      <span className="toolbar-toggle" role="group" aria-label="Insert shift scope">
        <button
          type="button"
          className={!shiftAll ? "toggle-on" : ""}
          aria-pressed={!shiftAll}
          disabled={shiftDisabled}
          onClick={() => onSetShiftAll(false)}
          title="Shift only the pasted rows right — columns to the right go ragged (Insert only)"
        >
          Pasted
        </button>
        <button
          type="button"
          className={shiftAll ? "toggle-on" : ""}
          aria-pressed={shiftAll}
          disabled={shiftDisabled}
          onClick={() => onSetShiftAll(true)}
          title="Insert gaps in every row so the columns stay aligned (Insert only)"
        >
          All
        </button>
      </span>

      <button
        type="button"
        className="toolbar-btn"
        onClick={onCut}
        disabled={!hasSel}
        title="Cut the selection to the clipboard (Ctrl/⌘+X) — copy, then remove in the mode at right"
      >
        Cut
      </button>

      <span className="toolbar-toggle" role="group" aria-label="Cut mode">
        <button
          type="button"
          className={cutMode === "shorten" ? "toggle-on" : ""}
          aria-pressed={cutMode === "shorten"}
          onClick={() => onSetCutMode("shorten")}
          title="Shorten — delete the selected columns and shift the cut rows left (the alignment keeps its width)"
        >
          Shorten
        </button>
        <button
          type="button"
          className={cutMode === "mask" ? "toggle-on" : ""}
          aria-pressed={cutMode === "mask"}
          onClick={() => onSetCutMode("mask")}
          title="Mask — clear the selected cells to gaps (like Delete, but the cells are copied first)"
        >
          Mask
        </button>
      </span>

      {message && (
        <span
          className={message.tone === "warn" ? "toolbar-msg warn" : "toolbar-msg"}
          aria-live="polite"
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
