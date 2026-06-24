// Build the clipboard text for a selected rectangle of the alignment. Pure: it
// reads the frontend's render-buffer view (Rust still owns the truth — copy is
// read-only) plus the row names, and returns the string the clipboard plugin
// writes. `raw` is WYSIWYG — the gaps (`-`) in the selected columns are KEPT, so
// the copied block is exactly the slice shown and a copy→paste round-trips back
// into the same columns. `fasta` DROPS each sequence's TRAILING-edge gaps (the
// right-pad that squares the matrix up to the alignment width is not biological),
// keeping INTERIOR gaps (those are alignment structure). A slice that is all gaps
// (an empty sequence) collapses to a bare `>name` header — the limit of the same
// rule — and pastes back as an empty, name-preserved sequence (FASTA paste inserts
// new sequences; see `commands.rs::paste_sequences`, which keeps empty records).
// The live matrix is untouched — it stays rectangular; this is serialization only.

import type { AlignmentView } from "./view";
import type { CellRect } from "../state/selection";

/** How the selected block is serialized for the clipboard. */
export type CopyFormat = "raw" | "fasta";

/**
 * Largest selection (in cells) we serialize to the clipboard. Select-all on the
 * 10k×10k stress fixture is ~100M cells; building and writing a string that big
 * would freeze the UI, so above this cap the caller warns instead of copying.
 * Far above any real selection — the design target is far smaller than the stress
 * ceiling (CLAUDE.md). The builder itself is unguarded (so it stays trivially
 * testable); the cap lives here as the feature's natural home.
 */
export const COPY_CELL_CAP = 10_000_000;

// One decoder for all rows: the selected bytes are ASCII residues/gaps (every
// byte < 128, so UTF-8 decodes them 1:1), and TextDecoder handles arbitrarily
// long rows without the call-stack limit `String.fromCharCode(...spread)` hits.
const DECODER = new TextDecoder();

/** The selected columns of one row as a residue string (gaps kept). */
function rowResidues(view: AlignmentView, row: number, c0: number, c1: number): string {
  return DECODER.decode(view.rowSlice(row).subarray(c0, c1 + 1));
}

/** `s` with its trailing run of gaps (`-`) removed — interior gaps are kept.
 *  An all-gap (or empty) slice returns "". Gaps are normalized to `-` in the
 *  buffer, so that single char is the test. */
function stripTrailingGaps(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "-") end--;
  return s.slice(0, end);
}

/**
 * Serialize the selected rectangle for the clipboard.
 *   - `raw`   → one row per line, the selected residues only (no names).
 *   - `fasta` → `>name` then the selected residues, per selected row.
 * Lines are `\n`-joined; gaps are preserved verbatim. The caller guards size with
 * {@link COPY_CELL_CAP} before calling — this builder is pure and unguarded.
 */
export function buildCopyText(view: AlignmentView, rect: CellRect, format: CopyFormat): string {
  const lines: string[] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const residues = rowResidues(view, r, rect.c0, rect.c1);
    if (format === "fasta") {
      lines.push(`>${view.nameAt(r)}`);
      // Drop the trailing-edge gaps (the right-pad), keep interior gaps. An all-
      // gap slice strips to "" → a bare header (an empty FASTA record).
      const body = stripTrailingGaps(residues);
      if (body.length > 0) lines.push(body);
    } else {
      lines.push(residues); // raw: WYSIWYG, gaps kept even for an empty row
    }
  }
  return lines.join("\n");
}
