//! Tauri command surface — thin, coarse-grained wrappers over `align-core`.
//! Commands are `async` so heavy work runs off the UI thread; payloads are
//! serializable DTOs so the engine types stay UI-agnostic.

use crate::state::AppState;
use align_core::{Alphabet, Dataset};
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
fn parse_to_dto(bytes: &[u8]) -> Result<(SummaryDto, Dataset), String> {
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
fn store(state: &State<'_, Mutex<AppState>>, dataset: Dataset) -> Result<(), String> {
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

/// Render metadata for the frontend grid: dimensions, row names (for the pinned
/// name column, in alignment-row order), and the dataset-wide alphabet (which
/// drives the color scheme). The large gapped matrix rides a separate binary
/// command ([`get_render_buffer`]); this stays small, ergonomic JSON.
#[derive(Serialize)]
pub struct AlignmentMetaDto {
    pub width: usize,
    pub num_rows: usize,
    pub names: Vec<String>,
    pub alphabet: String,
}

/// Flatten the gapped alignment into a row-major `width × num_rows` byte matrix:
/// row `r` occupies bytes `[r*width, (r+1)*width)`. Every row is already padded
/// to `width` (trailing gaps), so this is a straight concatenation. This is the
/// exact buffer the frontend renders from — fetched once per load, never per
/// frame (spec §3, §6).
fn flatten_buffer(ds: &Dataset) -> Vec<u8> {
    let width = ds.alignment.width;
    let mut buf = Vec::with_capacity(width * ds.alignment.num_rows());
    for row in &ds.alignment.rows {
        debug_assert_eq!(row.gapped.len(), width, "every row is padded to width");
        buf.extend_from_slice(&row.gapped);
    }
    buf
}

/// The dataset-wide alphabet: the widening fold over each sequence's inferred
/// alphabet. This matches what `summarize` reports for the same data (it folds
/// `widen(infer(..))` the same way), so the grid's color scheme agrees with the
/// load summary.
fn dataset_alphabet(ds: &Dataset) -> Alphabet {
    ds.sequences
        .iter()
        .map(|s| s.alphabet)
        .fold(Alphabet::Dna, Alphabet::widen)
}

/// Return render metadata (dimensions, row names, alphabet) for the currently
/// loaded dataset. Small structured JSON; pairs with [`get_render_buffer`].
/// Errors if nothing is loaded.
#[tauri::command]
pub async fn get_alignment_meta(
    state: State<'_, Mutex<AppState>>,
) -> Result<AlignmentMetaDto, String> {
    let guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let ds = guard
        .dataset
        .as_ref()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    // Sequences are index-aligned with `alignment.rows` (see `from_records`), so
    // names are in row order — the pinned name column can't drift off the buffer.
    let names: Vec<String> = ds.sequences.iter().map(|s| s.name.clone()).collect();
    debug_assert_eq!(names.len(), ds.alignment.num_rows());
    Ok(AlignmentMetaDto {
        width: ds.alignment.width,
        num_rows: ds.alignment.num_rows(),
        names,
        alphabet: dataset_alphabet(ds).label().to_string(),
    })
}

/// Return the flat gapped render buffer as **raw bytes** — a `width × num_rows`
/// row-major matrix the frontend wraps in a `Uint8Array` and renders from.
///
/// Transport is `tauri::ipc::Response`, which arrives in JS as an `ArrayBuffer`.
/// This deliberately does **not** return `Vec<u8>`: that serializes as a JSON
/// `number[]` (tens of MB for a large matrix) and is disqualifying (see the
/// `parse_summary` note). Fetched once per load. Errors if nothing is loaded.
#[tauri::command]
pub async fn get_render_buffer(
    state: State<'_, Mutex<AppState>>,
) -> Result<tauri::ipc::Response, String> {
    let guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let ds = guard
        .dataset
        .as_ref()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    Ok(tauri::ipc::Response::new(flatten_buffer(ds)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use align_core::RawRecord;

    fn rec(name: &str, gapped: &str) -> RawRecord {
        RawRecord {
            name: name.to_string(),
            description: String::new(),
            gapped: gapped.as_bytes().to_vec(),
        }
    }

    #[test]
    fn flatten_is_row_major_and_pads_trailing_gaps() {
        // Non-square, asymmetric: width 4, num_rows 2; row 1 ("AC") pads to
        // "AC--". A column-major transpose would yield "AACGT-T-" or similar —
        // visibly different — so this fixture catches a row/col-major mistake
        // and proves trailing-pad gaps land in the buffer.
        let ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "AC")]);
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(flatten_buffer(&ds), b"ACGTAC--");
    }

    #[test]
    fn dataset_alphabet_matches_summary() {
        let recs = [rec("a", "ACGT"), rec("b", "AC--"), rec("c", "MKLPQR")];
        let ds = Dataset::from_records(&recs);
        let summary = align_core::summarize(&recs);
        assert_eq!(dataset_alphabet(&ds).label(), summary.alphabet.label());
    }

    #[test]
    fn empty_dataset_alphabet_defaults_to_dna() {
        let ds = Dataset::from_records(&[]);
        assert_eq!(dataset_alphabet(&ds).label(), "DNA");
    }
}
