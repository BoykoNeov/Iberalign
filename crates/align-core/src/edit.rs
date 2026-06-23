//! Editing as reversible commands (M5). Every mutation to the authoritative
//! `Alignment` goes through this command stack so undo/redo is lossless and
//! features remap automatically via the coordinate API.
//!
//! Status (Batch B — edit foundation): `SetCells` (in-place overwrite) is
//! implemented with apply/inverse, plus the [`EditStack`] undo/redo history over
//! a whole [`Dataset`]. The width-changing block commands (insert/delete) and
//! the gap-edit/row commands remain `todo!()` until their batches land.

use crate::coords::is_gap;
use crate::model::{Alignment, Dataset, SeqId};
use std::fmt;
use std::ops::Range;

/// Which rows an edit applies to.
#[derive(Clone, Debug)]
pub enum RowSel {
    One(usize),
    Many(Vec<usize>),
    All,
}

/// A single contiguous overwrite within one row: write `bytes` over the cells
/// starting at column `col` of row `row`. The building block of
/// [`EditCmd::SetCells`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellWrite {
    pub row: usize,
    pub col: usize,
    pub bytes: Vec<u8>,
}

/// A reversible edit. Applying a command returns its inverse for the undo
/// stack and reports which rows changed so the frontend can patch its buffer.
#[derive(Clone, Debug)]
pub enum EditCmd {
    /// Overwrite cells in place — never changes the alignment width. The inverse
    /// is another `SetCells` restoring the old bytes. This is the primitive
    /// behind delete-to-gap (mask) and paste-overwrite.
    SetCells {
        writes: Vec<CellWrite>,
    },
    InsertGap {
        rows: RowSel,
        col: usize,
        count: usize,
    },
    /// Delete only over existing gaps.
    DeleteGap {
        rows: RowSel,
        col: usize,
        count: usize,
    },
    /// Slide residues across adjacent gaps.
    SlideResidues {
        row: usize,
        range: Range<usize>,
        delta: i32,
    },
    ReorderRows {
        from: usize,
        to: usize,
    },
    RenameSeq {
        seq_id: SeqId,
        name: String,
    },
    SetRowHidden {
        seq_id: SeqId,
        hidden: bool,
    },
    DeleteSeq {
        seq_id: SeqId,
    },
}

/// Why an edit could not be applied. Edits validate fully *before* mutating, so
/// an `Err` always leaves the alignment untouched (apply is atomic).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditError {
    RowOutOfBounds {
        row: usize,
        num_rows: usize,
    },
    ColOutOfBounds {
        row: usize,
        end: usize,
        width: usize,
    },
}

impl fmt::Display for EditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EditError::RowOutOfBounds { row, num_rows } => {
                write!(f, "row {row} out of bounds (alignment has {num_rows} rows)")
            }
            EditError::ColOutOfBounds { row, end, width } => {
                write!(
                    f,
                    "write reaching col {end} exceeds width {width} in row {row}"
                )
            }
        }
    }
}

impl std::error::Error for EditError {}

/// Outcome of applying an edit: the inverse command and the changed rows.
#[derive(Clone, Debug)]
pub struct EditOutcome {
    pub inverse: EditCmd,
    pub changed_rows: Vec<usize>,
}

/// Apply a command to the gapped alignment matrix, returning the inverse + the
/// changed rows (sorted, deduped). **Matrix-level only:** it keeps every row at
/// the alignment width and invalidates the touched rows' coordinate indexes and
/// the per-column caches, but it does NOT resync the derived ungapped
/// `Sequence`s — those live in [`Dataset`]. Route real edits through
/// [`apply_to_dataset`] / [`EditStack`], which wrap this with the resync, so a
/// caller can't forget it.
///
/// Only [`EditCmd::SetCells`] is implemented (Batch B); the rest are `todo!()`.
pub fn apply(aln: &mut Alignment, cmd: EditCmd) -> Result<EditOutcome, EditError> {
    match cmd {
        EditCmd::SetCells { writes } => apply_set_cells(aln, writes),
        EditCmd::InsertGap { .. }
        | EditCmd::DeleteGap { .. }
        | EditCmd::SlideResidues { .. }
        | EditCmd::ReorderRows { .. }
        | EditCmd::RenameSeq { .. }
        | EditCmd::SetRowHidden { .. }
        | EditCmd::DeleteSeq { .. } => todo!("M5: implement the remaining edit commands"),
    }
}

