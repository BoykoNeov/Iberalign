// The consensus options dialog (Phase 3) — a real modal that configures how the
// consensus track's per-column byte is derived. PRESENTATIONAL: it owns no
// consensus state; it renders the *effective* config (`Grid`'s override, or the
// alphabet default when none) and reports every change up via `onChange`. The
// changes apply LIVE — `Grid` rederives the track from the cached buffer with no
// IPC (consensus is a derived view; Rust still owns the truth) — so there is no
// OK/Cancel: each toggle takes effect immediately; "Reset to default" drops the
// override; "Done" just closes.
//
// The pipeline it edits (see `model/consensus.ts`): gap handling → agreement rule
// → no-consensus fallback, with two same-type sub-modes. Irrelevant sub-controls
// are DISABLED (not hidden — hiding would reflow the card) per
// `consensusControlsEnabled`, which mirrors exactly which fields the engine reads.

import { useEffect, useRef, useState } from "react";
import {
  consensusControlsEnabled,
  type ConsensusConfig,
  type GapHandling,
  type AgreementRule,
  type SameTypeDisplay,
  type SameTypeMaxBases,
  type NoConsensus,
} from "../model/consensus";
import {
  coloringControlsEnabled,
  type ColoringConfig,
  type TrackColoring,
  type GridColoring,
  type ConservationDenominator,
  type HighlightStyle,
} from "../model/coloring";
import "./ConsensusDialog.css";

interface SegOption<T extends string | number> {
  value: T;
  label: string;
  title?: string;
}

/** A segmented single-choice control (mirrors the toolbar's `.toolbar-toggle`).
 *  Disabled segments keep their active fill so the remembered choice still reads,
 *  just inactive — matching the toolbar's disabled-toggle convention. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <span className="cons-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={value === o.value ? "seg-on" : ""}
          aria-pressed={value === o.value}
          disabled={disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A left-column row label carrying an inline ⓘ help glyph. Hovering the glyph
 *  shows a native tooltip (`title`) explaining what that row's options do — the same
 *  affordance the per-segment `title`s give, raised to the row level so the meaning
 *  of the whole control is discoverable without trying each segment. `off` dims the
 *  label when its control is disabled, matching the segmented control's inactive look. */
function RowLabel({ text, help, off }: { text: string; help: string; off?: boolean }) {
  return (
    <span className="cons-rowlabel" data-off={off ? "true" : undefined}>
      {text}
      <span
        className="cons-help"
        role="img"
        tabIndex={0}
        aria-label={`${text}: ${help}`}
        title={help}
      >
        ⓘ
      </span>
    </span>
  );
}

interface ConsensusDialogProps {
  /** The effective config to render — `Grid`'s override, or the alphabet default
   *  when no override is active. */
  config: ConsensusConfig;
  /** The alignment's alphabet, shown for context (and why the default differs). */
  alphabet: string;
  /** True when no override is active (the track follows the alphabet default) —
   *  disables "Reset to default". */
  isDefault: boolean;
  /** Report a changed config (the whole object) — `Grid` stores it as the override
   *  and rederives the track live. */
  onChange: (next: ConsensusConfig) => void;
  /** Drop the override → back to the alphabet default. */
  onReset: () => void;
  /** The active coloring config (track + main-grid coloring modes). Not
   *  alphabet-dependent, so it has no "default" reset here — the modes are picked
   *  directly. */
  coloring: ColoringConfig;
  /** Report a changed coloring config — `Grid` applies it live to both renderers. */
  onColoringChange: (next: ColoringConfig) => void;
  /** Close the modal (no state change). */
  onClose: () => void;
}

