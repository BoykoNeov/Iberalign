// Per-column profile — the shared "what is present in each column" backbone that
// the consensus pipeline (#5), the consensus-track coloring (#6), and the
// main-grid conservation coloring (#8) all read. Computed once per (view,
// row-range); `consensus.ts` turns a profile into the consensus bytes, and
// (Phase 4) the colorings read `topCount / nonGap` straight off it. Pure: it
// reads the frontend's render-buffer view (Rust still owns the truth — every
// derived view here is non-authoritative).
//
// Compact by design. Per column we keep only: non-gap / gap counts, the
// most-common non-gap residue (uppercase) + its count, the number of distinct
// non-gap residues, and the OR of nucleotide base-bits over the residues present.
// That set is provably sufficient for every consensus rule AND both colorings —
// full per-residue histograms are never needed and are not stored (recompute if a
// per-residue tooltip ever lands). At ~15 bytes/column this stays trivial even at
// the 10k-column stress ceiling.

import type { AlignmentView } from "./view";
import { isGap } from "./coords";

// Nucleotide base bits. T and U share bit 8 — uracil ≡ thymine for base identity,
// so a profile carries no T/U distinction; `consensus.ts` re-derives `U` for RNA.
export const A = 1;
export const C = 2;
export const G = 4;
export const T = 8;
export const PURINE = A | G; // 5  — {A,G}
export const PYRIMIDINE = C | T; // 10 — {C,T/U}

// Residue byte → component-base bitmask. Ambiguity codes expand to their bases
// (so an `R` contributes A and G); gaps / unknown / non-nucleotide bytes → 0
// (they contribute nothing to the base set). Both cases share a mask.
export const BASE_MASK = buildBaseMask();

function buildBaseMask(): Uint8Array {
  const m = new Uint8Array(256);
  const set = (ch: string, bits: number) => {
    m[ch.charCodeAt(0)] = bits;
    m[ch.toLowerCase().charCodeAt(0)] = bits;
  };
  set("A", A);
  set("C", C);
  set("G", G);
  set("T", T);
  set("U", T);
  set("R", A | G);
  set("Y", C | T);
  set("S", C | G);
  set("W", A | T);
  set("K", G | T);
  set("M", A | C);
  set("B", C | G | T);
  set("D", A | G | T);
  set("H", A | C | T);
  set("V", A | C | G);
  set("N", A | C | G | T);
  return m;
}

/** ASCII-uppercase a byte (`a`..`z` → `A`..`Z`); other bytes pass through. */
export function toUpperByte(byte: number): number {
  return byte >= 0x61 && byte <= 0x7a ? byte - 0x20 : byte;
}

/**
 * Per-column residue profile over a row range. Structure-of-arrays, each of
 * length `width`; column `c` reads index `c` of every array.
 */
export interface ColumnProfiles {
  /** Number of columns (== `view.width` at compute time). */
  readonly width: number;
  /** Count of non-gap residues in the column (over the row range). */
  readonly nonGap: Uint32Array;
  /** Count of gaps in the column (`range rows − nonGap`). */
  readonly gap: Uint32Array;
  /** Most-common non-gap residue, ASCII-uppercased; ties break to the smallest
   *  byte so the result is row-order-independent. `0` iff the column is all-gap. */
  readonly topByte: Uint8Array;
  /** Count of `topByte` in the column. `0` iff the column is all-gap. */
  readonly topCount: Uint32Array;
  /** Number of distinct non-gap residue bytes (case-folded), capped at 255. */
  readonly distinct: Uint8Array;
  /** OR of `BASE_MASK` over the residues present — the 4-bit base set (0..15).
   *  `0` for an all-gap column OR a column of only non-nucleotide residues. */
  readonly baseMask: Uint8Array;
}

/**
 * Build the per-column profile for rows `[r0, r1]` of `view`. `r0`/`r1` are
 * clamped to `[0, numRows-1]` and may be given in either order (mirrors
 * `columnConsensus`). Pure and O((rows in range) × width); the caller decides
 * caching (today's track caches the consensus bytes by view identity — see
 * `consensus.ts`; profile caching is Phase 4 when the colorings share it).
 *
 * An empty or out-of-range view yields all-zero arrays (length `width`).
 */
export function columnProfiles(view: AlignmentView, r0: number, r1: number): ColumnProfiles {
  const width = view.width;
  const profiles: ColumnProfiles = {
    width,
    nonGap: new Uint32Array(width),
    gap: new Uint32Array(width),
    topByte: new Uint8Array(width),
    topCount: new Uint32Array(width),
    distinct: new Uint8Array(width),
    baseMask: new Uint8Array(width),
  };
  const lo = Math.max(0, Math.min(r0, r1));
  const hi = Math.min(view.numRows - 1, Math.max(r0, r1));
  if (width === 0 || hi < lo) return profiles; // empty / out-of-range → all zeros
  const rangeRows = hi - lo + 1;
  const buf = view.buffer;

  // One 256-wide count table reused across columns, reset via the `touched` list
  // (≤ distinct-residues resets per column — cheap). Column-major (outer col,
  // inner row): per-column counts can't coexist for every column at once, so we
  // pay the buffer stride to keep memory O(alphabet), not O(width × 256).
  const counts = new Uint32Array(256);
  for (let c = 0; c < width; c++) {
    const touched: number[] = [];
    let ng = 0;
    for (let r = lo; r <= hi; r++) {
      const raw = buf[r * width + c];
      if (isGap(raw)) continue;
      const b = toUpperByte(raw);
      if (counts[b] === 0) touched.push(b);
      counts[b]++;
      ng++;
    }
    profiles.nonGap[c] = ng;
    profiles.gap[c] = rangeRows - ng;
    profiles.distinct[c] = Math.min(touched.length, 255);

    // Top residue (max count, smallest byte on a tie) + base-set union; reset.
    let best = 0;
    let bestCount = 0;
    let mask = 0;
    for (const b of touched) {
      const n = counts[b];
      if (n > bestCount || (n === bestCount && (best === 0 || b < best))) {
        bestCount = n;
        best = b;
      }
      mask |= BASE_MASK[b];
      counts[b] = 0; // reset for the next column
    }
    profiles.topByte[c] = best;
    profiles.topCount[c] = bestCount;
    profiles.baseMask[c] = mask;
  }
  return profiles;
}
