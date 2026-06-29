// Per-column consensus: turn a `ColumnProfiles` (see `profile.ts`) into one
// consensus byte per column under a configurable, ORDERED pipeline. Pure and
// frontend-side (Rust still owns the truth — consensus is a DERIVED view), the
// same reason `copy.ts`/`profile.ts` compute here: a row-range scope costs no IPC.
//
// The pipeline (advisor-confirmed backbone) runs per column:
//   1. Gap handling — short-circuit, checked FIRST:
//        gap-priority  → any gap in the column ⇒ emit `-`
//        star-if-gap   → any gap in the column ⇒ emit `*`
//        ignore        → fall through (the default; today's behavior)
//   2. No non-gap residues ⇒ `-` (so every rule below sees nonGap ≥ 1).
//   3. Agreement rule, on the non-gap residues:
//        strict-iupac  → the IUPAC code for the union of bases present (always a
//                        code; an all-non-nucleotide column → `-`, a legacy quirk
//                        kept deliberately).
//        all-identical → one distinct residue ⇒ that residue, else fallback.
//        same-type     → ry-code   : all purine ⇒ `R` / all pyrimidine ⇒ `Y`
//                        majority-base: same test, but show the top base
//                        iupac-class: ≤ `sameTypeMaxBases` distinct bases ⇒ their
//                        IUPAC code (else fallback). The cutoff is user-chosen in
//                        the Phase-3 dialog: 2 (S/W/K/M) or 3 (also B/D/H/V); it
//                        must cut below 4 or it would be identical to strict-iupac.
//        majority      → top residue exceeds the threshold (strict `>`) ⇒ top,
//                        else fallback. Integer-exact (see THRESHOLD_SCALE).
//   3'. Fallback (`noConsensus`): `-` or `*`, for the identical/same-type/majority
//       rules only — strict-iupac always yields a code.
//
// RNA: any rule that decodes a base MASK through the IUPAC table (strict-iupac
// AND same-type/iupac-class) emits `T` for the pure-T bit and is rewritten to `U`
// by `decodeMask`. The top-residue rules (majority, majority-base, all-identical)
// already emit `U` straight from the data, so they need no rewrite.

import type { AlignmentView } from "./view";
import type { AlphabetLabel } from "./types";
import { columnProfiles, type ColumnProfiles, PURINE, PYRIMIDINE } from "./profile";

const GAP = 0x2d; // '-'
const STAR = 0x2a; // '*'
const R_BYTE = 0x52; // 'R' — purine
const Y_BYTE = 0x59; // 'Y' — pyrimidine
const T_BYTE = 0x54; // 'T'
const U_BYTE = 0x55; // 'U'

// IUPAC consensus letter indexed by the 4-bit base set (0..15). Index 0 (the
// empty set) is `-`. e.g. 0b0101 (A|G) → index 5 → `R`.
const IUPAC = "-ACMGRSVTWYHKDBN";

export type GapHandling = "ignore" | "gap-priority" | "star-if-gap";
export type AgreementRule = "strict-iupac" | "all-identical" | "same-type" | "majority";
export type SameTypeDisplay = "ry-code" | "majority-base" | "iupac-class";
export type NoConsensus = "gap" | "star";
/** Max distinct bases a column may hold and still count as one "type" under the
 *  `same-type`/`iupac-class` display: `2` (two-base codes S/W/K/M) or `3` (also
 *  the three-base codes B/D/H/V). Must stay below 4 or `iupac-class` would equal
 *  strict-IUPAC. User-chosen in the Phase-3 dialog; default 2. */
export type SameTypeMaxBases = 2 | 3;

