//! Tests for the tolerant FASTA parser and the load summary.

use align_core::model::Alphabet;
use align_core::parse::{parse_fasta, summarize, ParseError};

#[test]
fn parses_basic_multi_record() {
    let input = b">seq1 first one\nACGT\nACGT\n>seq2\nTTTTGGGG\n";
    let seqs = parse_fasta(input).unwrap();
    assert_eq!(seqs.len(), 2);
    assert_eq!(seqs[0].name, "seq1");
    assert_eq!(seqs[0].description, "first one");
    assert_eq!(seqs[0].residues, b"ACGTACGT");
    assert_eq!(seqs[0].id, 0);
    assert_eq!(seqs[1].name, "seq2");
    assert_eq!(seqs[1].residues, b"TTTTGGGG");
    assert_eq!(seqs[1].id, 1);
}

#[test]
fn tolerates_mixed_line_endings_blanks_and_comments() {
    // CRLF, lone CR, a blank line, a ';' comment, lowercase input.
    let input = b"; a comment\r\n>s1\r\nacgt\r\n\rGGGG\n>s2\nTTTT";
    let seqs = parse_fasta(input).unwrap();
    assert_eq!(seqs.len(), 2);
    assert_eq!(seqs[0].residues, b"ACGTGGGG"); // uppercased, concatenated
    assert_eq!(seqs[1].residues, b"TTTT");
}

#[test]
fn infers_alphabets() {
    let dna = parse_fasta(b">a\nACGTACGTN\n").unwrap();
    assert_eq!(dna[0].alphabet, Alphabet::Dna);

    let rna = parse_fasta(b">a\nACGUACGU\n").unwrap();
    assert_eq!(rna[0].alphabet, Alphabet::Rna);

    let protein = parse_fasta(b">a\nMKLVWQEDRSHF\n").unwrap();
    assert_eq!(protein[0].alphabet, Alphabet::Protein);
}

#[test]
fn empty_input_is_no_records() {
    assert_eq!(
        parse_fasta(b"\n\n; only a comment\n"),
        Err(ParseError::NoRecords)
    );
}

#[test]
fn summary_reports_counts_and_equal_length() {
    let aligned = parse_fasta(b">a\nACGT\n>b\nTTGG\n").unwrap();
    let s = summarize(&aligned);
    assert_eq!(s.count, 2);
    assert_eq!(s.min_len, 4);
    assert_eq!(s.max_len, 4);
    assert!(s.equal_length);
    assert_eq!(s.alphabet, Alphabet::Dna);

    let ragged = parse_fasta(b">a\nACGT\n>b\nTTGGGG\n").unwrap();
    let s2 = summarize(&ragged);
    assert!(!s2.equal_length);
    assert_eq!(s2.max_len, 6);
}
