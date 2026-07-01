//! Nucleotide → protein translation (the DNA/RNA ↔ Protein view feature).
//!
//! A pure, testable codon table plus two translation modes, mirroring how
//! alignment lives in the engine — no shelling out, no biology in the frontend.
//! The frontend/UI decides *what* to translate (a selection); this module only
//! answers "these nucleotide bytes, under this genetic code → these amino-acid
//! bytes."
//!
//! Two modes, both codon-based (3 nt → 1 aa), differing only in how gaps in an
//! *aligned* row are handled (see [`TranslateMode`]):
//! - [`TranslateMode::Degap`] — strip gaps, then translate the clean ORF. The
//!   defensible default: translation is a per-sequence operation.
//! - [`TranslateMode::CodonThrough`] — walk the row in alignment coordinates,
//!   grouping every 3 *columns* into a codon, keeping 1:3 column correspondence
//!   with the DNA. A codon that is all gaps → `-`; one that spans a gap (real
//!   residues mixed with gaps) → `X`.
//!
//! Lookups are case-insensitive (soft-masked lowercase translates like upper);
//! `U` reads as `T` so RNA works without a separate table. Any codon containing
//! a base that is not A/C/G/T/U (an IUPAC ambiguity code, `N`, `*`, etc.) is
//! unresolvable → `X`. This is bytes-in/bytes-out with no alphabet guard: a
//! protein input translates to mostly-`X`, which is the caller's problem, not
//! this engine's — the "DNA/RNA only" guard belongs at the UI seam.

use crate::coords::is_gap;

/// How an *aligned* (gapped) row is translated. For an already-ungapped
/// sequence the two modes agree (there are no gaps to handle).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TranslateMode {
    /// Strip gaps, then translate the clean residue stream. Trailing 1–2
    /// residues that don't fill a codon are dropped. Output length =
    /// ⌊ungapped_count / 3⌋.
    Degap,
    /// Group every 3 *columns* into a codon in alignment coordinates. All-gap
    /// codon → `-`; a codon spanning a gap → `X`; otherwise translate. Output
    /// length = ⌊num_columns / 3⌋, so translated rows stay column-aligned.
    CodonThrough,
}

/// A genetic code: the mapping from each of the 64 codons to an amino-acid
/// byte (or `*` for a stop). Holds a full 64-entry table so adding NCBI tables
/// 2/11/… later is *data*, not code — construct new ones with a different `aa`
/// string; nothing else changes.
#[derive(Clone, Debug)]
pub struct GeneticCode {
    /// Human-readable name, e.g. "Standard".
    pub name: &'static str,
    /// NCBI translation-table id (1 = Standard).
    pub id: u8,
    /// Amino-acid byte per codon, indexed `base1*16 + base2*4 + base3` with each
    /// base mapped T=0, C=1, A=2, G=3 (NCBI "TCAG" order).
    aa: [u8; 64],
}

impl GeneticCode {
    /// NCBI translation table 1 (Standard) — the default until a picker lands.
    pub fn standard() -> Self {
        // Amino acids in NCBI TCAG codon order; verified against the canonical
        // table (TAA/TAG/TGA → '*', ATG → 'M', GGG → 'G').
        const AAS: &[u8; 64] = b"FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
        let mut aa = [b'X'; 64];
        aa.copy_from_slice(AAS);
        GeneticCode {
            name: "Standard",
            id: 1,
            aa,
        }
    }

    /// Look up a genetic code by NCBI table id. Only table 1 (Standard) exists
    /// today; other ids return `None` until the extra tables are added.
    pub fn by_id(id: u8) -> Option<Self> {
        match id {
            1 => Some(Self::standard()),
            _ => None,
        }
    }

    /// Translate one codon (3 nucleotide bytes) to an amino-acid byte. Returns
    /// `X` if any base is not A/C/G/T/U (ambiguity codes, gaps, `N`, …).
    fn codon_to_aa(&self, codon: [u8; 3]) -> u8 {
        match (
            base_index(codon[0]),
            base_index(codon[1]),
            base_index(codon[2]),
        ) {
            (Some(a), Some(b), Some(c)) => self.aa[(a * 16 + b * 4 + c) as usize],
            _ => b'X',
        }
    }
}

impl Default for GeneticCode {
    fn default() -> Self {
        Self::standard()
    }
}

/// Map a nucleotide byte to its TCAG index (T/U=0, C=1, A=2, G=3),
/// case-insensitive; `None` for anything else (gaps, ambiguity codes, `*`).
///
/// This mapping MUST agree with the base order of [`GeneticCode::aa`] — the
/// `ATG → M` / stop-codon unit tests are the guard against a mismatch.
fn base_index(b: u8) -> Option<u8> {
    match b.to_ascii_uppercase() {
        b'T' | b'U' => Some(0),
        b'C' => Some(1),
        b'A' => Some(2),
        b'G' => Some(3),
        _ => None,
    }
}

/// Translate `input` under `code` in the given `mode`.
///
/// - [`TranslateMode::Degap`]: `input` is treated as a residue stream (gaps are
///   filtered out first); output length = ⌊ungapped_count / 3⌋.
/// - [`TranslateMode::CodonThrough`]: `input` is an aligned row read in column
///   coordinates; output length = ⌊input.len() / 3⌋.
pub fn translate(input: &[u8], code: &GeneticCode, mode: TranslateMode) -> Vec<u8> {
    match mode {
        TranslateMode::Degap => translate_degap(input, code),
        TranslateMode::CodonThrough => translate_codon_through(input, code),
    }
}

