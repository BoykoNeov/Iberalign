//! Substitution scoring for pairwise alignment (M3).
//!
//! A [`SubstitutionMatrix`] answers one question: the score of aligning residue
//! `a` against residue `b`. Two flavours:
//! - **match/mismatch** — a flat nucleotide model (equal byte → `m`, else `mm`).
//! - **named table** — BLOSUM / PAM matrices for protein, transcribed from the
//!   canonical NCBI tables.
//!
//! Lookups are **case-insensitive** (both bytes uppercased), so soft-masked
//! lowercase residues score like their uppercase form. Gap bytes (`b'-'`) are
//! never scored here — affine gap penalties live in [`crate::align`]. A byte not
//! present in a protein table falls back to the matrix's `X` ("any") row, which
//! is documented, not silent.

/// A dense `n×n` lookup table over a residue order.
#[derive(Clone, Debug)]
struct TableData {
    /// ASCII byte → row/col in `small`, or `-1` to use `fallback`.
    index: [i16; 128],
    /// Row-major `n×n` scores.
    small: Vec<i32>,
    n: usize,
    /// Row/col used for any byte absent from the order (the `X` row).
    fallback: usize,
}

/// How a [`SubstitutionMatrix`] computes a pairwise residue score.
#[derive(Clone, Debug)]
enum Kind {
    /// Flat nucleotide model.
    MatchMismatch { m: i32, mm: i32 },
    /// A named substitution table (boxed — far larger than the flat variant).
    Table(Box<TableData>),
}

/// A residue-pair scoring scheme. Build one with [`SubstitutionMatrix::match_mismatch`]
/// or a named constructor ([`SubstitutionMatrix::blosum62`], …), or pick a sensible
/// default for an alphabet with [`SubstitutionMatrix::default_for`].
#[derive(Clone, Debug)]
pub struct SubstitutionMatrix {
    kind: Kind,
}

impl SubstitutionMatrix {
    /// A flat nucleotide model: equal residues score `m`, differing residues `mm`.
    pub fn match_mismatch(m: i32, mm: i32) -> Self {
        SubstitutionMatrix {
            kind: Kind::MatchMismatch { m, mm },
        }
    }

    /// The default matrix for an alphabet: DNA/RNA → `match_mismatch(2, -1)`,
    /// protein → BLOSUM62.
    pub fn default_for(alphabet: crate::model::Alphabet) -> Self {
        use crate::model::Alphabet::*;
        match alphabet {
            Dna | Rna => Self::match_mismatch(2, -1),
            Protein => Self::blosum62(),
        }
    }

    /// BLOSUM62 (NCBI). Order `ARNDCQEGHILKMFPSTWYVBZX*`.
    pub fn blosum62() -> Self {
        Self::from_table(BLOSUM_ORDER, &BLOSUM62)
    }

    /// BLOSUM45 (NCBI). Order `ARNDCQEGHILKMFPSTWYVBZX*`.
    pub fn blosum45() -> Self {
        Self::from_table(BLOSUM_ORDER, &BLOSUM45)
    }

    /// BLOSUM80 (NCBI). Order `ARNDCQEGHILKMFPSTWYVBZX*`.
    pub fn blosum80() -> Self {
        Self::from_table(BLOSUM_ORDER, &BLOSUM80)
    }

    /// PAM250 (NCBI). Order `ARNDCQEGHILKMFPSTWYVBZX*`.
    pub fn pam250() -> Self {
        Self::from_table(BLOSUM_ORDER, &PAM250)
    }

    /// Score of aligning `a` against `b`. Case-insensitive; unknown protein
    /// symbols fall back to the `X` row.
    #[inline]
    pub fn score(&self, a: u8, b: u8) -> i32 {
        match &self.kind {
            Kind::MatchMismatch { m, mm } => {
                if a.eq_ignore_ascii_case(&b) {
                    *m
                } else {
                    *mm
                }
            }
            Kind::Table(t) => {
                let ia = Self::lookup(&t.index, a, t.fallback);
                let ib = Self::lookup(&t.index, b, t.fallback);
                t.small[ia * t.n + ib]
            }
        }
    }

