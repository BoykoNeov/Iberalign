//! `align-core` — the pure, UI-free engine behind Iberalign.
//!
//! Responsibilities: sequence/alignment data model, the three coordinate
//! spaces and their mapping, a tolerant FASTA parser, pairwise alignment,
//! per-column analyses, and format I/O. No rendering, no Tauri, no I/O side
//! effects beyond reading/writing byte buffers — that keeps it trivially
//! testable and reusable from both the desktop app and `align-cli`.
//!
//! Build status by milestone (see `iberprime-spec.md` §12):
//! - M1 — `model`, `parse`, `coords`, `composition`: implemented.
//! - M3 — `align`: stubbed (`todo!()`).
//! - M4 — `analyze` (consensus/conservation/identity): stubbed.
//! - M5 — `edit`: `SetCells` + `EditStack` undo/redo implemented (Batch B);
//!   block/gap/row commands and the write half of `io` still stubbed.

pub mod align;
pub mod analyze;
pub mod composition;
pub mod coords;
pub mod edit;
pub mod io;
pub mod model;
pub mod parse;

pub use composition::Composition;
pub use edit::{
    apply_to_dataset, CellWrite, EditCmd, EditError, EditOutcome, EditStack, RowData, RowSplice,
};
pub use model::{AlignedRow, Alignment, Alphabet, Dataset, RawRecord, SeqId, Sequence};
pub use parse::{
    parse_fasta, parse_fasta_with, summarize, ParseError, ParseOptions, ParseOutcome, Summary,
};
