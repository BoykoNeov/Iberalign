//! Authoritative application state, owned by Rust and held in Tauri managed
//! state behind a `Mutex`. The frontend keeps only a render-buffer copy; this
//! is the single source of truth (see spec §3).

use align_core::Sequence;

/// Everything the backend owns for the current session. Starts empty; an
/// `Alignment` and the undo/redo command stack land here in later milestones.
#[derive(Default)]
pub struct AppState {
    /// The most recently loaded sequences (pre-alignment). Placeholder until
    /// the `Alignment` + edit stack arrive in M1/M5.
    pub sequences: Vec<Sequence>,
}
