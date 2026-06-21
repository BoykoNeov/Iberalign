//! Core data model: alphabets, sequences, aligned rows, alignments.
//!
//! The single largest source of bugs in alignment tools is conflating the
//! three coordinate spaces (ungapped position, alignment column, screen
//! pixel). This module owns the first two; the coordinate mapping lives in
//! [`crate::coords`]. Screen pixels are a render-layer concern (frontend).

use std::cell::OnceCell;

/// Sequence alphabet. Inferred at parse time, overridable by the user.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Alphabet {
    Dna,
    Rna,
    Protein,
}

impl Alphabet {
    /// Human-readable label for UI/CLI summaries.
    pub fn label(self) -> &'static str {
        match self {
            Alphabet::Dna => "DNA",
            Alphabet::Rna => "RNA",
            Alphabet::Protein => "Protein",
        }
    }
}

/// Stable identifier for a sequence within one loaded alignment.
pub type SeqId = u32;

/// A raw, ungapped sequence as parsed from a file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sequence {
    pub id: SeqId,
    pub name: String,
    pub description: String,
    pub alphabet: Alphabet,
    /// Ungapped residues, uppercase ASCII; IUPAC ambiguity codes allowed.
    pub residues: Vec<u8>,
}

/// One row of an alignment: residues interspersed with gap characters.
///
/// `col_to_pos` / `pos_to_col` are lazily built prefix indexes mapping between
/// the two coordinate spaces. They are invalidated (reset) whenever `gapped`
/// is edited; the mapping methods live in [`crate::coords`].
#[derive(Debug)]
pub struct AlignedRow {
    pub seq_id: SeqId,
    /// Residues interspersed with gaps (`b'-'`); `len == alignment width`.
    pub gapped: Vec<u8>,
    pub(crate) col_to_pos: OnceCell<Vec<i32>>,
    pub(crate) pos_to_col: OnceCell<Vec<u32>>,
}

impl AlignedRow {
    pub fn new(seq_id: SeqId, gapped: Vec<u8>) -> Self {
        Self {
            seq_id,
            gapped,
            col_to_pos: OnceCell::new(),
            pos_to_col: OnceCell::new(),
        }
    }

    /// Number of columns this row spans.
    pub fn width(&self) -> usize {
        self.gapped.len()
    }

    /// Reset the lazy coordinate indexes after a mutation of `gapped`.
    pub fn invalidate_index(&mut self) {
        self.col_to_pos = OnceCell::new();
        self.pos_to_col = OnceCell::new();
    }
}

impl Clone for AlignedRow {
    fn clone(&self) -> Self {
        // Drop the lazily-built caches on clone; they rebuild on demand.
        AlignedRow::new(self.seq_id, self.gapped.clone())
    }
}

/// An alignment: rows of equal width plus cached per-column analyses.
///
/// Rust owns the *authoritative* alignment in the desktop app (behind a
/// `Mutex` in Tauri managed state); the frontend keeps only a render-buffer
/// copy. Edits mutate this and invalidate the caches below.
#[derive(Debug, Default)]
pub struct Alignment {
    pub width: usize,
    pub rows: Vec<AlignedRow>,
    pub(crate) consensus: OnceCell<Vec<u8>>,
    pub(crate) conservation: OnceCell<Vec<f32>>,
}

impl Alignment {
    /// Build an alignment from rows that are already gap-padded to a common
    /// width. Panics if rows disagree on width — callers padding from raw
    /// sequences must pad first.
    pub fn from_rows(rows: Vec<AlignedRow>) -> Self {
        let width = rows.first().map(|r| r.gapped.len()).unwrap_or(0);
        debug_assert!(
            rows.iter().all(|r| r.gapped.len() == width),
            "all aligned rows must share one width"
        );
        Alignment {
            width,
            rows,
            consensus: OnceCell::new(),
            conservation: OnceCell::new(),
        }
    }

    pub fn num_rows(&self) -> usize {
        self.rows.len()
    }

    /// Invalidate per-column caches after an edit. Row coordinate indexes are
    /// invalidated separately on the rows that changed.
    pub fn invalidate_caches(&mut self) {
        self.consensus = OnceCell::new();
        self.conservation = OnceCell::new();
    }
}