/** Consensus pipeline configuration. See the module comment for the ordering. */
export interface ConsensusConfig {
  /** Step 1: gap short-circuit. */
  gap: GapHandling;
  /** Step 3: agreement rule on the non-gap residues. */
  rule: AgreementRule;
  /** Display sub-mode for `rule === "same-type"` (ignored otherwise). */
  sameTypeDisplay: SameTypeDisplay;
  /** Distinct-base cutoff for `sameTypeDisplay === "iupac-class"` (ignored
   *  otherwise): `2` keeps only two-base classes, `3` also admits B/D/H/V. */
  sameTypeMaxBases: SameTypeMaxBases;
  /** Fraction in `[0, 1]`, strict-greater, for `rule === "majority"` (default
   *  0.5 = ">50%"). Compared integer-exactly at 0.1% granularity. */
  majorityThreshold: number;
  /** Step 3' fallback when a non-strict rule finds no consensus. Ignored under
   *  strict-iupac (which always yields a code). */
  noConsensus: NoConsensus;
}

/** Which optional sub-controls a config actually consults — the dialog disables
 *  (not hides) the rest so an irrelevant toggle can't read as active. Mirrors the
 *  pipeline exactly: a field is "enabled" iff `consensusBytes` reads it. */
export interface ControlsEnabled {
  /** `sameTypeDisplay` matters only under the same-type rule. */
  sameTypeDisplay: boolean;
  /** `sameTypeMaxBases` matters only for same-type + iupac-class display. */
  sameTypeMaxBases: boolean;
  /** `majorityThreshold` matters only under the majority rule. */
  majorityThreshold: boolean;
  /** `noConsensus` fallback applies to every rule EXCEPT strict-iupac (which
   *  always yields a code). */
  noConsensus: boolean;
}

/** The set of config sub-controls that the current `rule`/`display` actually
 *  consult (see `ControlsEnabled`). Pure; the dialog drives its disabled states
 *  from this so they can never drift from what the pipeline reads. */
export function consensusControlsEnabled(config: ConsensusConfig): ControlsEnabled {
  const sameType = config.rule === "same-type";
  return {
    sameTypeDisplay: sameType,
    sameTypeMaxBases: sameType && config.sameTypeDisplay === "iupac-class",
    majorityThreshold: config.rule === "majority",
    noConsensus: config.rule !== "strict-iupac",
  };
}

// Majority threshold granularity. The comparison is integer (`topCount * SCALE >
// round(threshold * SCALE) * nonGap`) so a strict `>` has predictable boundaries
// — fp `topCount/nonGap > threshold` mis-rounds e.g. 3/5 vs 0.6. 0.1% is finer
// than any percentage UI needs.
const THRESHOLD_SCALE = 1000;

/** Decode a 4-bit base mask to its IUPAC letter, rewriting the pure-T result to
 *  `U` for RNA (only mask 8 yields `T`; multi-base codes never produce `T`). */
function decodeMask(mask: number, rna: boolean): number {
  const byte = IUPAC.charCodeAt(mask & 0x0f);
  return rna && byte === T_BYTE ? U_BYTE : byte;
}

