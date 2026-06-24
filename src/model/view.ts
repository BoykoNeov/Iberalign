// `AlignmentView` — the frontend's read-only window onto a loaded alignment: the
// flat render buffer plus its metadata, with byte-level accessors. This is the
// render-buffer COPY the frontend owns (the authoritative `Dataset` lives in
// Rust, spec §3); the grid, coords mapping, and minimap all read through here.

import type { AlignmentMeta } from "./types";

/**
 * A loaded alignment as the renderer sees it. The buffer is the row-major
 * `width × numRows` gapped matrix from `get_render_buffer`: row `r` occupies
 * bytes `[r*width, (r+1)*width)`. Bytes are ASCII residues; a gap is `-` (the
 * engine normalizes `.` to `-` at parse, but readers should still treat both as
 * gaps — see `isGap`).
 */
export class AlignmentView {
  // Mutable so a width-changing edit can swap in the new (longer/shorter) buffer
  // and updated width on the SAME view object (see `resizeContents`) — the
  // renderer's view ref and App's `view` prop stay identical, so scroll/selection
  // survive and Grid's `[view]` effect doesn't re-fire. External code reads these;
  // only `resizeContents` reassigns them.
  buffer: Uint8Array;
  meta: AlignmentMeta;

  constructor(buffer: Uint8Array, meta: AlignmentMeta) {
    const expected = meta.width * meta.numRows;
    if (buffer.length !== expected) {
      throw new Error(
        `render buffer length ${buffer.length} != width*numRows ${expected} ` +
          `(${meta.width}×${meta.numRows})`,
      );
    }
    this.buffer = buffer;
    this.meta = meta;
  }

  get width(): number {
    return this.meta.width;
  }

  get numRows(): number {
    return this.meta.numRows;
  }

  /** The byte (ASCII residue or gap) at a cell. Bounds-checked → `undefined`. */
  cellAt(row: number, col: number): number | undefined {
    if (row < 0 || row >= this.numRows || col < 0 || col >= this.width) {
      return undefined;
    }
    return this.buffer[row * this.width + col];
  }

  /** A zero-copy view of one row's gapped bytes (`length === width`). */
  rowSlice(row: number): Uint8Array {
    const start = row * this.width;
    return this.buffer.subarray(start, start + this.width);
  }

  /** The display name for a row (pinned name column). */
  nameAt(row: number): string {
    return this.meta.names[row] ?? "";
  }

  /**
   * Swap in a full post-edit render buffer, deriving the (possibly new) width from
   * its length. The row count never changes under an edit (insert/overwrite/cut
   * touch columns, not rows), so `newWidth = bytes.length / numRows`. Reassigns
   * `buffer` + `meta.width` on THIS view object — same object identity, so the
   * renderer's ref and App's `view` prop stay valid and Grid's `[view]` effect
   * doesn't re-fire; the caller updates the store dims (`updateDims`) and repaints.
   * Handles both width-preserving edits (delete, overwrite) and width-changing
   * ones (paste-insert, and their undo/redo) through one path. Throws if the new
   * length isn't a whole number of rows.
   */
  resizeContents(bytes: Uint8Array): void {
    if (this.numRows === 0) {
      if (bytes.length !== 0) {
        throw new Error(`edit buffer length ${bytes.length} for a 0-row alignment`);
      }
      return;
    }
    if (bytes.length % this.numRows !== 0) {
      throw new Error(
        `edit buffer length ${bytes.length} is not a whole number of rows ` +
          `(numRows ${this.numRows})`,
      );
    }
    this.buffer = bytes;
    this.meta = { ...this.meta, width: bytes.length / this.numRows };
  }

  /**
   * Swap in a post-edit buffer whose ROW COUNT and NAMES may have changed (a
   * structural edit — paste-as-sequences, and the undo/redo that reverses one).
   * The authoritative row count comes from `names.length` (Rust just sent them);
   * the new width is derived against THAT, not the stale `numRows`. Reassigns
   * `buffer` + `meta` (width, numRows, names) on THIS view object — same identity,
   * so the renderer's ref and App's `view` prop stay valid and Grid's `[view]`
   * effect doesn't re-fire; the caller updates the store dims (`updateDims`) and
   * repaints. Throws if the length isn't a whole number of `names.length` rows.
   *
   * Distinct from {@link resizeContents}, which keeps `numRows` fixed (matrix
   * edits): once an edit can change the row count, deriving width from a fixed
   * `numRows` would be silently wrong — so structural edits route here.
   */
  replaceAll(bytes: Uint8Array, names: string[]): void {
    const numRows = names.length;
    if (numRows === 0) {
      if (bytes.length !== 0) {
        throw new Error(`render buffer length ${bytes.length} for a 0-row alignment`);
      }
      this.buffer = bytes;
      this.meta = { ...this.meta, width: 0, numRows: 0, names };
      return;
    }
    if (bytes.length % numRows !== 0) {
      throw new Error(
        `render buffer length ${bytes.length} is not a whole number of rows ` +
          `(numRows ${numRows})`,
      );
    }
    this.buffer = bytes;
    this.meta = { ...this.meta, width: bytes.length / numRows, numRows, names };
  }
}
