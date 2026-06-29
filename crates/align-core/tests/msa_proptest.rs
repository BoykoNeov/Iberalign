//! Property tests for the in-process progressive MSA — the invariants the
//! hand-worked cases can't exhaustively cover.

use align_core::coords::is_gap;
use align_core::matrix::SubstitutionMatrix;
use align_core::msa::progressive_align;
use align_core::Scoring;
use proptest::prelude::*;

/// An ungapped nucleotide sequence, length 0..30.
fn seq() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(
        prop_oneof![Just(b'A'), Just(b'C'), Just(b'G'), Just(b'T')],
        0..30,
    )
}

/// 2..6 such sequences.
fn seqs() -> impl Strategy<Value = Vec<Vec<u8>>> {
    prop::collection::vec(seq(), 2..6)
}

fn degap(s: &[u8]) -> Vec<u8> {
    s.iter().copied().filter(|&b| !is_gap(b)).collect()
}

proptest! {
    /// The core MSA invariant: every output row de-gaps to its input sequence
    /// (fidelity — only gaps are inserted, residues never altered), all rows share
    /// one width, and the row count is preserved in input order.
    #[test]
    fn fidelity_and_equal_width(s in seqs()) {
        let refs: Vec<&[u8]> = s.iter().map(|v| v.as_slice()).collect();
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        let res = progressive_align(&refs, &m, Scoring::dna_default());

        prop_assert_eq!(res.rows.len(), s.len());
        for (i, row) in res.rows.iter().enumerate() {
            prop_assert_eq!(row.len(), res.length);
            prop_assert_eq!(degap(row), s[i].clone());
        }
    }

    /// Determinism: the same input yields byte-identical output (no float-order
    /// dependence leaks into the byte-determining path).
    #[test]
    fn deterministic(s in seqs()) {
        let refs: Vec<&[u8]> = s.iter().map(|v| v.as_slice()).collect();
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        let a = progressive_align(&refs, &m, Scoring::dna_default());
        let b = progressive_align(&refs, &m, Scoring::dna_default());
        prop_assert_eq!(a.rows, b.rows);
        prop_assert_eq!(a.length, b.length);
    }
}
