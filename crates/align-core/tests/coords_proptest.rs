//! Property tests for the coordinate API — the spec's headline invariant.

use align_core::coords::is_gap;
use align_core::model::{AlignedRow, Dataset, RawRecord};
use proptest::prelude::*;

/// A gapped row: each cell is a gap or a nucleotide. Length 0..200.
fn gapped_row() -> impl Strategy<Value = Vec<u8>> {
    prop::collection::vec(
        prop_oneof![
            Just(b'-'),
            Just(b'.'),
            Just(b'A'),
            Just(b'C'),
            Just(b'G'),
            Just(b'T'),
        ],
        0..200,
    )
}

proptest! {
    /// For every non-gap column c: seq_pos_to_col(col_to_seq_pos(c)) == c.
    #[test]
    fn col_pos_roundtrip(gapped in gapped_row()) {
        let row = AlignedRow::new(0, gapped.clone());
        for (col, &b) in gapped.iter().enumerate() {
            if is_gap(b) {
                prop_assert_eq!(row.col_to_seq_pos(col), None);
            } else {
                let pos = row.col_to_seq_pos(col).expect("non-gap maps to a position");
                prop_assert_eq!(row.seq_pos_to_col(pos), Some(col));
            }
        }
    }

    /// For every residue position p: col_to_seq_pos(seq_pos_to_col(p)) == p.
    #[test]
    fn pos_col_roundtrip(gapped in gapped_row()) {
        let row = AlignedRow::new(0, gapped);
        let residues = row.residue_count();
        for pos in 0..residues {
            let col = row.seq_pos_to_col(pos).expect("position maps to a column");
            prop_assert_eq!(row.col_to_seq_pos(col), Some(pos));
        }
        // One past the end has no column.
        prop_assert_eq!(row.seq_pos_to_col(residues), None);
    }

    /// The round-trip still holds after `Dataset::from_records` builds rows and
    /// trailing-pads them to a common width — padding must not perturb the
    /// mapping, and every row must end up the same width.
    #[test]
    fn construction_preserves_roundtrip(records in raw_records()) {
        let ds = Dataset::from_records(&records);
        for row in &ds.alignment.rows {
            prop_assert_eq!(row.width(), ds.alignment.width);
            for (col, &b) in row.gapped.iter().enumerate() {
                if is_gap(b) {
                    prop_assert_eq!(row.col_to_seq_pos(col), None);
                } else {
                    let pos = row.col_to_seq_pos(col).expect("non-gap maps to a position");
                    prop_assert_eq!(row.seq_pos_to_col(pos), Some(col));
                }
            }
        }
    }
}

/// 0..6 records, each a random gapped row, for the construction proptest.
fn raw_records() -> impl Strategy<Value = Vec<RawRecord>> {
    prop::collection::vec(
        gapped_row().prop_map(|gapped| RawRecord {
            name: String::new(),
            description: String::new(),
            gapped,
        }),
        0..6,
    )
}
