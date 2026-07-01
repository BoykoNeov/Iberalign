// The Colors dialog (custom per-residue palette) — a modal that lets the user
// recolor each residue's CELL fill and its LETTER ink for the active alphabet. Pure
// view state: coloring never crosses the IPC seam (architecture invariant), so this
// only reports palette changes up to `Grid`, which rebuilds the effective scheme and
// pushes it to the renderers live. No OK/Cancel — every pick applies immediately;
// per-residue ↺ and "Reset all" drop overrides; "Done" just closes.
//
// PER ALPHABET. `Grid` keeps a separate palette (base scheme id + overrides) for DNA
// / RNA / Protein; this dialog edits whichever the loaded file uses. For nucleotide
// alphabets a "Link DNA & RNA" toggle (default on) shares one palette across both;
// unlinking seeds RNA from DNA and lets them diverge.
//
// Chrome (backdrop/card/header/footer/buttons + drag-to-move + Esc) reuses the
// consensus dialog's classes so the two read as one app; the swatch grid is the only
// dialog-specific styling (`ColorsDialog.css`).

import { useEffect, useRef, useState } from "react";
import {
  resolveResidue,
  rgbToHex,
  hexToRgb,
  type ColorScheme,
  type PaletteOverrides,
  type ResidueOverride,
} from "../render/colors";
import "./ConsensusDialog.css";
import "./ColorsDialog.css";

interface ColorsDialogProps {
  /** The alignment's alphabet (shown in the header). */
  alphabet: string;
  /** Residue letters to show swatches for (nucleotides or the 20 amino acids). */
  residues: readonly string[];
  /** The active alphabet's BASE scheme (overrides layer on top of it). */
  base: ColorScheme;
  /** All selectable base schemes (the base-palette dropdown). */
  schemes: ColorScheme[];
  /** The active base scheme's id. */
  baseId: string;
  /** Change the base scheme for the active alphabet. */
  onSetBase: (id: string) => void;
  /** The active alphabet's per-residue overrides. */
  overrides: PaletteOverrides;
  /** Report a changed residue override; `null` resets that residue to the base. */
  onOverrideChange: (residue: string, override: ResidueOverride | null) => void;
  /** Drop every override for the active alphabet. */
  onResetAll: () => void;
  /** Whether to show the Link DNA & RNA toggle (nucleotide alphabets only). */
  showLink: boolean;
  /** Whether DNA & RNA currently share one palette. */
  linked: boolean;
  /** Toggle the DNA/RNA link (unlinking seeds RNA from DNA in `Grid`). */
  onToggleLink: () => void;
  /** Close the modal (no state change). */
  onClose: () => void;
}

export default function ColorsDialog({
  alphabet,
  residues,
  base,
  schemes,
  baseId,
  onSetBase,
  overrides,
  onOverrideChange,
  onResetAll,
  showLink,
  linked,
  onToggleLink,
  onClose,
}: ColorsDialogProps) {
  // Esc closes (capture phase + stopPropagation, so it pre-empts the grid's window
  // key handler — same discipline as ConsensusDialog).
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

  // Drag-to-move by the header (pointer-capture), identical to ConsensusDialog.
  const headRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const onHeadPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, select")) return;
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

  // Merge a partial change into a residue's existing override (so setting the ink
  // doesn't wipe a custom fill, and vice-versa).
  const patch = (residue: string, part: ResidueOverride) => {
    const cur = overrides[residue] ?? {};
    onOverrideChange(residue, { ...cur, ...part });
  };

  const anyOverride = residues.some((ch) => {
    const o = overrides[ch];
    return o && (o.fill || o.ink);
  });

  return (
    <div
      className="cons-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="cons-card col-card"
        role="dialog"
        aria-modal="true"
        aria-label="Colors"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="cons-head"
          ref={headRef}
          onPointerDown={onHeadPointerDown}
          onPointerMove={onHeadPointerMove}
          onPointerUp={onHeadPointerUp}
        >
          <span className="cons-title">Colors</span>
          <span className="cons-alpha">{alphabet}</span>
          <button type="button" className="cons-x" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="cons-body">
          <div className="cons-row">
            <span className="cons-rowlabel">Base palette</span>
            <select
              className="col-select"
              value={baseId}
              onChange={(e) => onSetBase(e.target.value)}
              title="The starting palette; your per-residue colors layer on top of it"
            >
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {showLink && (
            <div className="cons-row">
              <span className="cons-rowlabel">Link DNA &amp; RNA</span>
              <label className="col-check" title="Share one nucleotide palette across DNA and RNA. Unlink to color RNA separately (it starts from the current DNA colors).">
                <input type="checkbox" checked={linked} onChange={onToggleLink} />
                <span>{linked ? "Shared palette" : "Separate palettes"}</span>
              </label>
            </div>
          )}

          <div className="col-section">Residue colors</div>

          {/* Column headers for the swatch grid. */}
          <div className="col-grid col-grid-head" aria-hidden="true">
            <span />
            <span>Cell</span>
            <span>Letter</span>
            <span />
          </div>

          <div className="col-swatches">
            {residues.map((ch) => {
              const { fill, ink } = resolveResidue(base, overrides, ch);
              const o = overrides[ch];
              const customized = !!(o && (o.fill || o.ink));
              return (
                <div className="col-grid col-swatch-row" key={ch}>
                  <span
                    className="col-preview"
                    style={{ background: rgbToHex(fill), color: rgbToHex(ink) }}
                    aria-label={`${ch} preview`}
                  >
                    {ch}
                  </span>
                  <input
                    type="color"
                    className="col-picker"
                    value={rgbToHex(fill)}
                    onChange={(e) => patch(ch, { fill: hexToRgb(e.target.value) })}
                    title={`Cell color for ${ch}`}
                    aria-label={`Cell color for ${ch}`}
                  />
                  <input
                    type="color"
                    className="col-picker"
                    value={rgbToHex(ink)}
                    onChange={(e) => patch(ch, { ink: hexToRgb(e.target.value) })}
                    title={`Letter color for ${ch}`}
                    aria-label={`Letter color for ${ch}`}
                  />
                  <button
                    type="button"
                    className="col-reset"
                    disabled={!customized}
                    onClick={() => onOverrideChange(ch, null)}
                    title={customized ? `Reset ${ch} to the base palette` : `${ch} is unchanged`}
                    aria-label={`Reset ${ch}`}
                  >
                    ↺
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="cons-foot">
          <button
            type="button"
            className="cons-btn"
            onClick={onResetAll}
            disabled={!anyOverride}
            title={anyOverride ? "Drop every custom color for this alphabet" : "No custom colors to reset"}
          >
            Reset all
          </button>
          <button type="button" className="cons-btn cons-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
