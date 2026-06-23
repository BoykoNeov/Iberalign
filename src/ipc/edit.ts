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

/** Undo the most recent edit. Empty result ⇒ nothing to undo. */
export function undoEdit(): Promise<Uint8Array> {
  return editBuffer("undo_edit");
}

/** Redo the most recently undone edit. Empty result ⇒ nothing to redo. */
export function redoEdit(): Promise<Uint8Array> {
  return editBuffer("redo_edit");
}
