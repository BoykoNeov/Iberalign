//! Pairwise alignment (M3). Needleman–Wunsch (global) and Smith–Waterman
//! (local) with affine (Gotoh) gaps. MSA is intentionally *not* here — it is
//! delegated to external aligners (MAFFT/MUSCLE/Clustal Omega), see spec §5.
//!
//! Status: signatures fixed, bodies stubbed (`todo!()`) until M3.

use crate::model::Alphabet;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AlignMode {
    /// Needleman–Wunsch: align end-to-end.
    Global,
    /// Smith–Waterman: best local subalignment.
    Local,
}

/// Affine gap + substitution scoring. DNA defaults to match/mismatch; protein
/// defaults to BLOSUM62 (matrix wiring lands with M3).
#[derive(Clone, Copy, Debug)]
pub struct Scoring {
    pub match_score: i32,
    pub mismatch: i32,
    pub gap_open: i32,
    pub gap_extend: i32,
}

impl Scoring {
    pub fn dna_default() -> Self {
        Scoring {
            match_score: 2,
            mismatch: -1,
            gap_open: -10,
            gap_extend: -1,
        }
    }
}

/// Result of a pairwise alignment.
#[derive(Clone, Debug)]
pub struct PairwiseResult {
    pub aligned_a: Vec<u8>,
    pub aligned_b: Vec<u8>,
    pub score: i32,
    pub percent_identity: f32,
    pub length: usize,
}

/// Align two ungapped sequences. Implemented in M3.
pub fn pairwise(
    _a: &[u8],
    _b: &[u8],
    _alphabet: Alphabet,
    _mode: AlignMode,
    _scoring: Scoring,
) -> PairwiseResult {
    todo!("M3: Needleman–Wunsch / Smith–Waterman with Gotoh affine gaps")
}
