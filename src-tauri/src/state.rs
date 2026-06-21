//! Authoritative application state, owned by Rust and held in Tauri managed
//! state behind a `Mutex`. The frontend keeps only a render-buffer copy; this
//! is the single source of truth (see spec §3).

use align_core::Dataset;

/// Everything the backend owns for the current session. Starts empty; the
/// undo/redo command stack lands here in M5.
#[derive(Default)]
pub struct AppState {
    /// The most recently loaded dataset (the gapped `Alignment` plus its
    /// derived ungapped `Sequence`s), or `None` before anything is loaded.
    pub dataset: Option<Dataset>,
}