export default function ConsensusDialog({
  config,
  alphabet,
  isDefault,
  onChange,
  onReset,
  coloring,
  onColoringChange,
  onClose,
}: ConsensusDialogProps) {
  // Esc closes. Capture phase + stopPropagation so it pre-empts the grid's window
  // key handler (which is also guarded by `Grid`'s `consensusOpenRef`, belt and
  // braces) and the message-clear listeners.
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

  const enabled = consensusControlsEnabled(config);
  // Patch one field and report the whole next config up (live-apply).
  const set = <K extends keyof ConsensusConfig>(k: K, v: ConsensusConfig[K]) =>
    onChange({ ...config, [k]: v });

  const pct = Math.round(config.majorityThreshold * 100);

  // Coloring section: same live-apply pattern over the separate ColoringConfig.
  const cEnabled = coloringControlsEnabled(coloring);
  const setC = <K extends keyof ColoringConfig>(k: K, v: ColoringConfig[K]) =>
    onColoringChange({ ...coloring, [k]: v });
  const consPct = Math.round(coloring.conservationThreshold * 100);

  // Drag-to-move. The card starts centered (the backdrop's flexbox); a drag on the
  // header translates it by an accumulated offset. Pointer capture on the header
  // (the same pattern the name-gutter selection uses) keeps the move/up events
  // flowing even if the pointer leaves the header or the webview — so a fast drag
  // can't get stuck. The offset resets on each open (the dialog is conditionally
  // mounted). Dragging never starts from the × button (it's a <button>).
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
        className="cons-card"
        role="dialog"
        aria-modal="true"
        aria-label="Consensus options"
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
          <span className="cons-title">Consensus &amp; coloring</span>
          <span className="cons-alpha">{alphabet}</span>
          <button type="button" className="cons-x" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="cons-body">
          <div className="cons-row">
            <RowLabel
              text="Gap handling"
              help="How gaps in a column affect its consensus — ignore them entirely, or force a gap / a * whenever any cell in the column is a gap."
            />
            <Segmented<GapHandling>
              label="Gap handling"
              value={config.gap}
              onChange={(v) => set("gap", v)}
              options={[
                { value: "ignore", label: "Ignore", title: "Gaps don't affect the consensus (the rule sees only the non-gap residues)" },
                { value: "gap-priority", label: "Gap if any", title: "Any gap in the column ⇒ the consensus is a gap" },
                { value: "star-if-gap", label: "* if any", title: "Any gap in the column ⇒ the consensus is *" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="Agreement rule"
              help="How the consensus letter is chosen from the residues present: a strict IUPAC union code, all-identical only, a same-type code, or a simple majority."
            />
            <Segmented<AgreementRule>
              label="Agreement rule"
              value={config.rule}
              onChange={(v) => set("rule", v)}
              options={[
                { value: "strict-iupac", label: "Strict IUPAC", title: "The IUPAC code for the union of every base present (always a code)" },
                { value: "all-identical", label: "All identical", title: "A residue only if the whole column shares it; else the fallback" },
                { value: "same-type", label: "Same type", title: "A code when every base is one type (purine/pyrimidine or one IUPAC class)" },
                { value: "majority", label: "Majority", title: "The top residue when it exceeds the threshold; else the fallback" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="Same-type display"
              off={!enabled.sameTypeDisplay}
              help="When the Same-type rule applies, what symbol to show: R/Y, the most common base, or the IUPAC class code (S/W/K/M…)."
            />
            <Segmented<SameTypeDisplay>
              label="Same-type display"
              value={config.sameTypeDisplay}
              disabled={!enabled.sameTypeDisplay}
              onChange={(v) => set("sameTypeDisplay", v)}
              options={[
                { value: "ry-code", label: "R / Y", title: "Show R for an all-purine column, Y for an all-pyrimidine column" },
                { value: "majority-base", label: "Top base", title: "Same purine/pyrimidine test, but show the most common base" },
                { value: "iupac-class", label: "IUPAC class", title: "Show the IUPAC class code (S/W/K/M…) when the column is one class" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="IUPAC class cutoff"
              off={!enabled.sameTypeMaxBases}
              help="For Same-type / IUPAC class: the largest set of distinct bases still treated as one class (≤2 → S/W/K/M only; ≤3 → also B/D/H/V)."
            />
            <Segmented<SameTypeMaxBases>
              label="IUPAC class cutoff"
              value={config.sameTypeMaxBases}
              disabled={!enabled.sameTypeMaxBases}
              onChange={(v) => set("sameTypeMaxBases", v)}
              options={[
                { value: 2, label: "≤ 2 bases", title: "Only two-base classes (S/W/K/M) count as one type; 3+ bases ⇒ fallback" },
                { value: 3, label: "≤ 3 bases", title: "Also admit the three-base classes (B/D/H/V); only all four bases ⇒ fallback" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="Majority threshold"
              off={!enabled.majorityThreshold}
              help="For the Majority rule: the fraction of the non-gap residues the top residue must exceed to become the consensus. 0% = always the most common (plurality)."
            />
            <span className="cons-threshold">
              &gt;
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={pct}
                disabled={!enabled.majorityThreshold}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const clamped = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
                  set("majorityThreshold", clamped / 100);
                }}
                title="The top residue must exceed this fraction of the non-gap residues (strictly more than). 0% = plurality (always the most common)."
              />
              %
            </span>
          </div>

          <div className="cons-row">
            <RowLabel
              text="No-consensus fallback"
              off={!enabled.noConsensus}
              help="What to emit for a column when the rule finds no consensus — a gap (–) or a star (*)."
            />
            <Segmented<NoConsensus>
              label="No-consensus fallback"
              value={config.noConsensus}
              disabled={!enabled.noConsensus}
              onChange={(v) => set("noConsensus", v)}
              options={[
                { value: "gap", label: "Gap –", title: "Emit a gap when the rule finds no consensus" },
                { value: "star", label: "Star *", title: "Emit * when the rule finds no consensus" },
              ]}
            />
          </div>

          <div className="cons-section">Coloring</div>

          <div className="cons-row">
            <RowLabel
              text="Consensus track"
              help={
                "Coloring of the consensus lane.\n" +
                "Full — colour every cell by its residue.\n" +
                "Glyph only — letter on a neutral fill, no colour.\n" +
                "Conserved — colour only conserved columns; variable ones stay grey (the letter still shows).\n" +
                "Variable — the inverse: colour only the non-conserved columns.\n" +
                "“Conserved” uses the Conserved-at threshold + basis below. The Highlight option does NOT apply here."
              }
            />
            <Segmented<TrackColoring>
              label="Consensus track coloring"
              value={coloring.track}
              onChange={(v) => setC("track", v)}
              options={[
                { value: "full", label: "Full", title: "Color every consensus cell by its byte" },
                { value: "none", label: "Glyph only", title: "Draw the consensus letter on a neutral fill (no color)" },
                { value: "consensus-only", label: "Conserved", title: "Color only the conserved columns; leave the rest neutral" },
                { value: "nonconsensus-only", label: "Variable", title: "Color only the variable columns; leave the conserved ones neutral" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="Main grid"
              help={
                "Coloring of the sequence cells.\n" +
                "By residue — every cell by its residue.\n" +
                "Conservation — keep the colour in conserved columns, fade the rest to grey.\n" +
                "Match / Mismatch — highlight cells equal to / different from their column's consensus; fade the rest.\n" +
                "With Highlight = Residue, Conservation looks just like By residue except the variable columns turn grey. The Highlight option below applies to these grid modes only — not to the track."
              }
            />
            <Segmented<GridColoring>
              label="Main grid coloring"
              value={coloring.grid}
              onChange={(v) => setC("grid", v)}
              options={[
                { value: "by-residue", label: "By residue", title: "The per-residue palette (default)" },
                { value: "by-conservation", label: "Conservation", title: "Keep the color in conserved columns; fade the rest" },
                { value: "match-consensus", label: "Match", title: "Highlight cells equal to their column's consensus; fade the rest" },
                { value: "mismatch-consensus", label: "Mismatch", title: "Highlight cells that DIFFER from the consensus (the variants); fade the matches" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="Conserved at"
              off={!cEnabled.conservation}
              help="A column counts as “conserved” when its most-common residue reaches at least this fraction of the rows. Drives the grid's Conservation mode and the track's Conserved / Variable modes."
            />
            <span className="cons-threshold">
              ≥
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={consPct}
                disabled={!cEnabled.conservation}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const clamped = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
                  setC("conservationThreshold", clamped / 100);
                }}
                title="A column counts as conserved when its most-common residue reaches at least this fraction of the rows (see the basis). Drives the Conservation grid mode and the Conserved/Variable track modes."
              />
              %
            </span>
          </div>

          <div className="cons-row">
            <RowLabel
              text="Conservation basis"
              off={!cEnabled.conservation}
              help="What the conserved fraction is measured against: all rows (gaps count against conservation) or only the non-gap rows (agreement among the residues actually present)."
            />
            <Segmented<ConservationDenominator>
              label="Conservation basis"
              value={coloring.conservationDenominator}
              disabled={!cEnabled.conservation}
              onChange={(v) => setC("conservationDenominator", v)}
              options={[
                { value: "all-rows", label: "All rows", title: "Divide by every row, so gaps count against conservation" },
                { value: "non-gap", label: "Non-gap", title: "Divide by the non-gap rows only — agreement among the residues present" },
              ]}
            />
          </div>

          <div className="cons-row">
            <RowLabel
              text="Highlight"
              off={!cEnabled.highlightStyle}
              help="How highlighted (kept) cells render in the grid's Conservation / Match / Mismatch modes: their own residue colour, or one flat uniform colour. The faded side is always grey. Grid only — the consensus track ignores this."
            />
            <Segmented<HighlightStyle>
              label="Highlight style"
              value={coloring.highlightStyle}
              disabled={!cEnabled.highlightStyle}
              onChange={(v) => setC("highlightStyle", v)}
              options={[
                { value: "residue", label: "Residue color", title: "Highlighted cells keep their per-residue color; the rest fade to grey" },
                { value: "uniform", label: "Uniform", title: "Highlighted cells get one flat color; the rest fade to grey" },
              ]}
            />
          </div>
        </div>

        <div className="cons-foot">
          <button
            type="button"
            className="cons-btn"
            onClick={onReset}
            disabled={isDefault}
            title={
              isDefault
                ? "Already at the default for this alphabet"
                : "Drop your changes — follow the default for this alphabet"
            }
          >
            Reset to default
          </button>
          <button type="button" className="cons-btn cons-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
