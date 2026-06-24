//! Tests for the tolerant FASTA parser and the load summary.

use align_core::model::{Alphabet, Dataset};
use align_core::parse::{parse_fasta, parse_fasta_with, summarize, ParseError, ParseOptions};

#[test]
fn parses_basic_multi_record() {
    let input = b">seq1 first one\nACGT\nACGT\n>seq2\nTTTTGGGG\n";
    let out = parse_fasta(input).unwrap();
    assert_eq!(out.records.len(), 2);
    assert!(out.warnings.is_empty());
    assert_eq!(out.records[0].name, "seq1");
    assert_eq!(out.records[0].description, "first one");
    assert_eq!(out.records[0].gapped, b"ACGTACGT");
    assert_eq!(out.records[1].name, "seq2");

    // The ungapped sequences are derived by the dataset builder.
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.sequences[0].id, 0);
    assert_eq!(ds.sequences[0].residues, b"ACGTACGT");
    assert_eq!(ds.sequences[1].id, 1);
    assert_eq!(ds.sequences[1].residues, b"TTTTGGGG");
}

#[test]
fn preserves_case_and_tolerates_mixed_endings_blanks_comments() {
    // CRLF, lone CR, a blank line, a ';' comment, lowercase (soft-masked) input.
    let input = b"; a comment\r\n>s1\r\nacgt\r\n\rGGGG\n>s2\nTTTT";
    let out = parse_fasta(input).unwrap();
    assert_eq!(out.records.len(), 2);
    // Case is preserved now — soft-masking is data, not normalized at parse.
    assert_eq!(out.records[0].gapped, b"acgtGGGG");
    assert_eq!(out.records[1].gapped, b"TTTT");
}

#[test]
fn infers_alphabets() {
    let dna = Dataset::from_records(&parse_fasta(b">a\nACGTACGTN\n").unwrap().records);
    assert_eq!(dna.sequences[0].alphabet, Alphabet::Dna);

    let rna = Dataset::from_records(&parse_fasta(b">a\nACGUACGU\n").unwrap().records);
    assert_eq!(rna.sequences[0].alphabet, Alphabet::Rna);

    let protein = Dataset::from_records(&parse_fasta(b">a\nMKLVWQEDRSHF\n").unwrap().records);
    assert_eq!(protein.sequences[0].alphabet, Alphabet::Protein);

    // Soft-masked (lowercase) input classifies the same as uppercase.
    let masked = Dataset::from_records(&parse_fasta(b">a\nacgtacgtn\n").unwrap().records);
    assert_eq!(masked.sequences[0].alphabet, Alphabet::Dna);
}

#[test]
fn no_header_is_no_records() {
    assert_eq!(
        parse_fasta(b"\n\n; only a comment\n"),
        Err(ParseError::NoRecords)
    );
}

#[test]
fn empty_record_body_is_skipped_with_warning() {
    // `>empty` has no residues; it is skipped, not a hard error.
    let out = parse_fasta(b">empty\n>real\nACGT\n").unwrap();
    assert_eq!(out.records.len(), 1);
    assert_eq!(out.records[0].name, "real");
    assert_eq!(out.warnings.len(), 1);
    assert!(out.warnings[0].contains("empty"));
}

#[test]
fn keep_empty_records_preserves_empty_bodies() {
    // The PASTE path: an empty-body record (`>empty`) is KEPT as a zero-length
    // record (name preserved, no warning), so a `>name` from an all-gap FASTA copy
    // round-trips back as an empty sequence instead of vanishing.
    let opts = ParseOptions {
        keep_empty_records: true,
    };
    let out = parse_fasta_with(b">empty\n>real\nACGT\n", opts).unwrap();
    assert_eq!(out.records.len(), 2);
    assert_eq!(out.records[0].name, "empty");
    assert!(out.records[0].gapped.is_empty());
    assert_eq!(out.records[1].name, "real");
    assert_eq!(out.records[1].gapped, b"ACGT");
    assert!(out.warnings.is_empty()); // kept, not warn-skipped
}

#[test]
fn duplicate_names_are_disambiguated_with_warnings() {
    let out = parse_fasta(b">dup\nACGT\n>dup\nTTGG\n>dup\nCCAA\n>uniq\nGGGG\n").unwrap();
    let names: Vec<&str> = out.records.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["dup", "dup.1", "dup.2", "uniq"]);
    assert_eq!(out.warnings.len(), 2); // two renames
}

#[test]
fn summary_reports_lengths_width_and_equal_width() {
    // Equal gapped width, no padding needed.
    let aligned = parse_fasta(b">a\nAC-GT\n>b\nACTGT\n").unwrap();
    let s = summarize(&aligned.records);
    assert_eq!(s.count, 2);
    assert_eq!(s.width, 5);
    assert!(s.equal_width); // both rows are 5 wide
    assert_eq!(s.min_len, 4); // 'a' has one gap, 4 ungapped residues
    assert_eq!(s.max_len, 5);
    assert_eq!(s.alphabet, Alphabet::Dna);

    // Ragged: unequal gapped width.
    let ragged = parse_fasta(b">a\nACGT\n>b\nTTGGGG\n").unwrap();
    let s2 = summarize(&ragged.records);
    assert!(!s2.equal_width);
    assert_eq!(s2.width, 6);
    assert_eq!(s2.max_len, 6);
}
