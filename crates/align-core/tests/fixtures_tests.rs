//! Messy-FASTA fixtures — one per parser feature, each failing without its
//! code path. Loaded via `include_bytes!` (compile-time; content assertions are
//! line-ending-independent, so git autocrlf can't break them). Line-ending
//! tolerance itself is tested with an inline byte literal in `parse_tests.rs`,
//! since a committed CR/CRLF file is not a stable artifact.

use align_core::model::{Alphabet, Dataset};
use align_core::parse::parse_fasta;

/// IUPAC ambiguity codes still read as a nucleic acid (DNA), not protein.
#[test]
fn iupac_codes_infer_dna() {
    let out = parse_fasta(include_bytes!("fixtures/iupac.fasta")).unwrap();
    assert_eq!(out.records[0].gapped, b"ACGTNRYSWKMBDHVACGTNRYSWKMBDHV");
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.sequences[0].alphabet, Alphabet::Dna);
}

/// Lowercase soft-masking is preserved verbatim; case does not affect the
/// inferred alphabet.
#[test]
fn soft_mask_case_is_preserved() {
    let out = parse_fasta(include_bytes!("fixtures/softmask.fasta")).unwrap();
    assert_eq!(out.records[0].gapped, b"acgtACGTacgtACGT");
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.sequences[0].alphabet, Alphabet::Dna);
}

/// `U` without `T` marks RNA.
#[test]
fn u_without_t_is_rna() {
    let out = parse_fasta(include_bytes!("fixtures/rna.fasta")).unwrap();
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.sequences[0].alphabet, Alphabet::Rna);
}

/// Gaps written as `.` are normalized to `-` at the parse boundary; `-` is left
/// as-is. Both rows are equal width (already aligned).
#[test]
fn dot_gaps_normalized_to_dash() {
    let out = parse_fasta(include_bytes!("fixtures/gaps_mixed.fasta")).unwrap();
    assert_eq!(out.records[0].gapped, b"AC-GT-AC");
    assert_eq!(out.records[1].gapped, b"AC-GT-AC");
    let ds = Dataset::from_records(&out.records);
    // Ungapped residues drop the gaps, case preserved.
    assert_eq!(ds.sequences[0].residues, b"ACGTAC");
}

/// `*` stop codons are preserved as residues; an all-letter protein reads as
/// protein.
#[test]
fn stop_codons_preserved() {
    let out = parse_fasta(include_bytes!("fixtures/stops.fasta")).unwrap();
    assert_eq!(out.records[0].gapped, b"MKLV*WQEDR*");
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.sequences[0].residues, b"MKLV*WQEDR*");
    assert_eq!(ds.sequences[0].alphabet, Alphabet::Protein);
}

/// `;` comment lines and blank lines are ignored; residue lines around them
/// concatenate.
#[test]
fn comments_and_blanks_ignored() {
    let out = parse_fasta(include_bytes!("fixtures/comments_blanks.fasta")).unwrap();
    assert!(out.warnings.is_empty());
    let names: Vec<&str> = out.records.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["c1", "c2"]);
    assert_eq!(out.records[0].gapped, b"ACGTACGT");
    assert_eq!(out.records[1].gapped, b"TTTT");
}

/// Duplicate names are disambiguated (`name`, `name.1`, …), first occurrence
/// kept, each rename warned.
#[test]
fn duplicate_names_disambiguated() {
    let out = parse_fasta(include_bytes!("fixtures/duplicates.fasta")).unwrap();
    let names: Vec<&str> = out.records.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["dup", "dup.1", "other", "dup.2"]);
    assert_eq!(out.warnings.len(), 2);
}

/// Ragged (unequal-length) input is **trailing-padded only** to the widest
/// row — never strip-and-repad. Ungapped residues exclude the padding.
#[test]
fn ragged_input_is_trailing_padded() {
    let out = parse_fasta(include_bytes!("fixtures/ragged.fasta")).unwrap();
    // Plain unaligned sequences (no interior gaps) draw no malformed warning.
    assert!(out.warnings.is_empty());
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.alignment.width, 8);
    assert!(ds.alignment.rows.iter().all(|r| r.gapped.len() == 8));
    assert_eq!(ds.alignment.rows[0].gapped, b"ACGT----"); // r1 padded
    assert_eq!(ds.alignment.rows[2].gapped, b"AC------"); // r3 padded
    assert_eq!(ds.sequences[0].residues, b"ACGT"); // padding not in residues
}

/// Ragged input that *also* carries interior gaps looks like a broken
/// alignment: it is trailing-padded **and** a warning is emitted.
#[test]
fn malformed_alignment_warns() {
    let out = parse_fasta(include_bytes!("fixtures/malformed_aligned.fasta")).unwrap();
    assert!(out
        .warnings
        .iter()
        .any(|w| w.contains("malformed alignment")));
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.alignment.width, 8);
    // Interior gap preserved; padding appended only at the trailing end.
    assert_eq!(ds.alignment.rows[0].gapped, b"AC-GT---");
}

/// Already-aligned (equal-width) input is a **no-op** under construction:
/// interior gaps are untouched and no trailing gaps are added. This is the
/// anti-corruption guarantee — `AC-GT` must not collapse to `ACGT`.
#[test]
fn aligned_input_is_unchanged_by_construction() {
    let out = parse_fasta(include_bytes!("fixtures/aligned.fasta")).unwrap();
    let ds = Dataset::from_records(&out.records);
    assert_eq!(ds.alignment.width, 5);
    assert_eq!(ds.alignment.rows[0].gapped, b"AC-GT"); // interior gap preserved
    assert_eq!(ds.alignment.rows[2].gapped, b"A--GT");
    assert_eq!(ds.sequences[0].residues, b"ACGT"); // gap removed only in derived seq
}
