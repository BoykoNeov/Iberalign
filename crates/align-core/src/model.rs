//! Core data model: alphabets, sequences, aligned rows, alignments.
//!
//! The single largest source of bugs in alignment tools is conflating the
//! three coordinate spaces (ungapped position, alignment column, screen
//! pixel). This module owns the first two; the coordinate mapping lives in
//! [`crate::coords`]. Screen pixels are a render-layer concern (frontend).

use crate::coords::is_gap;
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

    /// The more general of two alphabets (`Protein` > `Rna` > `Dna`), so a
    /// mixed set is described by its most general member.
    pub fn widen(self, other: Alphabet) -> Alphabet {
        use Alphabet::*;
        match (self, other) {
            (Protein, _) | (_, Protein) => Protein,
            (Rna, _) | (_, Rna) => Rna,
            _ => Dna,
        }
    }

    /// Infer an alphabet from residue composition. The analysis boundary
    /// normalizes case, so soft-masked (lowercase) input classifies the same
    /// as uppercase. Heuristic: if ≥90% of letters look nucleic it's a nucleic
    /// acid, and a `U` without a `T` marks RNA; otherwise protein.
    pub fn infer(residues: &[u8]) -> Alphabet {
        let mut nucleic = 0usize;
        let mut letters = 0usize;
        let mut has_u = false;
        let mut has_t = false;
        for &b in residues {
            let c = b.to_ascii_uppercase();
            if !c.is_ascii_alphabetic() {
                continue; // ignore gaps, '*', etc. for inference
            }
            letters += 1;
            match c {
                b'A' | b'C' | b'G' | b'T' | b'U' | b'N' => {
                    nucleic += 1;
                    has_u |= c == b'U';
                    has_t |= c == b'T';
                }
                // Common nucleotide IUPAC ambiguity codes.
                b'R' | b'Y' | b'S' | b'W' | b'K' | b'M' | b'B' | b'D' | b'H' | b'V' => {
                    nucleic += 1;
                }
                _ => {}
            }
        }
        if letters == 0 {
            return Alphabet::Dna;
        }
        if nucleic * 10 >= letters * 9 {
            if has_u && !has_t {
                Alphabet::Rna
            } else {
                Alphabet::Dna
            }
        } else {
            Alphabet::Protein
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
    /// Ungapped residues, ASCII; IUPAC ambiguity codes and `*` stop codons
    /// allowed. **Original case is preserved** — lowercase soft-masking is
    /// data; analyses normalize case at their own boundary (see
    /// [`Alphabet::infer`]), never here.
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

/// A parsed FASTA record, before alignment construction.
///
/// `gapped` is the record's literal residue/gap stream as it appeared in the
/// file, with two normalizations applied at the parse boundary: `.` gaps are
/// rewritten to `b'-'` (so a gap is always `b'-'` in memory), and interior
/// whitespace is stripped. **Original residue case is preserved.** The ungapped
/// [`Sequence`] is *derived* from this stream by [`Dataset::from_records`] — it
/// is not the primary artifact.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawRecord {
    pub name: String,
    pub description: String,
    pub gapped: Vec<u8>,
}

/// A loaded dataset: the gapped [`Alignment`] plus the per-row ungapped
/// [`Sequence`]s it references by `seq_id` (aligned by index — `sequences[i]`
/// is `rows[i]`). The frontend renders the alignment; features and analyses
/// anchor to the sequences.
#[derive(Debug, Default)]
pub struct Dataset {
    pub alignment: Alignment,
    pub sequences: Vec<Sequence>,
}

impl Dataset {
    /// Build a dataset from parsed records.
    ///
    /// Each row is padded to the widest record by **appending trailing gaps
    /// only** — already-aligned (equal-length) input is padded not at all, and
    /// ragged input is left-justified. Interior gaps are never stripped or
    /// moved: doing so would silently destroy an existing alignment
    /// (`ACGT-AC` / `AC-GTAC` must *not* both collapse to `ACGTAC`). The
    /// ungapped `Sequence.residues` are derived per row, with case preserved.
    pub fn from_records(records: &[RawRecord]) -> Self {
        let width = records.iter().map(|r| r.gapped.len()).max().unwrap_or(0);
        let mut sequences = Vec::with_capacity(records.len());
        let mut rows = Vec::with_capacity(records.len());
        for (i, rec) in records.iter().enumerate() {
            let id = i as SeqId;
            // Pad to common width with trailing gaps; never touch interior cells.
            let mut gapped = rec.gapped.clone();
            gapped.resize(width, b'-');
            // Derive the ungapped residues (case preserved).
            let residues: Vec<u8> = rec.gapped.iter().copied().filter(|&b| !is_gap(b)).collect();
            let alphabet = Alphabet::infer(&residues);
            sequences.push(Sequence {
                id,
                name: rec.name.clone(),
                description: rec.description.clone(),
                alphabet,
                residues,
            });
            rows.push(AlignedRow::new(id, gapped));
        }
        Dataset {
            alignment: Alignment::from_rows(rows),
            sequences,
        }
    }
}
