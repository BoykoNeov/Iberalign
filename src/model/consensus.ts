// Per-column consensus for the track lane (and, later, track copy). Pure: it
// reads the frontend's render-buffer view (Rust still owns the truth — consensus
// is a DERIVED view, not authoritative state) and returns one consensus byte per
// column. Computed frontend-side so a row-range scope costs no IPC — the same
// reason `copy.ts` builds clipboard text here.
//
// DNA/RNA → STRICT (presence-union) IUPAC ambiguity codes (user's choice,
// 2026-06-24): a base joins a column's code if ANY non-gap residue in the row
// range contains it — no threshold. Ambiguity codes already in the data expand to
// their component bases (so an `R` contributes A and G). An all-gap column → `-`.
// RNA emits `U` for the pure-T code (`T` and `U` share bit 8; only the single-base
// code differs). Strict union is intentionally sensitive — any column with all
// four bases shows `N`; that is the trade-off the user accepted.
//
// Protein → PLURALITY (most common non-gap residue; IUPAC ambiguity is
// nucleotide-only). Counting is case-insensitive; ties break to the smallest byte
// so the result is order-independent; an all-gap column → `-`.

import type { AlignmentView } from "./view";
import { isGap } from "./coords";

const A = 1;
const C = 2;
const G = 4;
const T = 8; // U shares this bit

const GAP = 0x2d; // '-'
const T_BYTE = 0x54; // 'T'
const U_BYTE = 0x55; // 'U'

// IUPAC consensus letter indexed by the 4-bit base set (0..15). Index 0 is the
// empty set → `-` (an all-gap column). e.g. 0b0101 (A|G) → index 5 → `R`.
const IUPAC = "-ACMGRSVTWYHKDBN";

// Residue byte → component-base bitmask. Ambiguity codes expand to their bases;
// gaps / unknown bytes → 0 (contribute nothing). Both cases share a mask.
const BASE_MASK = buildBaseMask();

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
function toUpperByte(byte: number): number {
  return byte >= 0x61 && byte <= 0x7a ? byte - 0x20 : byte;
}

/**
 * Per-column consensus bytes for rows `[r0, r1]` of `view`, as a `Uint8Array` of
 * length `view.width`. `r0`/`r1` are clamped to `[0, numRows-1]` and may be given
 * in either order. Pure and O((rows in range) × width); the caller caches it
 * (recompute on load / edit / row-range change — never per frame).
 *
 * DNA/RNA → strict IUPAC ambiguity codes; Protein (and any other alphabet) →
 * plurality. See the module comment for the exact rules.
 */
export function columnConsensus(view: AlignmentView, r0: number, r1: number): Uint8Array {
  const width = view.width;
  const out = new Uint8Array(width);
  const lo = Math.max(0, Math.min(r0, r1));
  const hi = Math.min(view.numRows - 1, Math.max(r0, r1));
  if (width === 0 || hi < lo) {
    out.fill(GAP); // nothing in range → all-gap consensus
    return out;
  }
  const alphabet = view.meta.alphabet;
  if (alphabet === "DNA" || alphabet === "RNA") {
    return nucleotideConsensus(view, lo, hi, out, alphabet === "RNA");
  }
  return pluralityConsensus(view, lo, hi, out);
}

// Strict IUPAC: OR each column's base bits over the row range, then map the set to
// its ambiguity letter. RNA rewrites the pure-T result to `U` (only mask 8 yields
// `T`, so a byte rewrite is exact — multi-base codes never produce `T`).
function nucleotideConsensus(
  view: AlignmentView,
  lo: number,
  hi: number,
  out: Uint8Array,
  rna: boolean,
): Uint8Array {
  const width = view.width;
  const buf = view.buffer;
  const masks = new Uint8Array(width);
  for (let r = lo; r <= hi; r++) {
    const base = r * width;
    for (let c = 0; c < width; c++) masks[c] |= BASE_MASK[buf[base + c]];
  }
  for (let c = 0; c < width; c++) {
    const m = masks[c];
    let byte = m === 0 ? GAP : IUPAC.charCodeAt(m);
    if (rna && byte === T_BYTE) byte = U_BYTE;
    out[c] = byte;
  }
  return out;
}

// Plurality: most common non-gap residue per column (case-folded), ties → the
// smallest byte so the answer is independent of row order. `counts` is reused
// across columns and reset via the `touched` list (cheap: ≤ alphabet-size resets).
function pluralityConsensus(
  view: AlignmentView,
  lo: number,
  hi: number,
  out: Uint8Array,
): Uint8Array {
  const width = view.width;
  const buf = view.buffer;
  const counts = new Uint32Array(256);
  for (let c = 0; c < width; c++) {
    const touched: number[] = [];
    for (let r = lo; r <= hi; r++) {
      const raw = buf[r * width + c];
      if (isGap(raw)) continue;
      const b = toUpperByte(raw);
      if (counts[b] === 0) touched.push(b);
      counts[b]++;
    }
    if (touched.length === 0) {
      out[c] = GAP;
      continue;
    }
    let maxCount = 0;
    for (const b of touched) if (counts[b] > maxCount) maxCount = counts[b];
    let best = 0;
    for (const b of touched) {
      if (counts[b] === maxCount && (best === 0 || b < best)) best = b;
      counts[b] = 0; // reset for the next column
    }
    out[c] = best;
  }
  return out;
}
