//! Per-column and all-pairs analyses (M4): consensus, conservation
//! (Shannon entropy / % identity to consensus), pairwise identity matrix
//! (rayon-parallel), and composition stats. Results are cached on the
//! `Alignment` and invalidated on edit.
//!
//! Status: signatures fixed, bodies stubbed (`todo!()`) until M4.

use crate::model::Alignment;

/// Most-frequent residue per column. Cached on the alignment.
pub fn consensus(_aln: &Alignment) -> &[u8] {
    todo!("M4: per-column consensus with threshold + tie handling")
}

/// Per-column conservation score (selectable: Shannon entropy or % identity
/// to consensus). Cached on the alignment.
pub fn conservation(_aln: &Alignment) -> &[f32] {
    todo!("M4: per-column conservation (entropy / identity)")
}

/// All-pairs percent-identity matrix (row-major, `n*n`). Parallelized with
/// rayon in M4.
pub fn identity_matrix(_aln: &Alignment) -> Vec<f32> {
    todo!("M4: rayon-parallel all-pairs identity matrix")
}
