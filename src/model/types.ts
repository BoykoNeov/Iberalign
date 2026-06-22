// Domain types for the loaded alignment. These mirror the Rust DTOs but are the
// frontend's own vocabulary — the `ipc/` layer maps wire shapes onto these, and
// `model/`, `render/`, `state/`, `ui/` all speak in these terms. Keeping the
// types here (not in `ipc/`) keeps the dependency arrow pointing transport →
// domain, never the reverse.

/** Sequence alphabet label as reported by the engine. Drives the color scheme. */
export type AlphabetLabel = "DNA" | "RNA" | "Protein";

/**
 * Render metadata for the grid — everything the chrome needs that is small and
 * structured. The large gapped matrix travels separately as raw bytes (see
 * `AlignmentView` / `getRenderBuffer`).
 */
export interface AlignmentMeta {
  /** Aligned width — number of columns. */
  width: number;
  /** Number of rows (sequences) in the alignment. */
  numRows: number;
  /** Row names in alignment-row order — for the pinned name column. */
  names: string[];
  /** Dataset-wide alphabet — drives coloring. Widened from the engine. */
  alphabet: AlphabetLabel | string;
}
