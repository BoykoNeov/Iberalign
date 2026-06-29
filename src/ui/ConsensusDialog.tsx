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

import { useEffect } from "react";
import {
  consensusControlsEnabled,
  type ConsensusConfig,
  type GapHandling,
  type AgreementRule,
  type SameTypeDisplay,
  type SameTypeMaxBases,
  type NoConsensus,
} from "../model/consensus";
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
  /** Close the modal (no state change). */
  onClose: () => void;
}

export default function ConsensusDialog({
  config,
  alphabet,
  isDefault,
  onChange,
  onReset,
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
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cons-head">
          <span className="cons-title">Consensus options</span>
          <span className="cons-alpha">{alphabet}</span>
          <button type="button" className="cons-x" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="cons-body">
          <div className="cons-row">
            <span className="cons-rowlabel">Gap handling</span>
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
            <span className="cons-rowlabel">Agreement rule</span>
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
            <span className="cons-rowlabel" data-off={!enabled.sameTypeDisplay}>
              Same-type display
            </span>
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
            <span className="cons-rowlabel" data-off={!enabled.sameTypeMaxBases}>
              IUPAC class cutoff
            </span>
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
            <span className="cons-rowlabel" data-off={!enabled.majorityThreshold}>
              Majority threshold
            </span>
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
            <span className="cons-rowlabel" data-off={!enabled.noConsensus}>
              No-consensus fallback
            </span>
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
