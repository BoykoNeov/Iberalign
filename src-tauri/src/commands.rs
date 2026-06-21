//! Tauri command surface — thin, coarse-grained wrappers over `align-core`.
//! Commands are `async` so heavy work runs off the UI thread; payloads are
//! serializable DTOs so the engine types stay UI-agnostic.

use crate::state::AppState;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

/// Serializable mirror of `align_core::Summary` (plus parse warnings) for the
/// IPC boundary. Keeping the DTO here lets `align-core` stay free of serde.
#[derive(Serialize)]
pub struct SummaryDto {
    pub count: usize,
    pub alphabet: String,
    pub min_len: usize,
    pub max_len: usize,
    pub width: usize,
    /// True if every sequence already shares one gapped width (a rectangular
    /// matrix). Necessary but not sufficient for a real alignment — gap-padded
    /// sequences pass too. Surfaced as "Equal width", not "Aligned".
    pub equal_width: bool,
    pub warnings: Vec<String>,
}

/// Parse bytes into a `(summary DTO, Dataset)` pair. Engine-only; no state.
fn parse_to_dto(bytes: &[u8]) -> Result<(SummaryDto, align_core::Dataset), String> {
    let out = align_core::parse_fasta(bytes).map_err(|e| e.to_string())?;
    let summary = align_core::summarize(&out.records);
    let dataset = align_core::Dataset::from_records(&out.records);

    let dto = SummaryDto {
        count: summary.count,
        alphabet: summary.alphabet.label().to_string(),
        min_len: summary.min_len,
        max_len: summary.max_len,
        width: summary.width,
        equal_width: summary.equal_width,
        warnings: out.warnings,
    };
    Ok((dto, dataset))
}

/// Stash a freshly built dataset as the current session state.
fn store(state: &State<'_, Mutex<AppState>>, dataset: align_core::Dataset) -> Result<(), String> {
    // Lock is held only to swap in the new dataset; no await while held.
    state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?
        .dataset = Some(dataset);
    Ok(())
}

/// Parse FASTA bytes and return a load summary, stashing the built `Dataset`.
///
/// `bytes` arrives as a `Vec<u8>` over IPC (the in-app textarea path). The
/// native file-open path is [`load_alignment`], where Rust reads the file.
#[tauri::command]
pub async fn parse_summary(
    bytes: Vec<u8>,
    state: State<'_, Mutex<AppState>>,
) -> Result<SummaryDto, String> {
    let (dto, dataset) = parse_to_dto(&bytes)?;
    store(&state, dataset)?;
    Ok(dto)
}

/// Load a FASTA file by path and return a load summary, stashing the `Dataset`.
///
/// Rust reads the file itself (no file bytes cross IPC) — the frontend obtains
/// `path` from the native dialog plugin. This is the path-based load seam;
/// chunked streaming for very large files plugs in here later.
#[tauri::command]
pub async fn load_alignment(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<SummaryDto, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("could not read '{path}': {e}"))?;
    let (dto, dataset) = parse_to_dto(&bytes)?;
    store(&state, dataset)?;
    Ok(dto)
}
