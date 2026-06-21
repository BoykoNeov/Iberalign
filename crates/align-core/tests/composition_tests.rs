//! Composition stats on toy inputs.

use align_core::model::Dataset;
use align_core::parse::parse_fasta;
use align_core::Composition;

#[test]
fn gc_content_and_lengths() {
    let out = parse_fasta(b">s1\nGGCC\n>s2\nATAT\n>s3\nATGC\n").unwrap();
    let ds = Dataset::from_records(&out.records);
    let c = Composition::of(&ds);
    assert_eq!(c.gc_content, vec![1.0, 0.0, 0.5]);
    assert_eq!(c.lengths, vec![4, 4, 4]);
    // No gaps anywhere.
    assert_eq!(c.gap_fraction_per_row, vec![0.0, 0.0, 0.0]);
    assert_eq!(c.gap_fraction_per_col, vec![0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn gap_fractions_per_row_and_column() {
    let out = parse_fasta(b">a\nAC-T\n>b\nA--T\n").unwrap();
    let ds = Dataset::from_records(&out.records);
    let c = Composition::of(&ds);

    // a has 1 gap of 4, b has 2 of 4.
    assert_eq!(c.gap_fraction_per_row, vec![0.25, 0.5]);
    // col0 AA, col1 C-, col2 --, col3 TT.
    assert_eq!(c.gap_fraction_per_col, vec![0.0, 0.5, 1.0, 0.0]);
    // Ungapped lengths: a=ACT(3), b=AT(2).
    assert_eq!(c.lengths, vec![3, 2]);
    // a GC = C over {A,C,T} = 1/3; b GC = 0.
    assert!((c.gc_content[0] - 1.0 / 3.0).abs() < 1e-6);
    assert_eq!(c.gc_content[1], 0.0);
}

#[test]
fn empty_dataset_is_well_formed() {
    let ds = Dataset::default();
    let c = Composition::of(&ds);
    assert!(c.gc_content.is_empty());
    assert!(c.gap_fraction_per_col.is_empty());
}