    #[inline]
    fn lookup(index: &[i16; 128], byte: u8, fallback: usize) -> usize {
        let up = byte.to_ascii_uppercase();
        if up < 128 {
            let i = index[up as usize];
            if i >= 0 {
                return i as usize;
            }
        }
        fallback
    }

    /// Build a table matrix from a residue `order` (uppercase ASCII) and a square
    /// `n×n` score grid in that order. Panics if the grid is not `order.len()`
    /// square or `order` lacks an `X` fallback row — both are compile-fixed data,
    /// so a panic here is a transcription bug, caught by tests.
    fn from_table(order: &[u8], rows: &[&[i32]]) -> Self {
        let n = order.len();
        assert_eq!(rows.len(), n, "matrix is not {n} rows");
        let mut index = [-1i16; 128];
        for (i, &letter) in order.iter().enumerate() {
            let up = letter.to_ascii_uppercase();
            assert!(up < 128, "non-ASCII residue in matrix order");
            index[up as usize] = i as i16;
        }
        let fallback = order
            .iter()
            .position(|&b| b == b'X')
            .expect("matrix order must contain X (fallback row)");
        let mut small = Vec::with_capacity(n * n);
        for row in rows {
            assert_eq!(row.len(), n, "matrix row is not {n} wide");
            small.extend_from_slice(row);
        }
        SubstitutionMatrix {
            kind: Kind::Table(Box::new(TableData {
                index,
                small,
                n,
                fallback,
            })),
        }
    }
}

/// Residue order shared by the BLOSUM and PAM tables below (NCBI convention).
const BLOSUM_ORDER: &[u8] = b"ARNDCQEGHILKMFPSTWYVBZX*";

#[rustfmt::skip]
const BLOSUM62: [&[i32]; 24] = [
    //        A   R   N   D   C   Q   E   G   H   I   L   K   M   F   P   S   T   W   Y   V   B   Z   X   *
    /* A */ &[ 4, -1, -2, -2,  0, -1, -1,  0, -2, -1, -1, -1, -1, -2, -1,  1,  0, -3, -2,  0, -2, -1,  0, -4],
    /* R */ &[-1,  5,  0, -2, -3,  1,  0, -2,  0, -3, -2,  2, -1, -3, -2, -1, -1, -3, -2, -3, -1,  0, -1, -4],
    /* N */ &[-2,  0,  6,  1, -3,  0,  0,  0,  1, -3, -3,  0, -2, -3, -2,  1,  0, -4, -2, -3,  3,  0, -1, -4],
    /* D */ &[-2, -2,  1,  6, -3,  0,  2, -1, -1, -3, -4, -1, -3, -3, -1,  0, -1, -4, -3, -3,  4,  1, -1, -4],
    /* C */ &[ 0, -3, -3, -3,  9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, -3, -3, -2, -4],
    /* Q */ &[-1,  1,  0,  0, -3,  5,  2, -2,  0, -3, -2,  1,  0, -3, -1,  0, -1, -2, -1, -2,  0,  3, -1, -4],
    /* E */ &[-1,  0,  0,  2, -4,  2,  5, -2,  0, -3, -3,  1, -2, -3, -1,  0, -1, -3, -2, -2,  1,  4, -1, -4],
    /* G */ &[ 0, -2,  0, -1, -3, -2, -2,  6, -2, -4, -4, -2, -3, -3, -2,  0, -2, -2, -3, -3, -1, -2, -1, -4],
    /* H */ &[-2,  0,  1, -1, -3,  0,  0, -2,  8, -3, -3, -1, -2, -1, -2, -1, -2, -2,  2, -3,  0,  0, -1, -4],
    /* I */ &[-1, -3, -3, -3, -1, -3, -3, -4, -3,  4,  2, -3,  1,  0, -3, -2, -1, -3, -1,  3, -3, -3, -1, -4],
    /* L */ &[-1, -2, -3, -4, -1, -2, -3, -4, -3,  2,  4, -2,  2,  0, -3, -2, -1, -2, -1,  1, -4, -3, -1, -4],
    /* K */ &[-1,  2,  0, -1, -3,  1,  1, -2, -1, -3, -2,  5, -1, -3, -1,  0, -1, -3, -2, -2,  0,  1, -1, -4],
    /* M */ &[-1, -1, -2, -3, -1,  0, -2, -3, -2,  1,  2, -1,  5,  0, -2, -1, -1, -1, -1,  1, -3, -1, -1, -4],
    /* F */ &[-2, -3, -3, -3, -2, -3, -3, -3, -1,  0,  0, -3,  0,  6, -4, -2, -2,  1,  3, -1, -3, -3, -1, -4],
    /* P */ &[-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4,  7, -1, -1, -4, -3, -2, -2, -1, -2, -4],
    /* S */ &[ 1, -1,  1,  0, -1,  0,  0,  0, -1, -2, -2,  0, -1, -2, -1,  4,  1, -3, -2, -2,  0,  0,  0, -4],
    /* T */ &[ 0, -1,  0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1,  1,  5, -2, -2,  0, -1, -1,  0, -4],
    /* W */ &[-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1,  1, -4, -3, -2, 11,  2, -3, -4, -3, -2, -4],
    /* Y */ &[-2, -2, -2, -3, -2, -1, -2, -3,  2, -1, -1, -2, -1,  3, -3, -2, -2,  2,  7, -1, -3, -2, -1, -4],
    /* V */ &[ 0, -3, -3, -3, -1, -2, -2, -3, -3,  3,  1, -2,  1, -1, -2, -2,  0, -3, -1,  4, -3, -2, -1, -4],
    /* B */ &[-2, -1,  3,  4, -3,  0,  1, -1,  0, -3, -4,  0, -3, -3, -2,  0, -1, -4, -3, -3,  4,  1, -1, -4],
    /* Z */ &[-1,  0,  0,  1, -3,  3,  4, -2,  0, -3, -3,  1, -1, -3, -1,  0, -1, -3, -2, -2,  1,  4, -1, -4],
    /* X */ &[ 0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -2,  0,  0, -2, -1, -1, -1, -1, -1, -4],
    /* * */ &[-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4,  1],
];

