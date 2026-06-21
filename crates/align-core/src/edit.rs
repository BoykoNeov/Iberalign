//! Editing as reversible commands (M5). Every mutation to the authoritative
//! `Alignment` goes through this command stack so undo/redo is lossless and
//! features remap automatically via the coordinate API.
//!
//! Status: command types fixed, `apply`/`invert` stubbed until M5.

use crate::model::{Alignment, SeqId};
use std::ops::Range;

/// Which rows an edit applies to.
#[derive(Clone, Debug)]
pub enum RowSel {
    One(usize),
    Many(Vec<usize>),
    All,
}

/// A reversible edit. Applying a command returns its inverse for the undo
/// stack and reports which rows changed so the frontend can patch its buffer.
#[derive(Clone, Debug)]
pub enum EditCmd {
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

/// Outcome of applying an edit: the inverse command and the changed rows.
#[derive(Clone, Debug)]
pub struct EditOutcome {
    pub inverse: EditCmd,
    pub changed_rows: Vec<usize>,
}

/// Apply a command to the alignment, returning the inverse + changed rows.
/// Implemented in M5.
pub fn apply(_aln: &mut Alignment, _cmd: EditCmd) -> EditOutcome {
    todo!("M5: apply edit, invalidate caches/indexes, return inverse")
}
