//! Authoritative application state, owned by Rust and held in Tauri managed
//! state behind a `Mutex`. The frontend keeps only a render-buffer copy; this
//! is the single source of truth (see spec §3).

use align_core::{Dataset, EditStack};

/// Everything the backend owns for the current session. Starts empty; a load
/// swaps in a fresh `dataset` and resets the `history`.
#[derive(Default)]
pub struct AppState {
    /// The most recently loaded dataset (the gapped `Alignment` plus its
    /// derived ungapped `Sequence`s), or `None` before anything is loaded.
    pub dataset: Option<Dataset>,
    /// The reversible edit history for the current dataset (undo/redo). Reset on
    /// each load — old row indexes don't refer to the new alignment.
    pub history: EditStack,
}