#[rustfmt::skip]
const BLOSUM45: [&[i32]; 24] = [
    //        A   R   N   D   C   Q   E   G   H   I   L   K   M   F   P   S   T   W   Y   V   B   Z   X   *
    /* A */ &[ 5, -2, -1, -2, -1, -1, -1,  0, -2, -1, -1, -1, -1, -2, -1,  1,  0, -2, -2,  0, -1, -1,  0, -5],
    /* R */ &[-2,  7,  0, -1, -3,  1,  0, -2,  0, -3, -2,  3, -1, -2, -2, -1, -1, -2, -1, -2, -1,  0, -1, -5],
    /* N */ &[-1,  0,  6,  2, -2,  0,  0,  0,  1, -2, -3,  0, -2, -2, -2,  1,  0, -4, -2, -3,  4,  0, -1, -5],
    /* D */ &[-2, -1,  2,  7, -3,  0,  2, -1,  0, -4, -3,  0, -3, -4, -1,  0, -1, -4, -2, -3,  5,  1, -1, -5],
    /* C */ &[-1, -3, -2, -3, 12, -3, -3, -3, -3, -3, -2, -3, -2, -2, -4, -1, -1, -5, -3, -1, -2, -3, -2, -5],
    /* Q */ &[-1,  1,  0,  0, -3,  6,  2, -2,  1, -2, -2,  1,  0, -4, -1,  0, -1, -2, -1, -3,  0,  4, -1, -5],
    /* E */ &[-1,  0,  0,  2, -3,  2,  6, -2,  0, -3, -2,  1, -2, -3,  0,  0, -1, -3, -2, -3,  1,  4, -1, -5],
    /* G */ &[ 0, -2,  0, -1, -3, -2, -2,  7, -2, -4, -3, -2, -2, -3, -2,  0, -2, -2, -3, -3, -1, -2, -1, -5],
    /* H */ &[-2,  0,  1,  0, -3,  1,  0, -2, 10, -3, -2, -1,  0, -2, -2, -1, -2, -3,  2, -3,  0,  0, -1, -5],
    /* I */ &[-1, -3, -2, -4, -3, -2, -3, -4, -3,  5,  2, -3,  2,  0, -2, -2, -1, -2,  0,  3, -3, -3, -1, -5],
    /* L */ &[-1, -2, -3, -3, -2, -2, -2, -3, -2,  2,  5, -3,  2,  1, -3, -3, -1, -2,  0,  1, -3, -2, -1, -5],
    /* K */ &[-1,  3,  0,  0, -3,  1,  1, -2, -1, -3, -3,  5, -1, -3, -1, -1, -1, -2, -1, -2,  0,  1, -1, -5],
    /* M */ &[-1, -1, -2, -3, -2,  0, -2, -2,  0,  2,  2, -1,  6,  0, -2, -2, -1, -2,  0,  1, -2, -1, -1, -5],
    /* F */ &[-2, -2, -2, -4, -2, -4, -3, -3, -2,  0,  1, -3,  0,  8, -3, -2, -1,  1,  3,  0, -3, -3, -1, -5],
    /* P */ &[-1, -2, -2, -1, -4, -1,  0, -2, -2, -2, -3, -1, -2, -3,  9, -1, -1, -3, -3, -3, -2, -1, -1, -5],
    /* S */ &[ 1, -1,  1,  0, -1,  0,  0,  0, -1, -2, -3, -1, -2, -2, -1,  4,  2, -4, -2, -1,  0,  0,  0, -5],
    /* T */ &[ 0, -1,  0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -1, -1,  2,  5, -3, -1,  0,  0, -1,  0, -5],
    /* W */ &[-2, -2, -4, -4, -5, -2, -3, -2, -3, -2, -2, -2, -2,  1, -3, -4, -3, 15,  3, -3, -4, -2, -2, -5],
    /* Y */ &[-2, -1, -2, -2, -3, -1, -2, -3,  2,  0,  0, -1,  0,  3, -3, -2, -1,  3,  8, -1, -2, -2, -1, -5],
    /* V */ &[ 0, -2, -3, -3, -1, -3, -3, -3, -3,  3,  1, -2,  1,  0, -3, -1,  0, -3, -1,  5, -3, -3, -1, -5],
    /* B */ &[-1, -1,  4,  5, -2,  0,  1, -1,  0, -3, -3,  0, -2, -3, -2,  0,  0, -4, -2, -3,  4,  2, -1, -5],
    /* Z */ &[-1,  0,  0,  1, -3,  4,  4, -2,  0, -3, -2,  1, -1, -3, -1,  0, -1, -2, -2, -3,  2,  4, -1, -5],
    /* X */ &[ 0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,  0,  0, -2, -1, -1, -1, -1, -1, -5],
    /* * */ &[-5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5,  1],
];