/** Population count of a 4-bit base mask (number of distinct bases present). */
function popcount4(mask: number): number {
  const m = mask & 0x0f;
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

// same-type display resolution. `mask === 0` (only non-nucleotide residues) → no
// type → fallback. Purine/pyrimidine membership is "every base bit is inside the
// group" (a single base counts: an all-A column is a purine column).
function sameType(
  display: SameTypeDisplay,
  mask: number,
  topByte: number,
  rna: boolean,
  fallback: number,
  maxBases: SameTypeMaxBases,
): number {
  if (mask === 0) return fallback;
  const purine = (mask & ~PURINE & 0x0f) === 0;
  const pyrimidine = (mask & ~PYRIMIDINE & 0x0f) === 0;
  switch (display) {
    case "ry-code":
      if (purine) return R_BYTE;
      if (pyrimidine) return Y_BYTE;
      return fallback;
    case "majority-base":
      return purine || pyrimidine ? topByte : fallback;
    case "iupac-class":
      // ≤ maxBases distinct bases ⇒ a single IUPAC class (its 2-/3-way code or a
      // conserved base). `maxBases` is the user-confirmed cutoff (2 or 3).
      return popcount4(mask) <= maxBases ? decodeMask(mask, rna) : fallback;
  }
}

/**
 * Consensus bytes for `profiles` under `config`, as a `Uint8Array` of length
 * `profiles.width`. `alphabet` only selects the RNA `U` rewrite (any non-RNA
 * value leaves `T` as `T`). Pure; the caller caches the result.
 */
export function consensusBytes(
  profiles: ColumnProfiles,
  config: ConsensusConfig,
  alphabet: AlphabetLabel | string,
): Uint8Array {
  const { width, nonGap, gap, topByte, topCount, distinct, baseMask } = profiles;
  const out = new Uint8Array(width);
  const rna = alphabet === "RNA";
  const fallback = config.noConsensus === "star" ? STAR : GAP;
  const thr = Math.round(config.majorityThreshold * THRESHOLD_SCALE);

  for (let c = 0; c < width; c++) {
    // 1. Gap handling — short-circuit FIRST so star-if-gap reaches an all-gap col.
    if (gap[c] > 0) {
      if (config.gap === "gap-priority") {
        out[c] = GAP;
        continue;
      }
      if (config.gap === "star-if-gap") {
        out[c] = STAR;
        continue;
      }
      // "ignore" → fall through
    }
    // 2. No non-gap residues ⇒ '-' (guarantees the rules below see nonGap ≥ 1).
    if (nonGap[c] === 0) {
      out[c] = GAP;
      continue;
    }
    // 3. Agreement rule.
    const mask = baseMask[c];
    switch (config.rule) {
      case "strict-iupac":
        // Always a code; mask 0 (all non-nucleotide) → '-' (kept legacy quirk).
        out[c] = decodeMask(mask, rna);
        break;
      case "all-identical":
        out[c] = distinct[c] === 1 ? topByte[c] : fallback;
        break;
      case "same-type":
        out[c] = sameType(
          config.sameTypeDisplay,
          mask,
          topByte[c],
          rna,
          fallback,
          config.sameTypeMaxBases,
        );
        break;
      case "majority":
        out[c] = topCount[c] * THRESHOLD_SCALE > thr * nonGap[c] ? topByte[c] : fallback;
        break;
    }
  }
  return out;
}

// Back-compat default configs reproducing today's track behavior exactly:
// DNA/RNA → strict IUPAC presence-union; any other alphabet → plurality, which is
// `majority` at threshold 0 (strict `> 0` ⇒ always emit the top residue, and the
// profile's smallest-byte tiebreak matches the old plurality tie rule).
const STRICT_CONFIG: ConsensusConfig = {
  gap: "ignore",
  rule: "strict-iupac",
  sameTypeDisplay: "ry-code",
  sameTypeMaxBases: 2,
  majorityThreshold: 0.5,
  noConsensus: "gap",
};
const PLURALITY_CONFIG: ConsensusConfig = {
  gap: "ignore",
  rule: "majority",
  sameTypeDisplay: "ry-code",
  sameTypeMaxBases: 2,
  majorityThreshold: 0,
  noConsensus: "gap",
};

/** The default consensus config for an alphabet — DNA/RNA → strict IUPAC, anything
 *  else (Protein, unknown strings) → plurality. Mirrors today's `columnConsensus`
 *  branch; the Phase-3 dialog will let the user override this per alphabet. */
export function defaultConfigFor(alphabet: AlphabetLabel | string): ConsensusConfig {
  return alphabet === "DNA" || alphabet === "RNA" ? STRICT_CONFIG : PLURALITY_CONFIG;
}

/**
 * Per-column consensus bytes for rows `[r0, r1]` of `view` under the alphabet's
 * default config — the back-compat entry the consensus track uses. Bounds are
 * clamped and order-independent (see `columnProfiles`). Builds a transient
 * profile each call (profile caching is Phase 4); the track caches these bytes by
 * view identity. DNA/RNA → strict IUPAC ambiguity codes; Protein → plurality.
 */
export function columnConsensus(view: AlignmentView, r0: number, r1: number): Uint8Array {
  const profiles = columnProfiles(view, r0, r1);
  return consensusBytes(profiles, defaultConfigFor(view.meta.alphabet), view.meta.alphabet);
}