/// Strip gaps, then translate whole codons; trailing 1–2 residues are dropped.
fn translate_degap(input: &[u8], code: &GeneticCode) -> Vec<u8> {
    let residues: Vec<u8> = input.iter().copied().filter(|&b| !is_gap(b)).collect();
    let mut out = Vec::with_capacity(residues.len() / 3);
    for codon in residues.chunks_exact(3) {
        out.push(code.codon_to_aa([codon[0], codon[1], codon[2]]));
    }
    out
}

/// Group every 3 columns into a codon in alignment coordinates. All-gap codon
/// → `-`; a codon mixing residues and gaps → `X`; otherwise translate. A
/// trailing partial codon (1–2 leftover columns) is dropped.
fn translate_codon_through(row: &[u8], code: &GeneticCode) -> Vec<u8> {
    let mut out = Vec::with_capacity(row.len() / 3);
    for codon in row.chunks_exact(3) {
        let gaps = codon.iter().filter(|&&b| is_gap(b)).count();
        let aa = match gaps {
            3 => b'-',                                             // all gap
            0 => code.codon_to_aa([codon[0], codon[1], codon[2]]), // clean codon
            _ => b'X',                                             // spans a gap
        };
        out.push(aa);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_table_known_codons() {
        let code = GeneticCode::standard();
        assert_eq!(code.codon_to_aa(*b"ATG"), b'M', "ATG = Met (start)");
        assert_eq!(code.codon_to_aa(*b"TTT"), b'F', "TTT = Phe");
        assert_eq!(code.codon_to_aa(*b"GGG"), b'G', "GGG = Gly");
        assert_eq!(code.codon_to_aa(*b"CAT"), b'H', "CAT = His");
        assert_eq!(code.codon_to_aa(*b"TGG"), b'W', "TGG = Trp");
    }

    #[test]
    fn stop_codons_are_star() {
        let code = GeneticCode::standard();
        for stop in [b"TAA", b"TAG", b"TGA"] {
            assert_eq!(code.codon_to_aa(*stop), b'*', "{stop:?} is a stop");
        }
    }

    #[test]
    fn lowercase_and_rna_translate_like_uppercase_dna() {
        let code = GeneticCode::standard();
        assert_eq!(code.codon_to_aa(*b"atg"), b'M', "soft-masked lowercase");
        assert_eq!(code.codon_to_aa(*b"AUG"), b'M', "RNA U reads as T");
        assert_eq!(code.codon_to_aa(*b"uaa"), b'*', "RNA lowercase stop");
    }

    #[test]
    fn unresolvable_codon_is_x() {
        let code = GeneticCode::standard();
        assert_eq!(code.codon_to_aa(*b"ANG"), b'X', "ambiguity code → X");
        assert_eq!(code.codon_to_aa(*b"A-G"), b'X', "gap in codon → X");
    }

    #[test]
    fn degap_translates_and_drops_trailing_partial() {
        let code = GeneticCode::standard();
        // ATG GGG TA(A leftover) — but here 8 nt = 2 codons + 2 leftover.
        let out = translate(b"ATGGGGTA", &code, TranslateMode::Degap);
        assert_eq!(out, b"MG", "2 whole codons, trailing 2 nt dropped");
    }

    #[test]
    fn degap_filters_interior_gaps_first() {
        let code = GeneticCode::standard();
        // "A-TG-GGG" degaps to "ATGGGG" = ATG + GGG.
        let out = translate(b"A-TG-GGG", &code, TranslateMode::Degap);
        assert_eq!(out, b"MG", "gaps removed, then codons read");
    }

    #[test]
    fn codon_through_keeps_column_correspondence() {
        let code = GeneticCode::standard();
        // Columns:  ATG | --- | A-G | TAA
        //           M   | -   | X   | *
        let out = translate(b"ATG---A-GTAA", &code, TranslateMode::CodonThrough);
        assert_eq!(out, b"M-X*");
    }

    #[test]
    fn codon_through_length_is_columns_over_three() {
        let code = GeneticCode::standard();
        let row = b"ATG---A-GTAAC"; // 13 cols → 4 codons, trailing 'C' dropped
        let out = translate(row, &code, TranslateMode::CodonThrough);
        assert_eq!(out.len(), row.len() / 3);
    }

    #[test]
    fn by_id_only_has_standard() {
        assert_eq!(GeneticCode::by_id(1).unwrap().name, "Standard");
        assert!(GeneticCode::by_id(11).is_none());
    }

    proptest::proptest! {
        /// Degap output length is always ⌊ungapped_count / 3⌋, whatever the mix
        /// of residues and gaps.
        #[test]
        fn degap_length_is_ungapped_over_three(bytes in proptest::collection::vec(
            proptest::sample::select(vec![b'A', b'C', b'G', b'T', b'-', b'.', b'N']),
            0..64usize,
        )) {
            let code = GeneticCode::standard();
            let ungapped = bytes.iter().filter(|&&b| b != b'-' && b != b'.').count();
            let out = translate(&bytes, &code, TranslateMode::Degap);
            proptest::prop_assert_eq!(out.len(), ungapped / 3);
        }

        /// Codon-through output length is always ⌊num_columns / 3⌋, so the
        /// translated view stays rectangular across rows of equal width.
        #[test]
        fn codon_through_length_invariant(bytes in proptest::collection::vec(
            proptest::sample::select(vec![b'A', b'C', b'G', b'T', b'-']),
            0..64usize,
        )) {
            let code = GeneticCode::standard();
            let out = translate(&bytes, &code, TranslateMode::CodonThrough);
            proptest::prop_assert_eq!(out.len(), bytes.len() / 3);
        }
    }
}