#[rustfmt::skip]
const BLOSUM80: [&[i32]; 24] = [
    //        A   R   N   D   C   Q   E   G   H   I   L   K   M   F   P   S   T   W   Y   V   B   Z   X   *
    /* A */ &[ 5, -2, -2, -2, -1, -1, -1,  0, -2, -2, -2, -1, -1, -3, -1,  1,  0, -3, -2,  0, -2, -1, -1, -6],
    /* R */ &[-2,  6, -1, -2, -4,  1, -1, -3,  0, -3, -3,  2, -2, -4, -2, -1, -1, -4, -3, -3, -1,  0, -1, -6],
    /* N */ &[-2, -1,  6,  1, -3,  0, -1, -1,  0, -4, -4,  0, -3, -4, -3,  0,  0, -4, -3, -4,  4,  0, -1, -6],
    /* D */ &[-2, -2,  1,  6, -4, -1,  1, -2, -2, -4, -5, -1, -4, -4, -2, -1, -1, -6, -4, -4,  4,  1, -2, -6],
    /* C */ &[-1, -4, -3, -4,  9, -4, -5, -4, -4, -2, -2, -4, -3, -3, -4, -2, -1, -3, -3, -1, -4, -4, -3, -6],
    /* Q */ &[-1,  1,  0, -1, -4,  6,  2, -2,  1, -3, -3,  1,  0, -4, -2,  0, -1, -3, -2, -3,  0,  4, -1, -6],
    /* E */ &[-1, -1, -1,  1, -5,  2,  6, -3,  0, -4, -4,  1, -2, -4, -2,  0, -1, -4, -3, -3,  1,  5, -1, -6],
    /* G */ &[ 0, -3, -1, -2, -4, -2, -3,  6, -3, -5, -4, -2, -4, -4, -3, -1, -2, -4, -4, -4, -1, -3, -2, -6],
    /* H */ &[-2,  0,  0, -2, -4,  1,  0, -3,  8, -4, -3, -1, -2, -2, -3, -1, -2, -3,  2, -4, -1,  0, -2, -6],
    /* I */ &[-2, -3, -4, -4, -2, -3, -4, -5, -4,  5,  1, -3,  1, -1, -4, -3, -1, -3, -2,  3, -4, -4, -2, -6],
    /* L */ &[-2, -3, -4, -5, -2, -3, -4, -4, -3,  1,  4, -3,  2,  0, -3, -3, -2, -2, -2,  1, -4, -3, -2, -6],
    /* K */ &[-1,  2,  0, -1, -4,  1,  1, -2, -1, -3, -3,  5, -2, -4, -1, -1, -1, -4, -3, -3, -1,  1, -1, -6],
    /* M */ &[-1, -2, -3, -4, -3,  0, -2, -4, -2,  1,  2, -2,  6,  0, -3, -2, -1, -2, -2,  1, -3, -2, -1, -6],
    /* F */ &[-3, -4, -4, -4, -3, -4, -4, -4, -2, -1,  0, -4,  0,  6, -4, -3, -2,  0,  3, -1, -4, -4, -2, -6],
    /* P */ &[-1, -2, -3, -2, -4, -2, -2, -3, -3, -4, -3, -1, -3, -4,  8, -1, -2, -5, -4, -3, -2, -2, -2, -6],
    /* S */ &[ 1, -1,  0, -1, -2,  0,  0, -1, -1, -3, -3, -1, -2, -3, -1,  5,  1, -4, -2, -2,  0,  0, -1, -6],
    /* T */ &[ 0, -1,  0, -1, -1, -1, -1, -2, -2, -1, -2, -1, -1, -2, -2,  1,  5, -4, -2,  0, -1, -1, -1, -6],
    /* W */ &[-3, -4, -4, -6, -3, -3, -4, -4, -3, -3, -2, -4, -2,  0, -5, -4, -4, 11,  2, -3, -5, -4, -3, -6],
    /* Y */ &[-2, -3, -3, -4, -3, -2, -3, -4,  2, -2, -2, -3, -2,  3, -4, -2, -2,  2,  7, -2, -3, -3, -2, -6],
    /* V */ &[ 0, -3, -4, -4, -1, -3, -3, -4, -4,  3,  1, -3,  1, -1, -3, -2,  0, -3, -2,  4, -4, -3, -1, -6],
    /* B */ &[-2, -1,  4,  4, -4,  0,  1, -1, -1, -4, -4, -1, -3, -4, -2,  0, -1, -5, -3, -4,  4,  0, -2, -6],
    /* Z */ &[-1,  0,  0,  1, -4,  4,  5, -3,  0, -4, -3,  1, -2, -4, -2,  0, -1, -4, -3, -3,  0,  4, -1, -6],
    /* X */ &[-1, -1, -1, -2, -3, -1, -1, -2, -2, -2, -2, -1, -1, -2, -2, -1, -1, -3, -2, -1, -2, -1, -1, -6],
    /* * */ &[-6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6, -6,  1],
];