fn apply_set_cells(aln: &mut Alignment, writes: Vec<CellWrite>) -> Result<EditOutcome, EditError> {
    let num_rows = aln.rows.len();
    // Validate ALL writes before mutating anything, so a bad write leaves the
    // alignment untouched (atomic apply — no half-edited state behind an `Err`).
    for w in &writes {
        let row = aln.rows.get(w.row).ok_or(EditError::RowOutOfBounds {
            row: w.row,
            num_rows,
        })?;
        let end = w.col + w.bytes.len();
        if end > row.gapped.len() {
            return Err(EditError::ColOutOfBounds {
                row: w.row,
                end,
                width: row.gapped.len(),
            });
        }
    }

    // Mutate, capturing the old bytes for the inverse.
    let mut inverse_writes: Vec<CellWrite> = Vec::with_capacity(writes.len());
    let mut changed_rows: Vec<usize> = Vec::with_capacity(writes.len());
    for w in &writes {
        let row = &mut aln.rows[w.row];
        let end = w.col + w.bytes.len();
        let old = row.gapped[w.col..end].to_vec();
        row.gapped[w.col..end].copy_from_slice(&w.bytes);
        row.invalidate_index();
        inverse_writes.push(CellWrite {
            row: w.row,
            col: w.col,
            bytes: old,
        });
        changed_rows.push(w.row);
    }
    // The inverse must replay in REVERSE order so overlapping writes to the same
    // row round-trip exactly (later write's "old" was the earlier write's "new").
    inverse_writes.reverse();

    if !changed_rows.is_empty() {
        aln.invalidate_caches();
    }
    changed_rows.sort_unstable();
    changed_rows.dedup();

    Ok(EditOutcome {
        inverse: EditCmd::SetCells {
            writes: inverse_writes,
        },
        changed_rows,
    })
}

/// Re-derive the ungapped residues for `row` from its (just-edited) gapped
/// bytes. `Sequence.residues` is a cache derived from `AlignedRow.gapped` at
/// construction (see [`Dataset::from_records`]); an edit to the gapped row must
/// refresh it or downstream analyses/coords/export read stale data.
/// `sequences[i]` is index-aligned with `rows[i]` (both built in record order),
/// so the row index indexes both.
fn resync_residues(ds: &mut Dataset, row: usize) {
    let residues: Vec<u8> = ds.alignment.rows[row]
        .gapped
        .iter()
        .copied()
        .filter(|&b| !is_gap(b))
        .collect();
    ds.sequences[row].residues = residues;
}

/// Apply a command to a whole [`Dataset`]: mutate the gapped alignment, then
/// resync the derived ungapped residues for every changed row. Prefer this (or
/// [`EditStack`]) over the bare matrix-level [`apply`], which a caller could
/// pair with a forgotten resync.
pub fn apply_to_dataset(ds: &mut Dataset, cmd: EditCmd) -> Result<EditOutcome, EditError> {
    let outcome = apply(&mut ds.alignment, cmd)?;
    for &r in &outcome.changed_rows {
        resync_residues(ds, r);
    }
    Ok(outcome)
}

/// A reversible edit history over a [`Dataset`]. Applying a command records its
/// inverse for undo and clears the redo stack (a fresh edit forks history);
/// undo/redo move commands between the two stacks. Each step returns the changed
/// rows so the frontend can refresh its render buffer. Pure engine state — the
/// desktop app embeds one in its `AppState`, but it has no Tauri/UI dependency.
#[derive(Default)]
pub struct EditStack {
    undo: Vec<EditCmd>,
    redo: Vec<EditCmd>,
}

