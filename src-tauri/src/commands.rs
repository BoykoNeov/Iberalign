//! Tauri command surface — thin, coarse-grained wrappers over `align-core`.
//! Commands are `async` so heavy work runs off the UI thread; payloads are
//! serializable DTOs so the engine types stay UI-agnostic.

use crate::state::AppState;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

/// Serializable mirror of `align_core::Summary` for the IPC boundary. Keeping
/// the DTO here lets `align-core` stay free of serde.
#[derive(Serialize)]
pub struct SummaryDto {
    pub count: usize,
    pub alphabet: String,
    pub min_len: usize,
    pub max_len: usize,
    pub equal_length: bool,
}

/// Parse FASTA bytes and return a load summary. Also stashes the parsed
/// sequences in managed state so later commands can build an `Alignment`.
///
/// `bytes` arrives as a `Vec<u8>` over IPC (the frontend reads the file).
#[tauri::command]
pub async fn parse_summary(
    bytes: Vec<u8>,
    state: State<'_, Mutex<AppState>>,
) -> Result<SummaryDto, String> {
    let seqs = align_core::parse_fasta(&bytes).map_err(|e| e.to_string())?;
    let summary = align_core::summarize(&seqs);

    let dto = SummaryDto {
        count: summary.count,
        alphabet: summary.alphabet.label().to_string(),
        min_len: summary.min_len,
        max_len: summary.max_len,
        equal_length: summary.equal_length,
    };

    // Lock is held only to swap in the new sequences; no await while held.
    state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?
        .sequences = seqs;

    Ok(dto)
}
