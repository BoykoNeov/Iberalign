//! Property tests for pairwise alignment — the invariants the hand-worked unit
//! cases can't exhaustively cover.

use align_core::align::{pairwise, AlignMode, Scoring};
use align_core::coords::is_gap;
use align_core::matrix::SubstitutionMatrix;
use proptest::prelude::*;

/// An ungapped nucleotide sequence, length 0..40.
fn seq() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(
        prop_oneof![Just(b'A'), Just(b'C'), Just(b'G'), Just(b'T')],
        0..40,
    )
}

fn degap(s: &[u8]) -> Vec<u8> {
    s.iter().copied().filter(|&b| !is_gap(b)).collect()
}

proptest! {
    /// Both aligned rows have equal length, and stripping the gaps recovers the
    /// inputs exactly (global = end-to-end, so nothing is lost or invented).
    #[test]
    fn global_roundtrips(a in seq(), b in seq()) {
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        let r = pairwise(&a, &b, &m, AlignMode::Global, Scoring::dna_default());
        prop_assert_eq!(r.aligned_a.len(), r.aligned_b.len());
        prop_assert_eq!(r.length, r.aligned_a.len());
        prop_assert_eq!(degap(&r.aligned_a), a);
        prop_assert_eq!(degap(&r.aligned_b), b);
    }

    /// Score is symmetric: aligning (a, b) scores the same as (b, a).
    #[test]
    fn global_score_symmetric(a in seq(), b in seq()) {
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        let ab = pairwise(&a, &b, &m, AlignMode::Global, Scoring::dna_default());
        let ba = pairwise(&b, &a, &m, AlignMode::Global, Scoring::dna_default());
        prop_assert_eq!(ab.score, ba.score);
    }

    /// A sequence aligned to itself (global): 100% identity, no gaps, and the
    /// score is exactly its length × the match score.
    #[test]
    fn global_self_alignment_is_perfect(a in seq()) {
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        let r = pairwise(&a, &a, &m, AlignMode::Global, Scoring::dna_default());
        prop_assert_eq!(r.aligned_a, a.clone());
        prop_assert_eq!(r.aligned_b, a.clone());
        prop_assert_eq!(r.score, 2 * a.len() as i32);
        if !a.is_empty() {
            prop_assert_eq!(r.percent_identity, 100.0);
        }
    }

    /// Local score is never negative and never exceeds the global score for the
    /// same pair under the same (non-negative-match) scoring.
    #[test]
    fn local_bounded(a in seq(), b in seq()) {
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        let g = pairwise(&a, &b, &m, AlignMode::Global, Scoring::dna_default());
        let l = pairwise(&a, &b, &m, AlignMode::Local, Scoring::dna_default());
        // Trimming the global alignment's leading/trailing gaps yields a valid
        // local alignment whose score ≥ the global score, so local ≥ max(0, global).
        prop_assert!(l.score >= 0);
        prop_assert!(l.score >= g.score.max(0));
        prop_assert_eq!(l.aligned_a.len(), l.aligned_b.len());
    }
}
