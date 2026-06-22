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
  readonly buffer: Uint8Array;
  readonly meta: AlignmentMeta;

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
}
