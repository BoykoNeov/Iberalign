// Editing IPC — the seam for reversible mutations. Each call applies an edit in
// the Rust core (the single source of truth) and returns the POST-EDIT render
// buffer as raw bytes (same transport as `getRenderBuffer`); the caller copies it
// into the existing `AlignmentView` in place and marks the grid dirty. An empty
// result means "nothing changed" (e.g. undo/redo at the end of the stack), so the
// caller skips the repaint. These edits preserve the alignment width — the
// returned buffer matches the current dimensions, so the copy is a straight
// in-place overwrite (width-changing edits, later, will rebuild the view).

import { invoke } from "@tauri-apps/api/core";
import type { CellRect } from "../state/selection";

async function editBuffer(cmd: string, args?: Record<string, unknown>): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>(cmd, args);
  return new Uint8Array(buf);
}

/** Clear (mask to gaps) the selected rectangle; returns the post-edit buffer. */
export function clearCells(rect: CellRect): Promise<Uint8Array> {
  return editBuffer("clear_cells", { r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 });
}

/**
 * Paste a block of residue lines over the alignment in OVERWRITE mode, with the
 * block's top-left at `(r0, c0)`: cells are overwritten in place, lines past the
 * last row are dropped, and the alignment GROWS to fit a block that runs past the
 * right edge (it never truncates horizontally). The returned buffer may be WIDER,
 * so the caller derives the new width from its length (same as paste-insert).
 */
export function pasteOverwrite(r0: number, c0: number, rows: string[]): Promise<Uint8Array> {
  return editBuffer("paste_overwrite", { r0, c0, rows });
}

/**
 * Paste a block of residue lines over the alignment in INSERT mode — the block is
 * inserted at `(r0, c0)` and the alignment GROWS in width. `shiftAll` chooses how
 * the other rows keep equal width: `false` (the default) trailing-pads them (only
 * the pasted rows shift), `true` inserts gaps at `c0` everywhere (columns stay
 * aligned). The returned buffer is WIDER, so the caller resizes the view (it
 * derives the new width from the buffer length) rather than copying in place.
 */
export function pasteInsert(
  r0: number,
  c0: number,
  rows: string[],
  shiftAll: boolean,
): Promise<Uint8Array> {
  return editBuffer("paste_insert", { r0, c0, rows, shiftAll });
}

/** Outcome of {@link pasteSequences}: rows inserted + how many were truncated.
 *  With grow-to-fit `truncated` is 0 in the common case (the alignment widens to
 *  the widest sequence); it is only nonzero in the rare size-cap fallback. Mirror
 *  of the Rust `PasteSeqDto`. */
export interface PasteSeqResult {
  inserted: number;
  truncated: number;
}

/**
 * Paste FASTA from the clipboard as NEW sequences inserted at row index `at`. The
 * raw clipboard text is parsed in Rust (tolerant FASTA: wrapped lines, dup names,
 * `.`→`-`). GROW-to-fit: the alignment widens to the widest pasted sequence
 * (existing rows trailing-pad), so nothing truncates except in the rare size-cap
 * fallback. Unlike the buffer-returning edits this returns a small JSON status —
 * the row count (and maybe width) changed, so the caller re-syncs its view from
 * `getAlignmentMeta` + `getRenderBuffer` (the load path) rather than swapping a
 * fixed-row buffer.
 */
export function pasteSequences(at: number, text: string): Promise<PasteSeqResult> {
  return invoke<PasteSeqResult>("paste_sequences", { at, text });
}

/** Undo the most recent edit. Empty result ⇒ nothing to undo. */
export function undoEdit(): Promise<Uint8Array> {
  return editBuffer("undo_edit");
}

/** Redo the most recently undone edit. Empty result ⇒ nothing to redo. */
export function redoEdit(): Promise<Uint8Array> {
  return editBuffer("redo_edit");
}
