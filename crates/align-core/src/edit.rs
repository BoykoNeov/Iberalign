//! Editing as reversible commands (M5). Every mutation to the authoritative
//! `Alignment` goes through this command stack so undo/redo is lossless and
//! features remap automatically via the coordinate API.
//!
//! Status (Batch B — edit foundation): `SetCells` (in-place overwrite) is
//! implemented with apply/inverse, plus the [`EditStack`] undo/redo history over
//! a whole [`Dataset`]. The width-changing block commands (insert/delete) and
//! the gap-edit/row commands remain `todo!()` until their batches land.

use crate::coords::is_gap;
use crate::model::{AlignedRow, Alignment, Alphabet, Dataset, SeqId, Sequence};
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

/// Replace `gapped[col..col+remove]` with `bytes` in one row — the building block
/// of width-CHANGING edits (insert/delete a contiguous run within a row). An
/// insert is `remove == 0`; a delete is `bytes` shorter than `remove`. The
/// building block of [`EditCmd::SpliceRows`], whose callers build at most one
/// splice per row so that all rows end at one shared width.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowSplice {
    pub row: usize,
    pub col: usize,
    pub remove: usize,
    pub bytes: Vec<u8>,
}

/// A whole new sequence row to splice into the alignment — the payload of
/// [`EditCmd::InsertRows`]. `gapped` is already gap-padded/truncated to the
/// alignment width by the caller (so the inserted rows keep the single-width
/// invariant); the ungapped residues + alphabet are *derived* from it at apply
/// time. `id` is supplied by the caller (a fresh, non-colliding [`SeqId`] for a
/// paste; the captured original id when this row is the inverse of a delete) so
/// insert/delete round-trip losslessly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowData {
    pub id: SeqId,
    pub name: String,
    pub description: String,
    pub gapped: Vec<u8>,
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
    /// Splice contiguous runs within rows — the primitive behind width-CHANGING
    /// edits (paste-insert; cut-shorten later). Each [`RowSplice`] replaces a run
    /// in one row; the inverse is another `SpliceRows` (every splice captures the
    /// bytes it removed). Callers MUST keep all rows equal-width — apply validates
    /// it and rejects a ragged result without mutating.
    SpliceRows {
        splices: Vec<RowSplice>,
    },
    /// Insert whole new sequence rows at row index `at` (existing rows from `at`
    /// shift down) — the primitive behind paste-as-sequences. Dataset-level: it
    /// adds both an [`AlignedRow`] and its ungapped [`Sequence`] (so it routes
    /// through [`apply_to_dataset`], never the matrix-only [`apply`]). Each row's
    /// `gapped` must already equal the alignment width; the inverse is a
    /// [`EditCmd::DeleteRows`] of the same range.
    InsertRows {
        at: usize,
        rows: Vec<RowData>,
    },
    /// Remove `count` whole rows starting at row index `at` — the inverse of
    /// [`EditCmd::InsertRows`] (and the future row-delete UI). Dataset-level: it
    /// drops both the [`AlignedRow`]s and their [`Sequence`]s, capturing them so
    /// its inverse re-inserts them verbatim (ids/names preserved).
    DeleteRows {
        at: usize,
        count: usize,
    },
    /// Apply several commands as ONE reversible unit. The sub-commands run in
    /// order; the batch's inverse is each sub-command's inverse in REVERSE order.
    /// The primitive behind compound edits — e.g. paste-as-sequences that GROWS
    /// the alignment: pad every existing row to the new width ([`EditCmd::SpliceRows`]),
    /// then insert the wider new rows ([`EditCmd::InsertRows`]), as one undo. Atomic:
    /// if any sub-command fails, the already-applied ones are rolled back (their
    /// inverses replayed), leaving the dataset untouched. Sub-commands may be
    /// structural OR matrix, so it routes through [`apply_to_dataset`], never the
    /// matrix-only [`apply`].
    Batch {
        commands: Vec<EditCmd>,
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
    /// A [`EditCmd::SpliceRows`] set would leave rows of differing widths (it must
    /// keep the single-width invariant). Reported before any mutation, so the
    /// alignment is untouched. `row` is the first row whose resulting width `got`
    /// diverges from the shared `expected` width.
    WidthMismatch {
        row: usize,
        got: usize,
        expected: usize,
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
            EditError::WidthMismatch { row, got, expected } => {
                write!(
                    f,
                    "splice would leave row {row} at width {got}, not the shared {expected}"
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
        EditCmd::SpliceRows { splices } => apply_splice_rows(aln, splices),
        // Structural / compound commands need the whole `Dataset` (sequences +
        // names), not just the matrix — `apply_to_dataset` intercepts them before
        // they ever reach here. Reaching this arm is a routing bug, not a `todo!()`.
        EditCmd::InsertRows { .. } | EditCmd::DeleteRows { .. } | EditCmd::Batch { .. } => {
            unreachable!(
                "InsertRows/DeleteRows/Batch are Dataset-level — route through apply_to_dataset"
            )
        }
        EditCmd::InsertGap { .. }
        | EditCmd::DeleteGap { .. }
        | EditCmd::SlideResidues { .. }
        | EditCmd::ReorderRows { .. }
        | EditCmd::RenameSeq { .. }
        | EditCmd::SetRowHidden { .. }
        | EditCmd::DeleteSeq { .. } => todo!("M5: implement the remaining edit commands"),
    }
}

/// Insert whole new rows at index `at`, returning a [`EditCmd::DeleteRows`]
/// inverse. Adds an [`AlignedRow`] + a derived [`Sequence`] per row to the
/// dataset, keeping `sequences[i]` index-aligned with `rows[i]`. Atomic: every
/// row's width is validated before any mutation. Each new row's `gapped` must
/// equal the alignment width — except when the alignment is empty (no rows yet),
/// where the inserted rows establish the width (they must still agree among
/// themselves). An empty `rows` is a no-op (empty `changed_rows`, so the history
/// records nothing).
fn insert_rows(ds: &mut Dataset, at: usize, rows: Vec<RowData>) -> Result<EditOutcome, EditError> {
    let num_rows = ds.alignment.num_rows();
    if at > num_rows {
        return Err(EditError::RowOutOfBounds { row: at, num_rows });
    }
    if rows.is_empty() {
        return Ok(EditOutcome {
            inverse: EditCmd::DeleteRows { at, count: 0 },
            changed_rows: Vec::new(),
        });
    }
    // All new rows must share one width; if rows already exist, that width must be
    // the alignment width (else the single-width invariant breaks). Validated
    // before mutating, so a ragged set errors atomically (state untouched).
    let new_w = rows[0].gapped.len();
    for (i, r) in rows.iter().enumerate() {
        if r.gapped.len() != new_w {
            return Err(EditError::WidthMismatch {
                row: at + i,
                got: r.gapped.len(),
                expected: new_w,
            });
        }
    }
    if num_rows > 0 && new_w != ds.alignment.width {
        return Err(EditError::WidthMismatch {
            row: at,
            got: new_w,
            expected: ds.alignment.width,
        });
    }

    let count = rows.len();
    let mut seqs: Vec<Sequence> = Vec::with_capacity(count);
    let mut aligned: Vec<AlignedRow> = Vec::with_capacity(count);
    for r in rows {
        let residues: Vec<u8> = r.gapped.iter().copied().filter(|&b| !is_gap(b)).collect();
        let alphabet = Alphabet::infer(&residues);
        seqs.push(Sequence {
            id: r.id,
            name: r.name,
            description: r.description,
            alphabet,
            residues,
        });
        aligned.push(AlignedRow::new(r.id, r.gapped));
    }
    ds.sequences.splice(at..at, seqs);
    ds.alignment.rows.splice(at..at, aligned);
    // An empty alignment adopts the inserted rows' width; otherwise it already
    // matched (validated above), so this is a no-op write.
    ds.alignment.width = new_w;
    ds.alignment.invalidate_caches();

    Ok(EditOutcome {
        inverse: EditCmd::DeleteRows { at, count },
        changed_rows: (at..at + count).collect(),
    })
}

/// Remove `count` rows at index `at`, returning a [`EditCmd::InsertRows`] inverse
/// carrying the removed rows verbatim (ids/names/gapped) so a redo restores them
/// exactly. Atomic: the range is bounds-checked before any mutation. `count == 0`
/// is a no-op. Width is left unchanged — the surviving rows are all still the
/// alignment width (a row delete removes whole rows, never columns).
fn delete_rows(ds: &mut Dataset, at: usize, count: usize) -> Result<EditOutcome, EditError> {
    let num_rows = ds.alignment.num_rows();
    if at + count > num_rows {
        return Err(EditError::RowOutOfBounds {
            row: at + count,
            num_rows,
        });
    }
    if count == 0 {
        return Ok(EditOutcome {
            inverse: EditCmd::InsertRows {
                at,
                rows: Vec::new(),
            },
            changed_rows: Vec::new(),
        });
    }
    // Drain both vecs over the same range (they are index-aligned), then zip the
    // removed sequences + rows into the inverse's `RowData`.
    let removed_seqs: Vec<Sequence> = ds.sequences.drain(at..at + count).collect();
    let removed_rows: Vec<AlignedRow> = ds.alignment.rows.drain(at..at + count).collect();
    let captured: Vec<RowData> = removed_seqs
        .into_iter()
        .zip(removed_rows)
        .map(|(s, r)| RowData {
            id: s.id,
            name: s.name,
            description: s.description,
            gapped: r.gapped,
        })
        .collect();
    ds.alignment.invalidate_caches();

    Ok(EditOutcome {
        inverse: EditCmd::InsertRows { at, rows: captured },
        // Pre-delete positions: a non-empty marker so the history records the
        // edit. Structural commands skip the residue-resync loop (see
        // `apply_to_dataset`), so these indices are never used to index rows.
        changed_rows: (at..at + count).collect(),
    })
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

fn apply_splice_rows(
    aln: &mut Alignment,
    splices: Vec<RowSplice>,
) -> Result<EditOutcome, EditError> {
    let num_rows = aln.rows.len();

    // 1. Validate bounds for every splice BEFORE mutating (atomic apply).
    for s in &splices {
        let row = aln.rows.get(s.row).ok_or(EditError::RowOutOfBounds {
            row: s.row,
            num_rows,
        })?;
        let end = s.col + s.remove;
        if end > row.gapped.len() {
            return Err(EditError::ColOutOfBounds {
                row: s.row,
                end,
                width: row.gapped.len(),
            });
        }
    }

    // At most one splice per row. Length-changing splices to the same row would
    // shift each other's columns (the reverse-replay trick `SetCells` uses for
    // in-place overlaps does not survive a length change), so the primitive does
    // not support it — its callers build one splice per row. A violation is a
    // caller bug, not user input, so this is a debug assert, not a `Result` error.
    debug_assert!(
        {
            let mut rows: Vec<usize> = splices.iter().map(|s| s.row).collect();
            rows.sort_unstable();
            rows.windows(2).all(|w| w[0] != w[1])
        },
        "SpliceRows requires at most one splice per row"
    );

    // 2. Every row must end at one shared width (the single-width invariant). A
    // spliced row's resulting length is `current + inserted - removed`; a row with
    // no splice keeps its current length. Compute these WITHOUT mutating, so a
    // ragged splice set errors atomically (state untouched) — this guards real
    // corruption (a wrong `width` over differing-length rows) and so is a `Result`
    // error, not a debug assert. `current + bytes - remove` can't underflow: the
    // bounds check above guarantees `remove <= current`.
    let mut result_len: Vec<usize> = aln.rows.iter().map(|r| r.gapped.len()).collect();
    for s in &splices {
        let cur = aln.rows[s.row].gapped.len();
        result_len[s.row] = cur + s.bytes.len() - s.remove;
    }
    let target = result_len.first().copied().unwrap_or(aln.width);
    for (row, &len) in result_len.iter().enumerate() {
        if len != target {
            return Err(EditError::WidthMismatch {
                row,
                got: len,
                expected: target,
            });
        }
    }

    // 3. Mutate: splice each row, capturing the removed bytes for the inverse. Each
    // splice is on a distinct row (asserted above), so the inverse order is
    // irrelevant — no reverse needed (unlike the same-row overlaps `SetCells`
    // replays in reverse).
    let mut inverse: Vec<RowSplice> = Vec::with_capacity(splices.len());
    let mut changed: Vec<usize> = Vec::with_capacity(splices.len());
    for s in &splices {
        let row = &mut aln.rows[s.row];
        let end = s.col + s.remove;
        let old: Vec<u8> = row
            .gapped
            .splice(s.col..end, s.bytes.iter().copied())
            .collect();
        row.invalidate_index();
        inverse.push(RowSplice {
            row: s.row,
            col: s.col,
            remove: s.bytes.len(),
            bytes: old,
        });
        changed.push(s.row);
    }

    if !changed.is_empty() {
        aln.width = target;
        aln.invalidate_caches();
    }
    changed.sort_unstable();
    changed.dedup();

    Ok(EditOutcome {
        inverse: EditCmd::SpliceRows { splices: inverse },
        changed_rows: changed,
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

/// Apply a batch of commands as one atomic, reversible unit. Sub-commands run in
/// order through [`apply_to_dataset`] (so each does its own structural/matrix
/// dispatch + residue resync); the batch inverse is the collected sub-inverses in
/// REVERSE order. On any sub-command error, the already-applied sub-commands are
/// rolled back (their inverses replayed, newest first) before the error is
/// returned, so the dataset is left untouched. An empty batch is a no-op.
fn apply_batch(ds: &mut Dataset, commands: Vec<EditCmd>) -> Result<EditOutcome, EditError> {
    let mut inverses: Vec<EditCmd> = Vec::with_capacity(commands.len());
    let mut changed: Vec<usize> = Vec::new();
    for cmd in commands {
        match apply_to_dataset(ds, cmd) {
            Ok(out) => {
                changed.extend(out.changed_rows);
                inverses.push(out.inverse);
            }
            Err(e) => {
                // Roll back what we applied, newest first. These are engine-built
                // inverses of edits that just succeeded, so they must re-apply
                // cleanly — a failure here is an engine invariant violation.
                while let Some(inv) = inverses.pop() {
                    apply_to_dataset(ds, inv).expect("batch rollback inverse must apply");
                }
                return Err(e);
            }
        }
    }
    // The union of changed rows is only a non-empty marker here (whether the
    // history records the batch + the frontend repaints); each sub-command already
    // resynced its own rows, so these indexes are never re-used to index rows.
    inverses.reverse();
    changed.sort_unstable();
    changed.dedup();
    Ok(EditOutcome {
        inverse: EditCmd::Batch { commands: inverses },
        changed_rows: changed,
    })
}

/// Apply a command to a whole [`Dataset`]: mutate the gapped alignment, then
/// resync the derived ungapped residues for every changed row. Prefer this (or
/// [`EditStack`]) over the bare matrix-level [`apply`], which a caller could
/// pair with a forgotten resync.
pub fn apply_to_dataset(ds: &mut Dataset, cmd: EditCmd) -> Result<EditOutcome, EditError> {
    match cmd {
        // Structural commands change the row SET (and the sequences/names that
        // ride with it), so they own the whole `Dataset` and build their derived
        // state themselves — they must NOT go through the matrix `apply` + the
        // index-based residue resync (whose row indexes assume a stable row set).
        EditCmd::InsertRows { at, rows } => insert_rows(ds, at, rows),
        EditCmd::DeleteRows { at, count } => delete_rows(ds, at, count),
        // A batch composes sub-commands (each routed back through here).
        EditCmd::Batch { commands } => apply_batch(ds, commands),
        // Matrix commands mutate cells in existing rows: apply, then resync the
        // derived ungapped residues for the rows that changed.
        other => {
            let outcome = apply(&mut ds.alignment, other)?;
            for &r in &outcome.changed_rows {
                resync_residues(ds, r);
            }
            Ok(outcome)
        }
    }
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

    fn rsplice(row: usize, col: usize, remove: usize, bytes: &str) -> RowSplice {
        RowSplice {
            row,
            col,
            remove,
            bytes: bytes.as_bytes().to_vec(),
        }
    }

    fn splice(splices: Vec<RowSplice>) -> EditCmd {
        EditCmd::SpliceRows { splices }
    }

    fn row_data(id: SeqId, name: &str, gapped: &str) -> RowData {
        RowData {
            id,
            name: name.to_string(),
            description: String::new(),
            gapped: gapped.as_bytes().to_vec(),
        }
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
    fn splice_inserts_block_and_grows_width() {
        // The shift-only paste shape: insert "GGG" into the target row 0 at col 2,
        // and trailing-pad the other row with 3 gaps so both stay equal-width.
        let mut a = aln(&["ACGT", "TTTT"]);
        let out = apply(
            &mut a,
            splice(vec![rsplice(0, 2, 0, "GGG"), rsplice(1, 4, 0, "---")]),
        )
        .unwrap();
        assert_eq!(a.rows[0].gapped, b"ACGGGGT");
        assert_eq!(a.rows[1].gapped, b"TTTT---");
        assert_eq!(a.width, 7);
        // Inverse deletes the inserted run from each row, restoring width 4.
        apply(&mut a, out.inverse).unwrap();
        assert_eq!(a.rows[0].gapped, b"ACGT");
        assert_eq!(a.rows[1].gapped, b"TTTT");
        assert_eq!(a.width, 4);
    }

    #[test]
    fn splice_deletes_run_and_shrinks_width() {
        // The same primitive does deletion (the future cut-shorten): remove 2 cols
        // at col 1 from both rows (width 4 → 2), then the inverse restores them.
        // Also exercises the `current + bytes - remove` length math with remove > 0.
        let mut a = aln(&["ACGT", "TTTT"]);
        let out = apply(
            &mut a,
            splice(vec![rsplice(0, 1, 2, ""), rsplice(1, 1, 2, "")]),
        )
        .unwrap();
        assert_eq!(a.rows[0].gapped, b"AT");
        assert_eq!(a.rows[1].gapped, b"TT");
        assert_eq!(a.width, 2);
        apply(&mut a, out.inverse).unwrap();
        assert_eq!(a.rows[0].gapped, b"ACGT");
        assert_eq!(a.rows[1].gapped, b"TTTT");
        assert_eq!(a.width, 4);
    }

    #[test]
    fn splice_ragged_result_errors_atomically() {
        // Growing only row 0 would leave it wider than row 1 — rejected before any
        // mutation (the single-width invariant).
        let mut a = aln(&["ACGT", "TTTT"]);
        let err = apply(&mut a, splice(vec![rsplice(0, 0, 0, "XX")])).unwrap_err();
        assert_eq!(
            err,
            EditError::WidthMismatch {
                row: 1,
                got: 4,
                expected: 6
            }
        );
        assert_eq!(a.rows[0].gapped, b"ACGT");
        assert_eq!(a.rows[1].gapped, b"TTTT");
        assert_eq!(a.width, 4);
    }

    #[test]
    fn splice_out_of_bounds_col_errors_atomically() {
        let mut a = aln(&["ACGT"]);
        let err = apply(&mut a, splice(vec![rsplice(0, 3, 3, "")])).unwrap_err();
        assert_eq!(
            err,
            EditError::ColOutOfBounds {
                row: 0,
                end: 6,
                width: 4
            }
        );
        assert_eq!(a.rows[0].gapped, b"ACGT");
    }

    #[test]
    fn stack_width_changing_splice_undo_restores_width_and_residues() {
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let mut stack = EditStack::new();
        stack
            .apply(
                &mut ds,
                splice(vec![rsplice(0, 2, 0, "GGG"), rsplice(1, 4, 0, "---")]),
            )
            .unwrap();
        assert_eq!(ds.alignment.width, 7);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGGGGT");
        // Derived residues resync on the changed rows (row 1's trailing gaps drop).
        assert_eq!(ds.sequences[0].residues, b"ACGGGGT");
        assert_eq!(ds.sequences[1].residues, b"TTTT");
        stack.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.sequences[0].residues, b"ACGT");
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

    // ---- structural commands (InsertRows / DeleteRows) ---------------------

    #[test]
    fn insert_rows_adds_sequences_and_aligned_rows() {
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let out = apply_to_dataset(
            &mut ds,
            EditCmd::InsertRows {
                at: 1,
                rows: vec![row_data(7, "new", "GGGG")],
            },
        )
        .unwrap();
        // Inserted at index 1, shifting "b" down. Both vecs stay index-aligned.
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.alignment.rows[1].gapped, b"GGGG");
        assert_eq!(ds.sequences[1].name, "new");
        assert_eq!(ds.sequences[1].id, 7);
        assert_eq!(ds.sequences[1].residues, b"GGGG"); // derived, gaps dropped
        assert_eq!(ds.sequences[2].name, "b");
        assert_eq!(ds.alignment.width, 4);
        // Inverse removes exactly the inserted row.
        assert!(matches!(
            out.inverse,
            EditCmd::DeleteRows { at: 1, count: 1 }
        ));
        apply_to_dataset(&mut ds, out.inverse).unwrap();
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(ds.sequences[1].name, "b");
    }

    #[test]
    fn insert_rows_derives_residues_dropping_gaps() {
        let mut ds = dataset(&[("a", "ACGT")]);
        apply_to_dataset(
            &mut ds,
            EditCmd::InsertRows {
                at: 1,
                rows: vec![row_data(1, "g", "A--T")],
            },
        )
        .unwrap();
        assert_eq!(ds.alignment.rows[1].gapped, b"A--T");
        assert_eq!(ds.sequences[1].residues, b"AT");
    }

    #[test]
    fn insert_rows_width_mismatch_errors_atomically() {
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let err = apply_to_dataset(
            &mut ds,
            EditCmd::InsertRows {
                at: 0,
                rows: vec![row_data(9, "short", "GG")],
            },
        )
        .unwrap_err();
        assert_eq!(
            err,
            EditError::WidthMismatch {
                row: 0,
                got: 2,
                expected: 4
            }
        );
        // Untouched.
        assert_eq!(ds.alignment.num_rows(), 2);
    }

    #[test]
    fn insert_rows_at_out_of_bounds_errors() {
        let mut ds = dataset(&[("a", "ACGT")]);
        let err = apply_to_dataset(
            &mut ds,
            EditCmd::InsertRows {
                at: 5,
                rows: vec![row_data(1, "x", "ACGT")],
            },
        )
        .unwrap_err();
        assert_eq!(
            err,
            EditError::RowOutOfBounds {
                row: 5,
                num_rows: 1
            }
        );
    }

    #[test]
    fn insert_rows_into_empty_dataset_adopts_width() {
        let mut ds = Dataset::default();
        apply_to_dataset(
            &mut ds,
            EditCmd::InsertRows {
                at: 0,
                rows: vec![row_data(0, "a", "ACGT"), row_data(1, "b", "TTTT")],
            },
        )
        .unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.num_rows(), 2);
    }

    #[test]
    fn delete_rows_round_trips_through_inverse() {
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT"), ("c", "GGGG")]);
        let out = apply_to_dataset(&mut ds, EditCmd::DeleteRows { at: 0, count: 2 }).unwrap();
        assert_eq!(ds.alignment.num_rows(), 1);
        assert_eq!(ds.sequences[0].name, "c");
        // Inverse re-inserts the captured rows verbatim (ids/names/gapped restored).
        apply_to_dataset(&mut ds, out.inverse).unwrap();
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.sequences[0].name, "a");
        assert_eq!(ds.sequences[1].name, "b");
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.alignment.rows[1].gapped, b"TTTT");
    }

    #[test]
    fn stack_insert_rows_undo_redo_preserves_names_and_ids() {
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let mut stack = EditStack::new();
        let changed = stack
            .apply(
                &mut ds,
                EditCmd::InsertRows {
                    at: 2,
                    rows: vec![row_data(42, "appended", "CCCC")],
                },
            )
            .unwrap();
        assert!(!changed.is_empty()); // recorded
        assert_eq!(ds.alignment.num_rows(), 3);

        stack.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 2);

        stack.redo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.sequences[2].name, "appended");
        assert_eq!(ds.sequences[2].id, 42); // exact id restored on redo
        assert_eq!(ds.alignment.rows[2].gapped, b"CCCC");
    }

    #[test]
    fn empty_insert_rows_is_a_noop_not_recorded() {
        let mut ds = dataset(&[("a", "ACGT")]);
        let mut stack = EditStack::new();
        let changed = stack
            .apply(
                &mut ds,
                EditCmd::InsertRows {
                    at: 1,
                    rows: vec![],
                },
            )
            .unwrap();
        assert!(changed.is_empty());
        assert!(!stack.can_undo());
        assert_eq!(ds.alignment.num_rows(), 1);
    }

    // ---- compound command (Batch) -----------------------------------------

    #[test]
    fn batch_applies_subcommands_in_order_and_one_undo_reverses_all() {
        // A matrix edit (SetCells) then a width-growing SpliceRows, as one unit.
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let mut stack = EditStack::new();
        let changed = stack
            .apply(
                &mut ds,
                EditCmd::Batch {
                    commands: vec![
                        set(vec![write(0, 0, "X")]),
                        splice(vec![rsplice(0, 4, 0, "GG"), rsplice(1, 4, 0, "GG")]),
                    ],
                },
            )
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.rows[0].gapped, b"XCGTGG");
        assert_eq!(ds.alignment.rows[1].gapped, b"TTTTGG");
        assert_eq!(ds.alignment.width, 6);
        // ONE undo reverses the WHOLE batch (sub-inverses replay in reverse).
        stack.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.alignment.rows[1].gapped, b"TTTT");
        assert_eq!(ds.alignment.width, 4);
    }

    #[test]
    fn batch_rolls_back_applied_subcommands_on_error() {
        // First sub-command is valid (would mask row 0); the second writes out of
        // bounds. The batch must leave the dataset untouched (atomic).
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let err = apply_to_dataset(
            &mut ds,
            EditCmd::Batch {
                commands: vec![set(vec![write(0, 0, "--")]), set(vec![write(9, 0, "X")])],
            },
        )
        .unwrap_err();
        assert_eq!(
            err,
            EditError::RowOutOfBounds {
                row: 9,
                num_rows: 2
            }
        );
        // The valid first sub-command was rolled back.
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.alignment.rows[1].gapped, b"TTTT");
    }

    #[test]
    fn batch_grow_then_insert_rows_round_trips() {
        // The paste-as-sequences GROW shape: pad both existing rows from width 4 to
        // 6, then insert a new width-6 row — one atomic, reversible unit. Exercises a
        // batch mixing a matrix command (SpliceRows) and a structural one (InsertRows).
        let mut ds = dataset(&[("a", "ACGT"), ("b", "TTTT")]);
        let mut stack = EditStack::new();
        stack
            .apply(
                &mut ds,
                EditCmd::Batch {
                    commands: vec![
                        splice(vec![rsplice(0, 4, 0, "--"), rsplice(1, 4, 0, "--")]),
                        EditCmd::InsertRows {
                            at: 2,
                            rows: vec![row_data(7, "new", "GGGGGG")],
                        },
                    ],
                },
            )
            .unwrap();
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT--");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGGGG");
        assert_eq!(ds.sequences[2].name, "new");
        assert_eq!(ds.sequences[2].residues, b"GGGGGG"); // derived, gaps dropped

        // Undo removes the row AND trims the existing rows back to width 4.
        stack.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.sequences[0].residues, b"ACGT");
        // Redo restores the grown, inserted state.
        stack.redo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGGGG");
    }
}