#[rustfmt::skip]
const PAM250: [&[i32]; 24] = [
    //        A   R   N   D   C   Q   E   G   H   I   L   K   M   F   P   S   T   W   Y   V   B   Z   X   *
    /* A */ &[ 2, -2,  0,  0, -2,  0,  0,  1, -1, -1, -2, -1, -1, -3,  1,  1,  1, -6, -3,  0,  0,  0,  0, -8],
    /* R */ &[-2,  6,  0, -1, -4,  1, -1, -3,  2, -2, -3,  3,  0, -4,  0,  0, -1,  2, -4, -2, -1,  0, -1, -8],
    /* N */ &[ 0,  0,  2,  2, -4,  1,  1,  0,  2, -2, -3,  1, -2, -3,  0,  1,  0, -4, -2, -2,  2,  1,  0, -8],
    /* D */ &[ 0, -1,  2,  4, -5,  2,  3,  1,  1, -2, -4,  0, -3, -6, -1,  0,  0, -7, -4, -2,  3,  3, -1, -8],
    /* C */ &[-2, -4, -4, -5, 12, -5, -5, -3, -3, -2, -6, -5, -5, -4, -3,  0, -2, -8,  0, -2, -4, -5, -3, -8],
    /* Q */ &[ 0,  1,  1,  2, -5,  4,  2, -1,  3, -2, -2,  1, -1, -5,  0, -1, -1, -5, -4, -2,  1,  3, -1, -8],
    /* E */ &[ 0, -1,  1,  3, -5,  2,  4,  0,  1, -2, -3,  0, -2, -5, -1,  0,  0, -7, -4, -2,  3,  3, -1, -8],
    /* G */ &[ 1, -3,  0,  1, -3, -1,  0,  5, -2, -3, -4, -2, -3, -5,  0,  1,  0, -7, -5, -1,  0,  0, -1, -8],
    /* H */ &[-1,  2,  2,  1, -3,  3,  1, -2,  6, -2, -2,  0, -2, -2,  0, -1, -1, -3,  0, -2,  1,  2, -1, -8],
    /* I */ &[-1, -2, -2, -2, -2, -2, -2, -3, -2,  5,  2, -2,  2,  1, -2, -1,  0, -5, -1,  4, -2, -2, -1, -8],
    /* L */ &[-2, -3, -3, -4, -6, -2, -3, -4, -2,  2,  6, -3,  4,  2, -3, -3, -2, -2, -1,  2, -3, -3, -1, -8],
    /* K */ &[-1,  3,  1,  0, -5,  1,  0, -2,  0, -2, -3,  5,  0, -5, -1,  0,  0, -3, -4, -2,  1,  0, -1, -8],
    /* M */ &[-1,  0, -2, -3, -5, -1, -2, -3, -2,  2,  4,  0,  6,  0, -2, -2, -1, -4, -2,  2, -2, -2, -1, -8],
    /* F */ &[-3, -4, -3, -6, -4, -5, -5, -5, -2,  1,  2, -5,  0,  9, -5, -3, -3,  0,  7, -1, -4, -5, -2, -8],
    /* P */ &[ 1,  0,  0, -1, -3,  0, -1,  0,  0, -2, -3, -1, -2, -5,  6,  1,  0, -6, -5, -1, -1,  0, -1, -8],
    /* S */ &[ 1,  0,  1,  0,  0, -1,  0,  1, -1, -1, -3,  0, -2, -3,  1,  2,  1, -2, -3, -1,  0,  0,  0, -8],
    /* T */ &[ 1, -1,  0,  0, -2, -1,  0,  0, -1,  0, -2,  0, -1, -3,  0,  1,  3, -5, -3,  0,  0, -1,  0, -8],
    /* W */ &[-6,  2, -4, -7, -8, -5, -7, -7, -3, -5, -2, -3, -4,  0, -6, -2, -5, 17,  0, -6, -5, -6, -4, -8],
    /* Y */ &[-3, -4, -2, -4,  0, -4, -4, -5,  0, -1, -1, -4, -2,  7, -5, -3, -3,  0, 10, -2, -3, -4, -2, -8],
    /* V */ &[ 0, -2, -2, -2, -2, -2, -2, -1, -2,  4,  2, -2,  2, -1, -1, -1,  0, -6, -2,  4, -2, -2, -1, -8],
    /* B */ &[ 0, -1,  2,  3, -4,  1,  3,  0,  1, -2, -3,  1, -2, -4, -1,  0,  0, -5, -3, -2,  3,  2, -1, -8],
    /* Z */ &[ 0,  0,  1,  3, -5,  3,  3,  0,  2, -2, -3,  0, -2, -5,  0,  0, -1, -6, -4, -2,  2,  3, -1, -8],
    /* X */ &[ 0, -1,  0, -1, -3, -1, -1, -1, -1, -1, -1, -1, -1, -2, -1,  0,  0, -4, -2, -1, -1, -1, -1, -8],
    /* * */ &[-8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8, -8,  1],
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_mismatch_is_case_insensitive() {
        let m = SubstitutionMatrix::match_mismatch(2, -1);
        assert_eq!(m.score(b'A', b'A'), 2);
        assert_eq!(m.score(b'a', b'A'), 2); // soft-masked still matches
        assert_eq!(m.score(b'A', b'C'), -1);
        assert_eq!(m.score(b'g', b'g'), 2);
    }

    #[test]
    fn default_for_alphabet() {
        use crate::model::Alphabet::*;
        assert_eq!(SubstitutionMatrix::default_for(Dna).score(b'A', b'A'), 2);
        assert_eq!(SubstitutionMatrix::default_for(Rna).score(b'U', b'C'), -1);
        // protein default is BLOSUM62: W·W = 11.
        assert_eq!(
            SubstitutionMatrix::default_for(Protein).score(b'W', b'W'),
            11
        );
    }

    // Each named matrix: must be symmetric (catches any single-cell transcription
    // typo) and match known reference cells.
    fn assert_symmetric(m: &SubstitutionMatrix) {
        for &a in BLOSUM_ORDER {
            for &b in BLOSUM_ORDER {
                assert_eq!(
                    m.score(a, b),
                    m.score(b, a),
                    "asymmetry at {}/{}",
                    a as char,
                    b as char
                );
            }
        }
    }

    #[test]
    fn blosum62_reference_values() {
        let m = SubstitutionMatrix::blosum62();
        assert_symmetric(&m);
        assert_eq!(m.score(b'A', b'A'), 4);
        assert_eq!(m.score(b'C', b'C'), 9);
        assert_eq!(m.score(b'W', b'W'), 11);
        assert_eq!(m.score(b'A', b'R'), -1);
        assert_eq!(m.score(b'I', b'L'), 2);
        assert_eq!(m.score(b'P', b'W'), -4);
        // case-insensitive + unknown → X fallback (X·A = 0).
        assert_eq!(m.score(b'a', b'a'), 4);
        assert_eq!(m.score(b'?', b'A'), m.score(b'X', b'A'));
    }

    #[test]
    fn blosum45_reference_values() {
        let m = SubstitutionMatrix::blosum45();
        assert_symmetric(&m);
        assert_eq!(m.score(b'A', b'A'), 5);
        assert_eq!(m.score(b'C', b'C'), 12);
        assert_eq!(m.score(b'W', b'W'), 15);
        assert_eq!(m.score(b'R', b'K'), 3);
    }

    #[test]
    fn blosum80_reference_values() {
        let m = SubstitutionMatrix::blosum80();
        assert_symmetric(&m);
        assert_eq!(m.score(b'A', b'A'), 5);
        assert_eq!(m.score(b'C', b'C'), 9);
        assert_eq!(m.score(b'W', b'W'), 11);
        assert_eq!(m.score(b'E', b'E'), 6);
    }

    #[test]
    fn pam250_reference_values() {
        let m = SubstitutionMatrix::pam250();
        assert_symmetric(&m);
        assert_eq!(m.score(b'A', b'A'), 2);
        assert_eq!(m.score(b'C', b'C'), 12);
        assert_eq!(m.score(b'W', b'W'), 17);
        assert_eq!(m.score(b'Y', b'Y'), 10);
    }
}
