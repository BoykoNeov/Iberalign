// The translation result modal (DNA/RNA → protein, Phase 3) — a READ-ONLY look at
// the translated protein for the selected block. This is the thin Q1=B display: the
// DNA/RNA alignment stays the single source of truth; this dialog just shows the
// derived protein rows (no editing, no re-alignment). Phase 4 graduates it to a real
// switchable "protein subwindow" with palette coloring.
//
// PRESENTATIONAL: it owns no translation state — `Grid` runs the `translate_block`
// IPC over the current selection + gap mode and hands the finished rows in. Esc /
// the × / a backdrop click close it (no other keyboard — nothing to edit). The
// header doubles as a drag handle (same pointer-capture pattern as the other
// dialogs) so a wide translation can be moved off the region it covers.

import { useEffect, useRef, useState } from "react";
import type { TranslateMode } from "../ipc/translate";
import "./TranslateDialog.css";

interface TranslateRow {
  /** The source sequence's display name (may be empty for an unnamed record). */
  name: string;
  /** The translated protein residues (trailing-gap-padded to a common width). */
  seq: string;
}

interface TranslateDialogProps {
  /** The gap mode the block was translated with (for the header badge). */
  mode: TranslateMode;
  /** The 0-based inclusive column window `[c0, c1]` that was translated (shown
   *  1-based in the header for context). */
  cols: [number, number];
  /** The translated rows, paired 1:1 with the selected sequences in order. */
  rows: TranslateRow[];
  /** Close the modal. */
  onClose: () => void;
}

export default function TranslateDialog({ mode, cols, rows, onClose }: TranslateDialogProps) {
  // Esc closes. Capture phase + stopPropagation so it pre-empts the grid's window key
  // handler (also guarded by `Grid`'s `translateOpenRef`, belt and braces).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Drag-to-move — the same pointer-capture pattern as ConsensusDialog / the name
  // gutter. The card starts centered (the backdrop's flexbox); a drag on the header
  // translates it by an accumulated offset. Resets each open (conditionally mounted).
  const headRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const onHeadPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // not the close button
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
    headRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onHeadPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPos({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) });
  };
  const onHeadPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current && headRef.current?.hasPointerCapture(e.pointerId)) {
      headRef.current.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  const modeLabel = mode === "degap" ? "Degap → translate" : "Codon-through";
  const n = rows.length;

  return (
    <div
      className="tr-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="tr-card"
        role="dialog"
        aria-modal="true"
        aria-label="Translation"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="tr-head"
          ref={headRef}
          onPointerDown={onHeadPointerDown}
          onPointerMove={onHeadPointerMove}
          onPointerUp={onHeadPointerUp}
        >
          <span className="tr-title">Translation</span>
          <span className="tr-badge">{modeLabel}</span>
          <button type="button" className="tr-x" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="tr-sub">
          Standard code (NCBI&nbsp;1) · cols {cols[0] + 1}–{cols[1] + 1} · {n}{" "}
          sequence{n === 1 ? "" : "s"}
        </div>

        <div className="tr-body">
          {rows.map((r, i) => (
            <div className="tr-row" key={i}>
              <span className="tr-name" title={r.name || "(unnamed)"}>
                {r.name || <span className="tr-unnamed">(unnamed)</span>}
              </span>
              <span className="tr-seq">{r.seq}</span>
            </div>
          ))}
        </div>

        <div className="tr-foot">
          <button type="button" className="tr-btn tr-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