impl EditStack {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forget all history — call when a new dataset is loaded (old row indexes
    /// no longer refer to anything).
    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Apply a fresh edit: mutate the dataset, push the inverse for undo, and
    /// clear the redo stack. A no-op edit (no changed rows) is not recorded.
    /// Returns the changed rows.
    pub fn apply(&mut self, ds: &mut Dataset, cmd: EditCmd) -> Result<Vec<usize>, EditError> {
        let outcome = apply_to_dataset(ds, cmd)?;
        if !outcome.changed_rows.is_empty() {
            self.undo.push(outcome.inverse);
            self.redo.clear();
        }
        Ok(outcome.changed_rows)
    }

    /// Undo the most recent edit. Returns the changed rows, or `None` when there
    /// is nothing to undo.
    pub fn undo(&mut self, ds: &mut Dataset) -> Result<Option<Vec<usize>>, EditError> {
        let Some(inverse) = self.undo.pop() else {
            return Ok(None);
        };
        let outcome = apply_to_dataset(ds, inverse)?;
        self.redo.push(outcome.inverse);
        Ok(Some(outcome.changed_rows))
    }

    /// Redo the most recently undone edit. Returns the changed rows, or `None`.
    pub fn redo(&mut self, ds: &mut Dataset) -> Result<Option<Vec<usize>>, EditError> {
        let Some(inverse) = self.redo.pop() else {
            return Ok(None);
        };
        let outcome = apply_to_dataset(ds, inverse)?;
        self.undo.push(outcome.inverse);
        Ok(Some(outcome.changed_rows))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AlignedRow, RawRecord};

    fn aln(rows: &[&str]) -> Alignment {
        Alignment::from_rows(
            rows.iter()
                .enumerate()
                .map(|(i, s)| AlignedRow::new(i as SeqId, s.as_bytes().to_vec()))
                .collect(),
        )
    }

    fn write(row: usize, col: usize, bytes: &str) -> CellWrite {
        CellWrite {
            row,
            col,
            bytes: bytes.as_bytes().to_vec(),
        }
    }

    fn set(writes: Vec<CellWrite>) -> EditCmd {
        EditCmd::SetCells { writes }
    }

    fn dataset(records: &[(&str, &str)]) -> Dataset {
        let recs: Vec<RawRecord> = records
            .iter()
            .map(|(name, gapped)| RawRecord {
                name: name.to_string(),
                description: String::new(),
                gapped: gapped.as_bytes().to_vec(),
            })
            .collect();
        Dataset::from_records(&recs)
    }

    #[test]
    fn set_cells_overwrites_in_place_and_preserves_width() {
        let mut a = aln(&["ACGT", "TTTT"]);
        let out = apply(&mut a, set(vec![write(0, 1, "XY")])).unwrap();
        assert_eq!(a.rows[0].gapped, b"AXYT");
        assert_eq!(a.rows[1].gapped, b"TTTT");
        assert_eq!(a.width, 4);
        assert_eq!(out.changed_rows, vec![0]);
    }

    #[test]
    fn set_cells_inverse_round_trips() {
        let mut a = aln(&["ACGT", "TTTT"]);
        let out = apply(&mut a, set(vec![write(0, 0, "--"), write(1, 2, "GG")])).unwrap();
        assert_eq!(a.rows[0].gapped, b"--GT");
        assert_eq!(a.rows[1].gapped, b"TTGG");
        apply(&mut a, out.inverse).unwrap();
        assert_eq!(a.rows[0].gapped, b"ACGT");
        assert_eq!(a.rows[1].gapped, b"TTTT");
    }

    #[test]
    fn changed_rows_sorted_and_deduped() {
        let mut a = aln(&["ACGT", "TTTT", "GGGG"]);
        let out = apply(
            &mut a,
            set(vec![write(2, 0, "C"), write(0, 0, "C"), write(2, 3, "C")]),
        )
        .unwrap();
        assert_eq!(out.changed_rows, vec![0, 2]);
    }

    #[test]
    fn overlapping_writes_inverse_restores_exactly() {
        // Two writes to the same row with overlapping columns: the inverse must
        // replay in reverse order to restore the original bytes.
        let mut a = aln(&["ABCD"]);
        let out = apply(&mut a, set(vec![write(0, 0, "XX"), write(0, 1, "YY")])).unwrap();
        assert_eq!(a.rows[0].gapped, b"XYYD");
        apply(&mut a, out.inverse).unwrap();
        assert_eq!(a.rows[0].gapped, b"ABCD");
    }

    #[test]
    fn out_of_bounds_row_errors_atomically() {
        let mut a = aln(&["ACGT"]);
        let err = apply(&mut a, set(vec![write(0, 0, "X"), write(5, 0, "X")])).unwrap_err();
        assert_eq!(
            err,
            EditError::RowOutOfBounds {
                row: 5,
                num_rows: 1
            }
        );
        // Atomic: the valid first write did NOT land.
        assert_eq!(a.rows[0].gapped, b"ACGT");
    }

    #[test]
    fn out_of_bounds_col_errors_atomically() {
        let mut a = aln(&["ACGT"]);
        let err = apply(&mut a, set(vec![write(0, 3, "XX")])).unwrap_err();
        assert_eq!(
            err,
            EditError::ColOutOfBounds {
                row: 0,
                end: 5,
                width: 4
            }
        );
        assert_eq!(a.rows[0].gapped, b"ACGT");
    }

    #[test]
    fn stack_apply_undo_redo_round_trip() {
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let mut stack = EditStack::new();

        let changed = stack.apply(&mut ds, set(vec![write(0, 1, "--")])).unwrap();
        assert_eq!(changed, vec![0]);
        assert_eq!(ds.alignment.rows[0].gapped, b"A--T");
        assert!(stack.can_undo());
        assert!(!stack.can_redo());

        assert_eq!(stack.undo(&mut ds).unwrap(), Some(vec![0]));
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert!(!stack.can_undo());
        assert!(stack.can_redo());

        assert_eq!(stack.redo(&mut ds).unwrap(), Some(vec![0]));
        assert_eq!(ds.alignment.rows[0].gapped, b"A--T");
    }

    #[test]
    fn stack_resyncs_ungapped_residues_through_undo() {
        let mut ds = dataset(&[("a", "ACGT")]);
        assert_eq!(ds.sequences[0].residues, b"ACGT");
        let mut stack = EditStack::new();
        // Mask cols 1,2 → ungapped residues drop to "AT".
        stack.apply(&mut ds, set(vec![write(0, 1, "--")])).unwrap();
        assert_eq!(ds.alignment.rows[0].gapped, b"A--T");
        assert_eq!(ds.sequences[0].residues, b"AT");
        // Undo restores the gapped row AND the derived residues.
        stack.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.sequences[0].residues, b"ACGT");
    }

