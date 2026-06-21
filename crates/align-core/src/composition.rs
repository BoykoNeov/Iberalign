//! Composition statistics (M1): GC content, per-sequence length, and gap
//! fraction per row and per column. These are cheap, single-pass descriptive
//! stats over a loaded [`Dataset`] — distinct from the heavier per-column
//! analyses (consensus / conservation / identity matrix) in [`crate::analyze`],
//! which land in M4.

use crate::coords::is_gap;
use crate::model::Dataset;

/// Descriptive composition of a loaded dataset. Vectors are indexed the same as
/// `Dataset::sequences` / `Alignment::rows`; `gap_fraction_per_col` has one
/// entry per alignment column (`len == width`).
#[derive(Clone, Debug, PartialEq)]
pub struct Composition {
    /// GC fraction per sequence over ungapped residues, in `[0, 1]`. Counts
    /// `G`/`C` over `A`/`C`/`G`/`T`/`U` (case-insensitive); `0.0` when none are
    /// present. Only meaningful for DNA/RNA — protein values are not.
    pub gc_content: Vec<f32>,
    /// Ungapped residue length per sequence (the length distribution).
    pub lengths: Vec<usize>,
    /// Gap fraction per row = gaps / width, in `[0, 1]`.
    pub gap_fraction_per_row: Vec<f32>,
    /// Gap fraction per column = gaps across rows / row count, in `[0, 1]`.
    /// `len == alignment width`.
    pub gap_fraction_per_col: Vec<f32>,
}

impl Composition {
    /// Compute composition stats over a dataset in a single pass each.
    pub fn of(ds: &Dataset) -> Composition {
        let gc_content = ds
            .sequences
            .iter()
            .map(|s| gc_fraction(&s.residues))
            .collect();
        let lengths = ds.sequences.iter().map(|s| s.residues.len()).collect();

        let aln = &ds.alignment;
        let width = aln.width;
        let n = aln.rows.len();

        let gap_fraction_per_row = aln
            .rows
            .iter()
            .map(|r| {
                if width == 0 {
                    0.0
                } else {
                    let gaps = r.gapped.iter().filter(|&&b| is_gap(b)).count();
                    gaps as f32 / width as f32
                }
            })
            .collect();

        let mut gap_fraction_per_col = vec![0.0f32; width];
        if n > 0 {
            for (col, slot) in gap_fraction_per_col.iter_mut().enumerate() {
                let gaps = aln.rows.iter().filter(|r| is_gap(r.gapped[col])).count();
                *slot = gaps as f32 / n as f32;
            }
        }

        Composition {
            gc_content,
            lengths,
            gap_fraction_per_row,
            gap_fraction_per_col,
        }
    }
}

/// GC fraction of an ungapped residue slice: `(G+C) / (A+C+G+T+U)`,
/// case-insensitive. Returns `0.0` when no canonical bases are present.
fn gc_fraction(residues: &[u8]) -> f32 {
    let mut gc = 0usize;
    let mut at = 0usize;
    for &b in residues {
        match b.to_ascii_uppercase() {
            b'G' | b'C' => gc += 1,
            b'A' | b'T' | b'U' => at += 1,
            _ => {}
        }
    }
    let total = gc + at;
    if total == 0 {
        0.0
    } else {
        gc as f32 / total as f32
    }
}
