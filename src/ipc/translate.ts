// Translation IPC — the READ-ONLY seam for the DNA/RNA → protein view. Unlike
// `ipc/edit.ts` (whose contract is reversible mutations that return the post-edit
// render buffer), `translate_block` never mutates the alignment: it reads the
// current DNA/RNA rows and returns the translated protein block. The DNA alignment
// stays the single source of truth (Q1=B); the protein view is a derived
// projection the frontend displays read-only. Biology lives in `align-core`.

import { invoke } from "@tauri-apps/api/core";

/** Gap handling for {@link translateBlock}: `"degap"` strips gaps then translates
 *  the clean windowed ORF (the default); `"codon"` reads codons through the
 *  alignment columns, keeping 1:3 column correspondence (all-gap codon → `-`, a
 *  codon spanning a gap → `X`). */
export type TranslateMode = "degap" | "codon";

/** Result of {@link translateBlock}: the translated protein rows (one per selected
 *  row, in the SAME order requested — an index-paired projection) trailing-gap-
 *  padded to a common `width` (rectangular, directly a protein render buffer).
 *  Mirror of the Rust `TranslateBlockDto`; the field names already match. */
export interface TranslateBlockResult {
  rows: string[];
  width: number;
}

/**
 * Translate the selected rows' residues within the column window `[c0, c1]` of the
 * loaded DNA/RNA alignment to protein — READ-ONLY (the alignment is untouched).
 * `mode` chooses gap handling (see {@link TranslateMode}); `code` is an NCBI
 * translation-table id (defaults to 1/Standard — the only table today). `rows` are
 * alignment-row indices; their order is preserved in the result. Rejects if nothing
 * is loaded, a row is out of bounds, or the mode/code id is unknown.
 */
export function translateBlock(
  rows: number[],
  c0: number,
  c1: number,
  mode: TranslateMode,
  code?: number,
): Promise<TranslateBlockResult> {
  return invoke<TranslateBlockResult>("translate_block", {
    rows,
    c0,
    c1,
    mode,
    code: code ?? null,
  });
}