    #[test]
    fn fresh_edit_forks_history_clearing_redo() {
        let mut ds = dataset(&[("a", "ACGT")]);
        let mut stack = EditStack::new();
        stack.apply(&mut ds, set(vec![write(0, 0, "X")])).unwrap();
        stack.undo(&mut ds).unwrap();
        assert!(stack.can_redo());
        stack.apply(&mut ds, set(vec![write(0, 1, "Y")])).unwrap();
        assert!(!stack.can_redo());
    }

    #[test]
    fn undo_redo_on_empty_stack_is_none() {
        let mut ds = dataset(&[("a", "ACGT")]);
        let mut stack = EditStack::new();
        assert_eq!(stack.undo(&mut ds).unwrap(), None);
        assert_eq!(stack.redo(&mut ds).unwrap(), None);
    }

    #[test]
    fn noop_edit_is_not_recorded() {
        let mut ds = dataset(&[("a", "ACGT")]);
        let mut stack = EditStack::new();
        let changed = stack.apply(&mut ds, set(vec![])).unwrap();
        assert!(changed.is_empty());
        assert!(!stack.can_undo());
    }

    #[test]
    fn clear_forgets_history() {
        let mut ds = dataset(&[("a", "ACGT")]);
        let mut stack = EditStack::new();
        stack.apply(&mut ds, set(vec![write(0, 0, "X")])).unwrap();
        stack.undo(&mut ds).unwrap();
        assert!(stack.can_redo());
        stack.clear();
        assert!(!stack.can_undo());
        assert!(!stack.can_redo());
    }
}
