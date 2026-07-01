//! Tauri command surface — thin, coarse-grained wrappers over `align-core`.
//! Commands are `async` so heavy work runs off the UI thread; payloads are
//! serializable DTOs so the engine types stay UI-agnostic.

use crate::state::AppState;
use align_core::{
    pairwise, progressive_align, AlignMode, Alphabet, CellWrite, Dataset, EditCmd, MsaEngine,
    RawRecord, RowData, RowSplice, Scoring, SeqId, SubstitutionMatrix,
};
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

/// Stash a freshly built dataset as the current session state, resetting the
/// edit history (its row indexes referred to the previous alignment).
fn store(state: &State<'_, Mutex<AppState>>, dataset: Dataset) -> Result<(), String> {
    // Lock is held only to swap in the new dataset; no await while held.
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    guard.dataset = Some(dataset);
    guard.history.clear();
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

// ---- editing ---------------------------------------------------------------
//
// Mutations go through `align_core::EditStack` (reversible; Rust owns the truth),
// and each command returns the POST-EDIT render buffer as raw bytes — the same
// transport as `get_render_buffer`. The current edits preserve the alignment
// width, so the frontend copies the bytes into its existing render buffer in
// place (no realloc, no new view ⇒ scroll + selection are preserved). An empty
// response means the edit was a no-op (e.g. undo at the bottom of the stack), and
// the frontend skips the repaint. Width-changing commands (paste insert) return
// the full new buffer over the same transport, but the frontend derives the new
// width from its length and resizes the view. (Cut-shorten is width-PRESERVING —
// it trailing-pads each cut row back to width — so it rides the in-place path.)

/// Per-row gap-fill writes covering the rectangle rows `r0..=r1`, cols `c0..=c1`.
/// The engine command behind delete/clear-to-gap (mask).
fn gap_fill_writes(r0: usize, r1: usize, c0: usize, c1: usize) -> Vec<CellWrite> {
    let count = c1.saturating_sub(c0) + 1;
    (r0..=r1)
        .map(|row| CellWrite {
            row,
            col: c0,
            bytes: vec![b'-'; count],
        })
        .collect()
}

/// Per-row writes for a CUT-SHORTEN over the rectangle rows `r0..=r1`, cols
/// `c0..=c1`: each target row deletes the `W = c1-c0+1` selected columns and
/// shifts its remaining tail left, trailing-padding `W` gaps so the row keeps the
/// alignment width (the alignment's overall width is preserved — only the cut
/// rows' content shifts; untouched rows are left byte-for-byte alone). Because the
/// net length change is zero, this is a plain width-preserving [`EditCmd::SetCells`]
/// overwrite of each row's tail `[c0..width]` — the captured old bytes give the
/// re-insert inverse for free (no `SpliceRows`/width recompute needed).
///
/// Unlike [`gap_fill_writes`], this reads each row's bytes, so a stale/out-of-range
/// row index would *panic* rather than error cleanly: `r1` is clamped to the last
/// row and an `r0` past the end yields no writes (a graceful no-op). The column
/// range is safe by the selection-clamp invariant (`c1 < width`), asserted in debug.
fn cut_shorten_writes(ds: &Dataset, r0: usize, r1: usize, c0: usize, c1: usize) -> Vec<CellWrite> {
    let num_rows = ds.alignment.num_rows();
    if num_rows == 0 || r0 >= num_rows {
        return Vec::new();
    }
    let width = ds.alignment.width;
    debug_assert!(
        c1 < width,
        "cut column c1 must be within the alignment width"
    );
    let w = c1.saturating_sub(c0) + 1;
    let r1 = r1.min(num_rows - 1);
    (r0..=r1)
        .map(|row| {
            let old = &ds.alignment.rows[row].gapped;
            // The new tail covering [c0..width]: the cells after the cut shifted to
            // the front, the freed W cells at the end filled with gaps.
            let mut tail = vec![b'-'; width - c0];
            let keep = &old[(c0 + w).min(width)..width];
            tail[..keep.len()].copy_from_slice(keep);
            CellWrite {
                row,
                col: c0,
                bytes: tail,
            }
        })
        .collect()
}

/// The edit command for a paste-OVERWRITE with the block's top-left at `(r0, c0)`:
/// each residue line overwrites the cells starting at column `c0` of its row.
/// Lines past the last row are dropped (an overwrite never adds rows). The block
/// **never truncates horizontally** — if it runs past the right edge the alignment
/// GROWS to fit (existing cells past the overwrite are kept, other rows trailing-
/// padded); a block that fits leaves the width unchanged. An empty line overwrites
/// nothing (its row holds its position).
///
/// Two shapes by whether it overflows the right edge:
///   - fits (`needed <= width`) ⇒ in-place [`EditCmd::SetCells`] on the target rows
///     only (width-preserving — rides the fast in-place transport);
///   - overflows ⇒ [`EditCmd::SpliceRows`] over EVERY row, replacing each row's tail
///     `[c0..width]` with a `needed - c0`-long tail (target rows overwrite their
///     front; all rows pad to the grown width), so all rows stay equal-width.
fn paste_overwrite_cmd(ds: &Dataset, r0: usize, c0: usize, rows: &[String]) -> EditCmd {
    let num_rows = ds.alignment.num_rows();
    let old_width = ds.alignment.width;
    // Widest reach of any KEPT line; at least the current width (so it can only grow).
    let needed = rows
        .iter()
        .enumerate()
        .filter(|(i, _)| r0 + i < num_rows)
        .map(|(_, line)| c0 + line.len())
        .max()
        .map(|m| m.max(old_width))
        .unwrap_or(old_width);

    if needed <= old_width {
        // Fits: overwrite the target rows in place (no truncation — every kept line
        // ends at or before the right edge). Blank lines write nothing.
        let writes = rows
            .iter()
            .enumerate()
            .filter_map(|(i, line)| {
                let row = r0 + i;
                if row >= num_rows || line.is_empty() {
                    return None;
                }
                Some(CellWrite {
                    row,
                    col: c0,
                    bytes: line.as_bytes().to_vec(),
                })
            })
            .collect();
        return EditCmd::SetCells { writes };
    }

    // Overflow: grow to `needed`. Each row replaces its tail `[c0..old_width]` with a
    // fresh `tail_len`-long tail: keep the old cells from `c0`, overwrite the front
    // with this row's line (if any), and pad the grown remainder with gaps.
    let tail_len = needed - c0;
    let splices = (0..num_rows)
        .map(|row| {
            let old = &ds.alignment.rows[row].gapped;
            let line: &[u8] = if row >= r0 && row - r0 < rows.len() {
                rows[row - r0].as_bytes()
            } else {
                &[]
            };
            let mut tail = vec![b'-'; tail_len];
            // Keep the old cells from c0 onward, then overwrite the front with this
            // row's line; the grown remainder stays gaps.
            tail[..old_width - c0].copy_from_slice(&old[c0..old_width]);
            tail[..line.len()].copy_from_slice(line);
            RowSplice {
                row,
                col: c0,
                remove: old_width - c0,
                bytes: tail,
            }
        })
        .collect();
    EditCmd::SpliceRows { splices }
}

/// Splices for a paste-INSERT with the block's top-left at `(r0, c0)`. Each target
/// row (`r0..r0+rows.len()`, clamped to the last row) gets its line gap-padded to
/// the block width `W` (the widest KEPT line) and inserted at `c0`; every other row
/// keeps equal width by inserting `W` gaps — at `c0` when `shift_all` (gaps go in
/// everywhere, so the columns stay synchronized), or trailing otherwise (the
/// default: only the pasted rows shift, de-aligning their right side). Returns no
/// splices when `W == 0` (every kept line empty) ⇒ a no-op. Lines past the last row
/// are dropped — an insert can't add rows. Unlike overwrite, this GROWS the width.
fn paste_insert_splices(
    ds: &Dataset,
    r0: usize,
    c0: usize,
    rows: &[String],
    shift_all: bool,
) -> Vec<RowSplice> {
    let num_rows = ds.alignment.num_rows();
    let old_width = ds.alignment.width;
    let w = rows
        .iter()
        .enumerate()
        .filter(|(i, _)| r0 + i < num_rows)
        .map(|(_, line)| line.len())
        .max()
        .unwrap_or(0);
    if w == 0 {
        return Vec::new();
    }
    (0..num_rows)
        .map(|row| {
            if row >= r0 && row - r0 < rows.len() {
                // Target row: its line, right-padded with gaps to the block width.
                let line = rows[row - r0].as_bytes();
                let mut seg = vec![b'-'; w];
                seg[..line.len()].copy_from_slice(line);
                RowSplice {
                    row,
                    col: c0,
                    remove: 0,
                    bytes: seg,
                }
            } else {
                // Non-target row: W gaps, at c0 (shift-all) or trailing (shift-only).
                RowSplice {
                    row,
                    col: if shift_all { c0 } else { old_width },
                    remove: 0,
                    bytes: vec![b'-'; w],
                }
            }
        })
        .collect()
}

/// The post-edit render bytes: the full flattened buffer, or empty when nothing
/// changed (the frontend then skips the in-place copy + repaint).
fn edit_bytes(ds: &Dataset, changed: &[usize]) -> Vec<u8> {
    if changed.is_empty() {
        Vec::new()
    } else {
        flatten_buffer(ds)
    }
}

/// Clear (mask to gaps) the selected rectangle and return the post-edit render
/// buffer. The first concrete reversible edit and the foundation paste/cut build
/// on. The rect is in alignment coordinates (the frontend normalizes the
/// selection first). Errors if nothing is loaded or the rect is out of bounds
/// (the edit is atomic — state is untouched on error).
#[tauri::command]
pub async fn clear_cells(
    r0: usize,
    c0: usize,
    r1: usize,
    c1: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<tauri::ipc::Response, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    // Split-borrow the two fields so the history can mutate the dataset.
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let writes = gap_fill_writes(r0, r1, c0, c1);
    let changed = history
        .apply(ds, EditCmd::SetCells { writes })
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(edit_bytes(ds, &changed)))
}

/// Cut the selected rectangle in SHORTEN mode: delete the selected columns in the
/// selected rows and shift each row's remaining tail left, trailing-padding gaps so
/// the alignment keeps its width (see [`cut_shorten_writes`]). This command is only
/// the REMOVAL — the frontend writes the block to the system clipboard first (cut =
/// copy + remove). Width-preserving, so it returns the post-edit render buffer the
/// frontend copies into its view in place (empty ⇒ no-op). Reversible through the
/// edit history (the inverse re-inserts the cut columns). The rect is in alignment
/// coordinates (the frontend normalizes the selection first). Errors if nothing is
/// loaded; the edit is atomic — state is untouched on error.
#[tauri::command]
pub async fn cut_shorten(
    r0: usize,
    c0: usize,
    r1: usize,
    c1: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<tauri::ipc::Response, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let writes = cut_shorten_writes(ds, r0, r1, c0, c1);
    let changed = history
        .apply(ds, EditCmd::SetCells { writes })
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(edit_bytes(ds, &changed)))
}

/// Paste a block of residue lines over the alignment with its top-left at
/// `(r0, c0)`, in OVERWRITE mode (see [`paste_overwrite_cmd`]): cells are
/// overwritten in place, rows past the end are dropped, and the alignment GROWS to
/// fit a block that runs past the right edge (never truncates). Returns the
/// post-edit render buffer (empty ⇒ no-op) — possibly WIDER, so the frontend
/// derives the new width from the buffer length, same as paste-insert. Reversible
/// through the edit history like every mutation. The frontend reads + parses the
/// system clipboard into `rows`. Errors if nothing is loaded (atomic on error).
#[tauri::command]
pub async fn paste_overwrite(
    r0: usize,
    c0: usize,
    rows: Vec<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<tauri::ipc::Response, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let cmd = paste_overwrite_cmd(ds, r0, c0, &rows);
    let changed = history.apply(ds, cmd).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(edit_bytes(ds, &changed)))
}

/// Paste a block of residue lines over the alignment with its top-left at
/// `(r0, c0)`, in INSERT mode — the block is INSERTED at `c0` (the alignment GROWS
/// in width), reversibly through the edit history. `shift_all` chooses how the
/// other rows keep equal width: `false` (the default) trailing-pads them so only
/// the pasted rows shift (de-aligning their right side); `true` inserts gaps at
/// `c0` in every row so the columns stay synchronized. Returns the post-edit
/// render buffer — now WIDER, so the frontend rebuilds its view from the new length
/// (it derives the new width = bytes.len()/num_rows). The frontend reads + parses
/// the system clipboard into `rows`. Errors if nothing is loaded.
#[tauri::command]
pub async fn paste_insert(
    r0: usize,
    c0: usize,
    rows: Vec<String>,
    shift_all: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<tauri::ipc::Response, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let splices = paste_insert_splices(ds, r0, c0, &rows, shift_all);
    let changed = history
        .apply(ds, EditCmd::SpliceRows { splices })
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(edit_bytes(ds, &changed)))
}

/// Outcome of [`paste_sequences`]: how many rows were inserted and how many of
/// them had to be truncated. With grow-to-fit (see [`paste_sequences_cmd`]) the
/// alignment widens to the widest record, so `truncated` is 0 in the common case
/// — it is only nonzero in the blow-up-guard fallback ([`PASTE_GROW_CELL_CAP`]).
/// Small JSON; the frontend re-fetches the meta + render buffer to rebuild its
/// view (a row-count change reuses the load path).
#[derive(Serialize)]
pub struct PasteSeqDto {
    pub inserted: usize,
    pub truncated: usize,
}

/// The next free [`SeqId`]: one past the current maximum (or 0 for an empty set).
/// Fresh ids never collide with existing rows even after deletes.
fn next_seq_id(ds: &Dataset) -> SeqId {
    ds.sequences
        .iter()
        .map(|s| s.id)
        .max()
        .map(|m| m + 1)
        .unwrap_or(0)
}

/// Largest resulting render buffer (in cells) a GROW-to-fit paste will build. A
/// pasted sequence far wider than the alignment forces EVERY existing row to pad
/// out to that width — `(num_rows + inserted) * new_width` cells — which can dwarf
/// the pasted text itself (a single 1 M-wide sequence into a 10 k-row alignment is
/// ~10 G cells). Above this cap we DON'T grow: each record clamps to the current
/// width instead (the only case `truncated` is nonzero). Set at the 10k×10k stress
/// ceiling — the documented size the renderer already handles.
const PASTE_GROW_CELL_CAP: usize = 100_000_000;

/// The width a paste-as-sequences should target. GROW to the widest record when
/// that stays within `cap` cells; otherwise keep the current width (the records
/// clamp/truncate to it — the blow-up guard). An empty alignment (`num_rows == 0`)
/// always adopts the widest: it has no existing rows to multiply, so the result is
/// bounded by the pasted data itself. Records that already fit keep the old width.
fn grow_target_width(
    num_rows: usize,
    old_width: usize,
    widest: usize,
    num_records: usize,
    cap: usize,
) -> usize {
    if widest <= old_width {
        return old_width; // records already fit
    }
    if num_rows == 0 {
        return widest; // no existing rows to pad — bounded by the clipboard
    }
    if (num_rows + num_records).saturating_mul(widest) <= cap {
        widest // grow to fit
    } else {
        old_width // growing would blow up the buffer → clamp instead
    }
}

/// Build the edit inserting `records` as new sequences at row `at`, plus the count
/// of records truncated. GROW-to-fit: the alignment widens to the widest record
/// (every existing row trailing-pads), so nothing truncates — UNLESS the grown
/// buffer would exceed [`PASTE_GROW_CELL_CAP`], where it falls back to clamping each
/// record to the current width (the only `truncated > 0` case). Fresh, non-colliding
/// ids are assigned in record order. When the alignment grows, the result is a
/// [`EditCmd::Batch`] — pad every existing row, then insert — applied as one undo;
/// otherwise a plain [`EditCmd::InsertRows`]. An empty `records` yields an empty
/// `InsertRows` (a no-op the history won't record).
fn paste_sequences_cmd(ds: &Dataset, at: usize, records: &[RawRecord]) -> (EditCmd, usize) {
    if records.is_empty() {
        return (
            EditCmd::InsertRows {
                at,
                rows: Vec::new(),
            },
            0,
        );
    }
    let num_rows = ds.alignment.num_rows();
    let old_width = ds.alignment.width;
    let widest = records.iter().map(|r| r.gapped.len()).max().unwrap_or(0);
    let target = grow_target_width(
        num_rows,
        old_width,
        widest,
        records.len(),
        PASTE_GROW_CELL_CAP,
    );

    // Each record padded (short) or truncated (only when target < widest, i.e. the
    // capped fallback) to exactly `target`. Fresh ids continue past the current max.
    let mut next = next_seq_id(ds);
    let mut truncated = 0usize;
    let rows: Vec<RowData> = records
        .iter()
        .map(|rec| {
            if rec.gapped.len() > target {
                truncated += 1;
            }
            let mut gapped = rec.gapped.clone();
            gapped.resize(target, b'-');
            let id = next;
            next += 1;
            RowData {
                id,
                name: rec.name.clone(),
                description: rec.description.clone(),
                gapped,
            }
        })
        .collect();

    let insert = EditCmd::InsertRows { at, rows };
    // Grow path: also pad every existing row out to the new width, as one atomic
    // batch (pad existing → insert wider rows). Skipped when there are no existing
    // rows (an empty alignment just adopts the width via InsertRows).
    if num_rows > 0 && target > old_width {
        let pad = target - old_width;
        let splices = (0..num_rows)
            .map(|row| RowSplice {
                row,
                col: old_width,
                remove: 0,
                bytes: vec![b'-'; pad],
            })
            .collect();
        return (
            EditCmd::Batch {
                commands: vec![EditCmd::SpliceRows { splices }, insert],
            },
            truncated,
        );
    }
    (insert, truncated)
}

/// Paste FASTA from the clipboard as NEW sequences inserted at row index `at`
/// (existing rows shift down). `text` is the raw clipboard string — parsed in Rust
/// by the tolerant [`align_core::parse_fasta`] (joins wrapped lines, normalizes
/// `.`→`-`, keeps gaps, disambiguates duplicate names), so wrapped external FASTA
/// works too. GROW-to-fit: the alignment widens to the widest pasted sequence
/// (existing rows trailing-pad), so nothing truncates — except when the grown
/// buffer would exceed the size cap, where each sequence clamps to the current
/// width and the count is reported (see [`paste_sequences_cmd`]). Reversible
/// through the edit history (a grow is one [`EditCmd::Batch`] = one undo). Returns
/// a small JSON [`PasteSeqDto`]; the frontend re-syncs its view from
/// `get_alignment_meta` + `get_render_buffer` (a row-count change reuses the load
/// path). Errors if nothing is loaded.
#[tauri::command]
pub async fn paste_sequences(
    at: usize,
    text: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<PasteSeqDto, String> {
    // Keep empty-body records: an all-gap selection serializes to `>name` with
    // no residues (see `model/copy.ts`), and that empty FASTA must paste back as
    // an empty (all-gap) sequence with its name, not be dropped.
    let out = align_core::parse_fasta_with(
        text.as_bytes(),
        align_core::ParseOptions {
            keep_empty_records: true,
        },
    )
    .map_err(|e| e.to_string())?;
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let inserted = out.records.len();
    if inserted == 0 {
        return Ok(PasteSeqDto {
            inserted: 0,
            truncated: 0,
        });
    }
    let at = at.min(ds.alignment.num_rows()); // clamp a stale anchor to an append
    let (cmd, truncated) = paste_sequences_cmd(ds, at, &out.records);
    history.apply(ds, cmd).map_err(|e| e.to_string())?;
    Ok(PasteSeqDto {
        inserted,
        truncated,
    })
}

/// Post-delete dimensions of a STRUCTURAL delete (rows or columns). Unlike the
/// in-place edits, a structural delete changes the row count and/or the width, so
/// the frontend re-syncs its whole view from `get_alignment_meta` + the render
/// buffer (the load path), exactly like [`paste_sequences`] — it does NOT ride
/// the empty-bytes-means-no-op transport, which can't tell a real width-0 result
/// (delete every column) from an actual no-op. `num_rows == 0` (delete every row)
/// and `width == 0` (delete every column) are the legal empty-alignment states the
/// frontend renders as "nothing loaded but undoable".
#[derive(Serialize)]
pub struct DeleteResultDto {
    pub num_rows: usize,
    pub width: usize,
}

/// Splices that delete columns `c0..=c1` from EVERY row — a width-SHRINKING
/// structural column delete. Distinct from [`cut_shorten_writes`], which only
/// shifts within the *selected* rows and trailing-pads back to width (preserving
/// it): this removes the columns from the whole alignment so it narrows. Each row
/// gets one `remove = W = c1-c0+1` splice at `c0` (no replacement bytes), so every
/// row shrinks by the same `W` and the single-width invariant holds. `c1` is
/// clamped to the last column; an empty/zero-width alignment or a `c0` past the
/// right edge yields no splices (a graceful no-op). Deleting every column is
/// allowed and leaves width 0.
fn delete_columns_splices(ds: &Dataset, c0: usize, c1: usize) -> Vec<RowSplice> {
    let width = ds.alignment.width;
    let num_rows = ds.alignment.num_rows();
    if num_rows == 0 || width == 0 || c0 >= width {
        return Vec::new();
    }
    let c1 = c1.min(width - 1);
    let w = c1 - c0 + 1;
    (0..num_rows)
        .map(|row| RowSplice {
            row,
            col: c0,
            remove: w,
            bytes: Vec::new(),
        })
        .collect()
}

/// Delete whole sequences (rows) `at..at+count`, removing them from the alignment
/// AND the sequence list — the inverse re-inserts them verbatim (ids/names/gapped),
/// so undo restores them in place. Reversible through the edit history. `at` and
/// `count` are clamped to the current row set (a stale selection can't error), so
/// `count == 0` after clamping is a no-op. Returns the post-delete dimensions; the
/// frontend re-syncs its view (a row-count change reuses the load path). Errors if
/// nothing is loaded.
#[tauri::command]
pub async fn delete_rows(
    at: usize,
    count: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<DeleteResultDto, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let num_rows = ds.alignment.num_rows();
    let at = at.min(num_rows);
    let count = count.min(num_rows - at);
    history
        .apply(ds, EditCmd::DeleteRows { at, count })
        .map_err(|e| e.to_string())?;
    Ok(DeleteResultDto {
        num_rows: ds.alignment.num_rows(),
        width: ds.alignment.width,
    })
}

/// Delete columns `c0..=c1` from every row — a width-SHRINKING structural column
/// delete (see [`delete_columns_splices`]; not the width-preserving `cut_shorten`).
/// Reversible through the edit history (the inverse re-inserts the removed columns).
/// `c1` is clamped to the last column; deleting every column is allowed and leaves
/// width 0. Returns the post-delete dimensions; the frontend re-syncs its view (a
/// width change reuses the load path, robust to the width-0 edge). Errors if
/// nothing is loaded.
#[tauri::command]
pub async fn delete_columns(
    c0: usize,
    c1: usize,
    state: State<'_, Mutex<AppState>>,
) -> Result<DeleteResultDto, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let splices = delete_columns_splices(ds, c0, c1);
    history
        .apply(ds, EditCmd::SpliceRows { splices })
        .map_err(|e| e.to_string())?;
    Ok(DeleteResultDto {
        num_rows: ds.alignment.num_rows(),
        width: ds.alignment.width,
    })
}

// ---- pairwise alignment (M3) -----------------------------------------------

/// Outcome of [`pairwise_align`]: the score, %-identity, and aligned length of
/// the pairwise alignment that was just applied to the two selected rows. Small
/// JSON for the status readout; the alignment matrix changed (its width may have
/// grown), so the caller re-syncs its render buffer from [`get_render_buffer`]
/// (the row count, names, and alphabet are unchanged, so no meta re-fetch).
#[derive(Serialize)]
pub struct PairwiseResultDto {
    pub score: i32,
    pub percent_identity: f32,
    pub length: usize,
}

/// Build the reversible edit that replaces rows `row_a`/`row_b` with their
/// aligned forms, keeping the matrix rectangular. The two rows are spliced to the
/// aligned bytes padded to `target` width; when the pair came out WIDER than the
/// current width (and other rows exist) every other row is trailing-padded to
/// match. `target` is the pair's width `w` when these are the only two rows (so a
/// re-alignment can shrink the matrix), else `max(w, current_width)` (other rows
/// can only grow, never lose content). One [`EditCmd::SpliceRows`] (one splice per
/// row) ⇒ one undo step, with the inverse captured by the engine.
fn realign_splice(
    ds: &Dataset,
    row_a: usize,
    row_b: usize,
    aligned_a: &[u8],
    aligned_b: &[u8],
) -> EditCmd {
    let cur = ds.alignment.width;
    let n = ds.alignment.num_rows();
    let w = aligned_a.len(); // == aligned_b.len()
    let other_rows_exist = n > 2;
    let target = if other_rows_exist { w.max(cur) } else { w };

    let pad_to_target = |bytes: &[u8]| -> Vec<u8> {
        let mut v = bytes.to_vec();
        v.resize(target, b'-');
        v
    };

    let mut splices = vec![
        RowSplice {
            row: row_a,
            col: 0,
            remove: cur,
            bytes: pad_to_target(aligned_a),
        },
        RowSplice {
            row: row_b,
            col: 0,
            remove: cur,
            bytes: pad_to_target(aligned_b),
        },
    ];
    if target > cur {
        let tail = vec![b'-'; target - cur];
        for r in 0..n {
            if r != row_a && r != row_b {
                splices.push(RowSplice {
                    row: r,
                    col: cur,
                    remove: 0,
                    bytes: tail.clone(),
                });
            }
        }
    }
    EditCmd::SpliceRows { splices }
}

/// Pairwise-align the two selected sequences (their UNGAPPED residues) and
/// replace their rows in place with the aligned pair, reversibly. The alignment
/// matrix may grow in width; the row count is unchanged. `mode` is `"global"`
/// (Needleman–Wunsch) or `"local"` (Smith–Waterman). `matrix` / `gap_open` /
/// `gap_extend` are optional overrides — by default the matrix and gap penalties
/// follow the two sequences' (widened) alphabet (protein → BLOSUM62 / −11 / −1,
/// nucleotide → match·mismatch 2/−1 / −10 / −1). Errors if nothing is loaded, the
/// rows are the same or out of bounds, or an override is invalid. Returns the
/// score / %-identity / length; the caller re-syncs the render buffer.
#[tauri::command]
pub async fn pairwise_align(
    row_a: usize,
    row_b: usize,
    mode: String,
    matrix: Option<String>,
    gap_open: Option<i32>,
    gap_extend: Option<i32>,
    state: State<'_, Mutex<AppState>>,
) -> Result<PairwiseResultDto, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;

    let n = ds.alignment.num_rows();
    if row_a == row_b {
        return Err("select two different sequences to align".to_string());
    }
    if row_a >= n || row_b >= n {
        return Err(format!("row out of bounds (alignment has {n} rows)"));
    }
    let mode = match mode.as_str() {
        "global" => AlignMode::Global,
        "local" => AlignMode::Local,
        other => return Err(format!("unknown alignment mode '{other}'")),
    };

    let alphabet = ds.sequences[row_a]
        .alphabet
        .widen(ds.sequences[row_b].alphabet);
    let matrix = match &matrix {
        Some(name) => {
            SubstitutionMatrix::by_name(name).ok_or_else(|| format!("unknown matrix '{name}'"))?
        }
        None => SubstitutionMatrix::default_for(alphabet),
    };
    let defaults = Scoring::default_for(alphabet);
    let scoring = Scoring {
        gap_open: gap_open.unwrap_or(defaults.gap_open),
        gap_extend: gap_extend.unwrap_or(defaults.gap_extend),
    };

    // Align the ungapped residues (a fresh pairwise alignment ignores any prior
    // gaps in the rows).
    let a = ds.sequences[row_a].residues.clone();
    let b = ds.sequences[row_b].residues.clone();
    let result = pairwise(&a, &b, &matrix, mode, scoring);

    // An empty alignment (a local match that found nothing, or all-gap inputs)
    // would splice the rows to width 0 — skip the edit and let the caller report
    // "no alignment found" instead of silently wiping the rows.
    if result.length > 0 {
        let cmd = realign_splice(ds, row_a, row_b, &result.aligned_a, &result.aligned_b);
        history.apply(ds, cmd).map_err(|e| e.to_string())?;
    }

    Ok(PairwiseResultDto {
        score: result.score,
        percent_identity: result.percent_identity,
        length: result.length,
    })
}

// ---- multiple-sequence alignment (in-process progressive) ------------------

/// Outcome of [`msa_align`]: how many sequences were aligned and the resulting
/// alignment width. Small JSON for the status readout; the matrix changed (its
/// width may have grown) but the row count / names / alphabet did not, so the
/// caller re-syncs its render buffer from [`get_render_buffer`] (no meta refetch).
#[derive(Serialize)]
pub struct MsaResultDto {
    pub num_seqs: usize,
    pub length: usize,
}

/// Build the reversible edit that replaces each selected `row` with its aligned
/// form, keeping the matrix rectangular. Generalizes [`realign_splice`] from two
/// rows to N: each selected row is spliced to its aligned bytes padded to
/// `target`; non-selected rows trailing-pad if the alignment grew. `target` is the
/// alignment's `w` when **every** row is selected (so a re-alignment can shrink the
/// matrix), else `max(w, current_width)` (untouched rows never lose content). One
/// [`EditCmd::SpliceRows`] ⇒ one undo step. `rows[i]` pairs with `aligned[i]`
/// (`progressive_align` returns rows in input order), and `aligned` rows share one
/// width.
fn msa_splice(ds: &Dataset, rows: &[usize], aligned: &[Vec<u8>]) -> EditCmd {
    let cur = ds.alignment.width;
    let n = ds.alignment.num_rows();
    let w = aligned.first().map(|r| r.len()).unwrap_or(0);
    let all_selected = rows.len() == n;
    let target = if all_selected { w } else { w.max(cur) };

    let pad_to_target = |bytes: &[u8]| -> Vec<u8> {
        let mut v = bytes.to_vec();
        v.resize(target, b'-');
        v
    };

    let mut selected = vec![false; n];
    let mut splices = Vec::with_capacity(rows.len());
    for (&row, ab) in rows.iter().zip(aligned) {
        selected[row] = true;
        splices.push(RowSplice {
            row,
            col: 0,
            remove: cur,
            bytes: pad_to_target(ab),
        });
    }
    if target > cur {
        let tail = vec![b'-'; target - cur];
        for (r, &is_sel) in selected.iter().enumerate() {
            if !is_sel {
                splices.push(RowSplice {
                    row: r,
                    col: cur,
                    remove: 0,
                    bytes: tail.clone(),
                });
            }
        }
    }
    EditCmd::SpliceRows { splices }
}

/// Multiple-sequence-align the selected rows (their UNGAPPED residues) with the
/// in-process progressive aligner and replace their rows in place, reversibly. The
/// matrix width may grow; the row count is unchanged. `matrix` / `gap_open` /
/// `gap_extend` default to the alphabet **widened over all selected rows** (protein
/// → BLOSUM62 / −11 / −1, nucleotide → match·mismatch 2/−1 / −10 / −1). Errors if
/// nothing is loaded, fewer than two distinct rows are selected, or a row is out of
/// bounds. Returns the sequence count and width; the caller re-syncs the render
/// buffer.
#[tauri::command]
pub async fn msa_align(
    rows: Vec<usize>,
    engine: Option<String>,
    matrix: Option<String>,
    gap_open: Option<i32>,
    gap_extend: Option<i32>,
    state: State<'_, Mutex<AppState>>,
) -> Result<MsaResultDto, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;

    let n = ds.alignment.num_rows();
    // Normalize + validate the row list: in-bounds, sorted, deduped, ≥2 distinct.
    let mut rows = rows;
    rows.sort_unstable();
    rows.dedup();
    if rows.len() < 2 {
        return Err("select at least two different sequences to align".to_string());
    }
    if *rows.last().expect("non-empty after the len check") >= n {
        return Err(format!("row out of bounds (alignment has {n} rows)"));
    }

    // Default the matrix/scoring by widening the alphabet over ALL selected rows.
    let alphabet = rows
        .iter()
        .map(|&r| ds.sequences[r].alphabet)
        .reduce(|acc, a| acc.widen(a))
        .expect("at least two rows");
    let matrix = match &matrix {
        Some(name) => {
            SubstitutionMatrix::by_name(name).ok_or_else(|| format!("unknown matrix '{name}'"))?
        }
        None => SubstitutionMatrix::default_for(alphabet),
    };
    let defaults = Scoring::default_for(alphabet);
    let scoring = Scoring {
        gap_open: gap_open.unwrap_or(defaults.gap_open),
        gap_extend: gap_extend.unwrap_or(defaults.gap_extend),
    };

    // Pick the backend (default progressive). Every engine returns an MsaResult,
    // so the row-splice below is backend-agnostic.
    let engine = match &engine {
        Some(name) => {
            MsaEngine::from_name(name).ok_or_else(|| format!("unknown align engine '{name}'"))?
        }
        None => MsaEngine::Progressive,
    };

    // Align the ungapped residues (a fresh MSA ignores any prior gaps in the rows).
    let seqs: Vec<Vec<u8>> = rows
        .iter()
        .map(|&r| ds.sequences[r].residues.clone())
        .collect();
    let refs: Vec<&[u8]> = seqs.iter().map(|v| v.as_slice()).collect();
    let result = match engine {
        MsaEngine::Progressive => progressive_align(&refs, &matrix, scoring),
        MsaEngine::Kalign => {
            // KAlign uses its own matrix-tuned defaults (alphabet picks the type);
            // our `matrix`/`scoring` apply only to the progressive backend.
            #[cfg(feature = "kalign")]
            {
                align_extern::kalign_align(&refs, alphabet).map_err(|e| e.to_string())?
            }
            #[cfg(not(feature = "kalign"))]
            {
                let _ = (&refs, alphabet, &matrix, scoring);
                return Err(
                    "the KAlign engine is not built into this binary (rebuild with \
                     --features kalign)"
                        .to_string(),
                );
            }
        }
    };

    // Every selected row all-gap ⇒ width 0 — skip the edit (don't wipe the rows to
    // nothing) and let the caller report it.
    if result.length > 0 {
        let cmd = msa_splice(ds, &rows, &result.rows);
        history.apply(ds, cmd).map_err(|e| e.to_string())?;
    }

    Ok(MsaResultDto {
        num_seqs: rows.len(),
        length: result.length,
    })
}

// ---- block / sub-area alignment --------------------------------------------

/// Outcome of [`block_align`]: how many sequences were aligned, the aligned block
/// width (`length`), whether the matrix GREW (Grow inserted columns), and — in Fit
/// mode when the optimal block overflowed the window — how many more columns it
/// would have needed (`fit_overflow`, 0 otherwise). When `fit_overflow > 0` **no
/// edit was made** (Fit refuses rather than growing); the caller turns it into a
/// "widen or Grow" message. `length == 0` likewise means no edit (an all-gap
/// window — nothing to align). Otherwise an edit was applied and the caller
/// re-syncs its render buffer from [`get_render_buffer`] (`grew` ⇒ the width grew).
#[derive(Serialize)]
pub struct BlockAlignResultDto {
    pub num_seqs: usize,
    pub length: usize,
    pub grew: bool,
    pub fit_overflow: usize,
}

/// The selected rows' UNGAPPED residues **within the column window** `[c0, c1]`:
/// the gapped bytes in that span with gaps dropped. This is what block align
/// re-aligns — only the windowed residues, not the whole rows. Reads rows
/// directly, so callers must have validated the row indices and `c0 <= c1 < width`
/// first (the command clamps + guards, mirroring [`cut_shorten_writes`]).
fn block_window_seqs(ds: &Dataset, rows: &[usize], c0: usize, c1: usize) -> Vec<Vec<u8>> {
    rows.iter()
        .map(|&row| {
            ds.alignment.rows[row].gapped[c0..=c1]
                .iter()
                .copied()
                .filter(|&b| !align_core::coords::is_gap(b))
                .collect()
        })
        .collect()
}

/// How an aligned block (`wblock = aligned[0].len()` columns) reconciles against
/// the selected window (`worig` columns) — the pure core of block align.
enum BlockPlacement {
    /// `wblock <= worig`: the block fits — a width-PRESERVING [`EditCmd::SetCells`]
    /// that left-justifies each aligned row in the window and gap-pads the tail to
    /// `worig`. Cells outside the window (and every non-selected row) are untouched.
    Fit(EditCmd),
    /// `wblock > worig` + Grow: a width-GROWING [`EditCmd::SpliceRows`] that inserts
    /// `wblock - worig` columns at the block's right edge — selected rows replace
    /// their window with the aligned block, non-selected rows get gap columns — so
    /// every row grows by the same delta and stays rectangular.
    Grow(EditCmd),
    /// `wblock > worig` + Fit: the optimal block is wider than the window and Fit
    /// refuses to grow. No edit; the field is how many more columns it would need.
    Overflow(usize),
}

/// Reconcile an aligned block against its window and build the ONE reversible edit
/// (or an overflow refusal). `aligned[i]` is the aligned form of `rows[i]`'s
/// windowed residues (all share width `wblock`); `worig = c1 - c0 + 1`. See
/// [`BlockPlacement`] for the three cases. No new [`EditCmd`] variant is needed —
/// Fit is a `SetCells`, Grow is a `SpliceRows` — and residues are re-arranged, not
/// changed, so undo is lossless by construction. Callers guard `wblock == 0` (an
/// all-gap window) before calling; here `wblock == 0 <= worig` would land in Fit
/// and gap-fill the window, which the caller avoids by short-circuiting.
fn block_align_cmd(
    ds: &Dataset,
    rows: &[usize],
    c0: usize,
    worig: usize,
    aligned: &[Vec<u8>],
    grow: bool,
) -> BlockPlacement {
    let wblock = aligned.first().map(|r| r.len()).unwrap_or(0);

    if wblock <= worig {
        // Fits: left-justify the aligned block in [c0, c0+worig) and gap-pad the
        // tail back to `worig` — a per-row in-place overwrite (width preserved).
        let writes = rows
            .iter()
            .zip(aligned)
            .map(|(&row, ab)| {
                let mut bytes = ab.clone();
                bytes.resize(worig, b'-');
                CellWrite {
                    row,
                    col: c0,
                    bytes,
                }
            })
            .collect();
        return BlockPlacement::Fit(EditCmd::SetCells { writes });
    }

    if !grow {
        return BlockPlacement::Overflow(wblock - worig);
    }

    // Grow: insert `g` columns at the block's right edge (`c1 + 1 == c0 + worig`).
    // Selected rows replace their window `[c0, c1]` (`remove = worig`) with the
    // aligned block (`wblock` bytes); non-selected rows insert `g` gap cells there
    // (`remove = 0`). Both deltas are `+g`, so every row ends width `width + g`.
    let g = wblock - worig;
    let n = ds.alignment.num_rows();
    let insert_col = c0 + worig; // == c1 + 1
    let mut selected = vec![false; n];
    let mut splices = Vec::with_capacity(n);
    for (&row, ab) in rows.iter().zip(aligned) {
        selected[row] = true;
        splices.push(RowSplice {
            row,
            col: c0,
            remove: worig,
            bytes: ab.clone(),
        });
    }
    let tail = vec![b'-'; g];
    for (r, &is_sel) in selected.iter().enumerate() {
        if !is_sel {
            splices.push(RowSplice {
                row: r,
                col: insert_col,
                remove: 0,
                bytes: tail.clone(),
            });
        }
    }
    BlockPlacement::Grow(EditCmd::SpliceRows { splices })
}

/// Block / sub-area align: re-align only the selected rows' residues **within the
/// column window** `[c0, c1]`, leaving every other cell (other rows, and the
/// selected rows' cells outside the window) untouched. The windowed ungapped
/// residues are extracted, aligned with the same engine as the whole-row path
/// (2 rows under the progressive engine ⇒ optimal pairwise Gotoh; 3+/KAlign ⇒ the
/// progressive/KAlign MSA), then reconciled against the window width: a block that
/// fits is dropped in place (width preserved); one that overflows either refuses
/// (Fit, `grow == false`) or inserts the needed columns (Grow). One reversible edit
/// per call. `matrix`/`gap_open`/`gap_extend` default to the alphabet widened over
/// the selected rows. Errors if nothing is loaded, fewer than two distinct rows are
/// selected, a row is out of bounds, or the column range is invalid.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn block_align(
    rows: Vec<usize>,
    c0: usize,
    c1: usize,
    grow: bool,
    engine: Option<String>,
    matrix: Option<String>,
    gap_open: Option<i32>,
    gap_extend: Option<i32>,
    state: State<'_, Mutex<AppState>>,
) -> Result<BlockAlignResultDto, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;

    let n = ds.alignment.num_rows();
    // Normalize + validate the row list: in-bounds, sorted, deduped, ≥2 distinct.
    let mut rows = rows;
    rows.sort_unstable();
    rows.dedup();
    if rows.len() < 2 {
        return Err("select at least two different sequences to align".to_string());
    }
    if *rows.last().expect("non-empty after the len check") >= n {
        return Err(format!("row out of bounds (alignment has {n} rows)"));
    }

    // Clamp the column window ONCE, here, and derive `worig` from the clamped `c1`
    // so the extractor and the width math never disagree (a stale selection index
    // must clamp, not panic — the same discipline as `cut_shorten_writes`).
    let width = ds.alignment.width;
    if width == 0 {
        return Err("nothing to align (the alignment is empty)".to_string());
    }
    let c1 = c1.min(width - 1);
    if c0 > c1 {
        return Err("invalid column range".to_string());
    }
    let worig = c1 - c0 + 1;

    // Default the matrix/scoring by widening the alphabet over ALL selected rows.
    let alphabet = rows
        .iter()
        .map(|&r| ds.sequences[r].alphabet)
        .reduce(|acc, a| acc.widen(a))
        .expect("at least two rows");
    let matrix = match &matrix {
        Some(name) => {
            SubstitutionMatrix::by_name(name).ok_or_else(|| format!("unknown matrix '{name}'"))?
        }
        None => SubstitutionMatrix::default_for(alphabet),
    };
    let defaults = Scoring::default_for(alphabet);
    let scoring = Scoring {
        gap_open: gap_open.unwrap_or(defaults.gap_open),
        gap_extend: gap_extend.unwrap_or(defaults.gap_extend),
    };
    let engine = match &engine {
        Some(name) => {
            MsaEngine::from_name(name).ok_or_else(|| format!("unknown align engine '{name}'"))?
        }
        None => MsaEngine::Progressive,
    };

    // Extract + align the windowed residues (a fresh alignment ignores prior gaps).
    let seqs = block_window_seqs(ds, &rows, c0, c1);
    let refs: Vec<&[u8]> = seqs.iter().map(|v| v.as_slice()).collect();
    // Exactly 2 rows under the progressive engine ⇒ the optimal pairwise Gotoh
    // (identical to the whole-row path, just windowed input); everything else routes
    // through the MSA backend, which returns rows in input order too.
    let (aligned, wblock): (Vec<Vec<u8>>, usize) =
        if rows.len() == 2 && engine == MsaEngine::Progressive {
            let r = pairwise(refs[0], refs[1], &matrix, AlignMode::Global, scoring);
            let w = r.aligned_a.len();
            (vec![r.aligned_a, r.aligned_b], w)
        } else {
            let result = match engine {
                MsaEngine::Progressive => progressive_align(&refs, &matrix, scoring),
                MsaEngine::Kalign => {
                    #[cfg(feature = "kalign")]
                    {
                        align_extern::kalign_align(&refs, alphabet).map_err(|e| e.to_string())?
                    }
                    #[cfg(not(feature = "kalign"))]
                    {
                        let _ = (&refs, alphabet, &matrix, scoring);
                        return Err(
                            "the KAlign engine is not built into this binary (rebuild with \
                             --features kalign)"
                                .to_string(),
                        );
                    }
                }
            };
            let w = result.length;
            (result.rows, w)
        };

    // Every selected row all-gap in the window ⇒ width 0 — nothing to align; skip
    // the edit (mirror the whole-row `length == 0` guard).
    if wblock == 0 {
        return Ok(BlockAlignResultDto {
            num_seqs: rows.len(),
            length: 0,
            grew: false,
            fit_overflow: 0,
        });
    }

    let (grew, overflow) = match block_align_cmd(ds, &rows, c0, worig, &aligned, grow) {
        BlockPlacement::Fit(cmd) => {
            history.apply(ds, cmd).map_err(|e| e.to_string())?;
            (false, 0)
        }
        BlockPlacement::Grow(cmd) => {
            history.apply(ds, cmd).map_err(|e| e.to_string())?;
            (true, 0)
        }
        BlockPlacement::Overflow(by) => (false, by),
    };

    Ok(BlockAlignResultDto {
        num_seqs: rows.len(),
        length: wblock,
        grew,
        fit_overflow: overflow,
    })
}

/// Undo the most recent edit; returns the post-edit render buffer (empty when
/// there is nothing to undo). Errors if nothing is loaded.
#[tauri::command]
pub async fn undo_edit(state: State<'_, Mutex<AppState>>) -> Result<tauri::ipc::Response, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let changed = history.undo(ds).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(edit_bytes(
        ds,
        changed.as_deref().unwrap_or(&[]),
    )))
}

/// Redo the most recently undone edit; returns the post-edit render buffer
/// (empty when there is nothing to redo). Errors if nothing is loaded.
#[tauri::command]
pub async fn redo_edit(state: State<'_, Mutex<AppState>>) -> Result<tauri::ipc::Response, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let AppState { dataset, history } = &mut *guard;
    let ds = dataset
        .as_mut()
        .ok_or_else(|| "no alignment loaded".to_string())?;
    let changed = history.redo(ds).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(edit_bytes(
        ds,
        changed.as_deref().unwrap_or(&[]),
    )))
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

    #[test]
    fn clear_cells_masks_rect_and_undo_restores_buffer() {
        // The edit path the `clear_cells`/`undo_edit` commands run, minus the
        // Tauri State plumbing: build gap-fill writes, apply through the history,
        // and confirm the flattened render buffer reflects the edit and its undo.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();

        // Mask rows 0..=1, cols 1..=2.
        let writes = gap_fill_writes(0, 1, 1, 2);
        let changed = history
            .apply(&mut ds, align_core::EditCmd::SetCells { writes })
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(flatten_buffer(&ds), b"A--TT--T");

        history.undo(&mut ds).unwrap();
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn cut_shorten_shifts_tail_left_and_leaves_other_rows_untouched() {
        // Cut cols 1..=2 from rows 0..=1 of a 3-row alignment: those rows delete the
        // 2 selected cols and shift their tail left (W=2 trailing gaps); row 2 is
        // untouched. Each write overwrites the row's tail [c0..width] in place.
        let ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT"), rec("c", "GGGG")]);
        let writes = cut_shorten_writes(&ds, 0, 1, 1, 2);
        assert_eq!(
            writes,
            vec![
                CellWrite {
                    row: 0,
                    col: 1,
                    bytes: b"T--".to_vec()
                },
                CellWrite {
                    row: 1,
                    col: 1,
                    bytes: b"T--".to_vec()
                },
            ]
        );
    }

    #[test]
    fn cut_shorten_through_history_preserves_width_and_undo_restores() {
        // The path the `cut_shorten` command runs, minus the Tauri State plumbing.
        // Width is PRESERVED (the cut rows trailing-pad back to width); undo
        // re-inserts the cut columns exactly.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT"), rec("c", "GGGG")]);
        let mut history = align_core::EditStack::new();
        let writes = cut_shorten_writes(&ds, 0, 1, 1, 2);
        let changed = history
            .apply(&mut ds, align_core::EditCmd::SetCells { writes })
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.width, 4); // preserved
        assert_eq!(flatten_buffer(&ds), b"AT--TT--GGGG");
        history.undo(&mut ds).unwrap();
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTTGGGG");
    }

    #[test]
    fn cut_shorten_single_cell_and_right_edge() {
        let ds = Dataset::from_records(&[rec("a", "ACGT")]);
        // Single cell at col 1: delete "C", shift "GT" left, 1 trailing gap.
        assert_eq!(
            cut_shorten_writes(&ds, 0, 0, 1, 1),
            vec![CellWrite {
                row: 0,
                col: 1,
                bytes: b"GT-".to_vec()
            }]
        );
        // At the right edge (c1 == width-1): empty `keep`, the tail is pure gaps.
        assert_eq!(
            cut_shorten_writes(&ds, 0, 0, 2, 3),
            vec![CellWrite {
                row: 0,
                col: 2,
                bytes: b"--".to_vec()
            }]
        );
    }

    #[test]
    fn cut_shorten_clamps_stale_row_range() {
        // r1 past the last row must not panic the direct row index — it clamps.
        let ds = Dataset::from_records(&[rec("a", "ACGT")]);
        assert_eq!(
            cut_shorten_writes(&ds, 0, 99, 0, 0),
            vec![CellWrite {
                row: 0,
                col: 0,
                bytes: b"CGT-".to_vec()
            }]
        );
        // r0 past the end ⇒ no writes (graceful no-op, no panic).
        assert!(cut_shorten_writes(&ds, 5, 9, 0, 0).is_empty());
    }

    #[test]
    fn edit_bytes_is_empty_on_noop() {
        let ds = Dataset::from_records(&[rec("a", "ACGT")]);
        assert!(edit_bytes(&ds, &[]).is_empty());
        assert_eq!(edit_bytes(&ds, &[0]), b"ACGT");
    }

    #[test]
    fn paste_overwrite_fits_overwrites_in_place() {
        // A block that fits within the width overwrites the target rows in place —
        // a SetCells, no width change. The 3rd line is past the last row (dropped).
        let ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let rows = vec!["XX".to_string(), "YY".to_string(), "ZZ".to_string()];
        match paste_overwrite_cmd(&ds, 0, 2, &rows) {
            EditCmd::SetCells { writes } => assert_eq!(
                writes,
                vec![
                    CellWrite {
                        row: 0,
                        col: 2,
                        bytes: b"XX".to_vec()
                    },
                    CellWrite {
                        row: 1,
                        col: 2,
                        bytes: b"YY".to_vec()
                    },
                ]
            ),
            other => panic!("expected SetCells, got {other:?}"),
        }
    }

    #[test]
    fn paste_overwrite_fits_skips_empty_lines() {
        // A blank line overwrites nothing (its row is left as-is); the row index
        // still advances so the next line lands on the right row.
        let ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let rows = vec!["".to_string(), "GG".to_string()];
        match paste_overwrite_cmd(&ds, 0, 0, &rows) {
            EditCmd::SetCells { writes } => assert_eq!(
                writes,
                vec![CellWrite {
                    row: 1,
                    col: 0,
                    bytes: b"GG".to_vec()
                }]
            ),
            other => panic!("expected SetCells, got {other:?}"),
        }
    }

    #[test]
    fn paste_overwrite_grows_past_right_edge_and_undo_restores() {
        // A line reaching past the right edge GROWS the alignment (never truncates):
        // overwrite "XXXX" at col 2 of width 4 → needs width 6. Row 0's old cells
        // past the overwrite are kept where they still fit; the other row trailing-
        // pads to stay equal-width.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let cmd = paste_overwrite_cmd(&ds, 0, 2, &["XXXX".to_string()]);
        assert!(matches!(cmd, EditCmd::SpliceRows { .. }));
        let changed = history.apply(&mut ds, cmd).unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.width, 6);
        // Row 0: "AC" + "XXXX" = "ACXXXX"; row 1: "TTTT" padded → "TTTT--".
        assert_eq!(flatten_buffer(&ds), b"ACXXXXTTTT--");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn paste_insert_splices_drops_rows_past_end() {
        // A 2-line block but only 1 row exists: the 2nd line is dropped, and the
        // block width is the widest KEPT line ("GG" = 2, not "TTT").
        let ds = Dataset::from_records(&[rec("a", "ACGT")]);
        let splices =
            paste_insert_splices(&ds, 0, 0, &["GG".to_string(), "TTT".to_string()], false);
        assert_eq!(
            splices,
            vec![RowSplice {
                row: 0,
                col: 0,
                remove: 0,
                bytes: b"GG".to_vec()
            }]
        );
    }

    #[test]
    fn paste_insert_shift_only_grows_width_and_undo_restores() {
        // Insert "GG" into row 0 at col 1; the other row trailing-pads to stay
        // equal-width (shift-only de-aligns row 0's right side).
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let splices = paste_insert_splices(&ds, 0, 1, &["GG".to_string()], false);
        let changed = history
            .apply(&mut ds, align_core::EditCmd::SpliceRows { splices })
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(flatten_buffer(&ds), b"AGGCGTTTTT--");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn paste_insert_shift_all_keeps_columns_aligned() {
        // shift_all inserts the W gaps at c0 in the OTHER rows too, so column
        // positions stay synchronized across rows.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let splices = paste_insert_splices(&ds, 0, 1, &["GG".to_string()], true);
        history
            .apply(&mut ds, align_core::EditCmd::SpliceRows { splices })
            .unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(flatten_buffer(&ds), b"AGGCGTT--TTT");
        // shift_all emits one splice PER ROW (vs one per pasted row), so its inverse
        // strips gaps from every row — confirm that larger inverse round-trips, then
        // redo restores the forward result.
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
        history.redo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(flatten_buffer(&ds), b"AGGCGTT--TTT");
    }

    #[test]
    fn paste_overwrite_through_history_and_undo() {
        // The edit path `paste_overwrite` runs, minus the Tauri State plumbing:
        // build the overwrite command (fits ⇒ SetCells), apply through the history,
        // confirm the buffer and that undo restores it.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let rows = vec!["GG".to_string(), "CC".to_string()];
        let cmd = paste_overwrite_cmd(&ds, 0, 1, &rows);
        let changed = history.apply(&mut ds, cmd).unwrap();
        assert!(!changed.is_empty());
        assert_eq!(flatten_buffer(&ds), b"AGGTTCCT");
        history.undo(&mut ds).unwrap();
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn grow_target_width_picks_grow_clamp_or_keep() {
        // Records already fit the current width → keep it (no grow, no truncation).
        assert_eq!(grow_target_width(2, 4, 3, 1, 100), 4);
        // A wider record, grown buffer within the cap → grow to the widest.
        assert_eq!(grow_target_width(2, 4, 6, 1, 100), 6); // (2+1)*6 = 18 <= 100
                                                           // A wider record, grown buffer over the cap → keep the old width (clamp).
        assert_eq!(grow_target_width(2, 4, 6, 1, 10), 4); // (2+1)*6 = 18 > 10
                                                          // An empty alignment always adopts the widest (no existing rows to multiply).
        assert_eq!(grow_target_width(0, 0, 5, 2, 1), 5);
    }

    #[test]
    fn paste_sequences_cmd_grows_to_fit_and_undo_restores_width() {
        // Into width-4 rows, paste a width-6 sequence: GROW to 6 — a Batch that pads
        // every existing row, then inserts the wide row. Nothing truncates.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let records = [rec("wide", "GGGGGG")];
        let (cmd, truncated) = paste_sequences_cmd(&ds, 2, &records);
        assert_eq!(truncated, 0);
        assert!(matches!(cmd, EditCmd::Batch { .. }));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.num_rows(), 3);
        // Existing rows padded to width 6; the new row inserted at the end.
        assert_eq!(flatten_buffer(&ds), b"ACGT--TTTT--GGGGGG");
        assert_eq!(ds.sequences[2].name, "wide");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn paste_sequences_cmd_grow_at_interior_row_round_trips() {
        // GROW with at < num_rows (paste partway down): the new wide row lands
        // BETWEEN the existing rows, both of which pad to the new width. Pins the
        // undo ordering for the interior case — the inverse must DeleteRows (drop the
        // inserted row) before the SpliceRows-trim, so the existing-row indices the
        // trim targets are valid.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let records = [rec("wide", "GGGGGG")];
        let (cmd, truncated) = paste_sequences_cmd(&ds, 1, &records);
        assert_eq!(truncated, 0);
        assert!(matches!(cmd, EditCmd::Batch { .. }));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.num_rows(), 3);
        // Row order: a (padded), wide (inserted at 1), b (padded).
        assert_eq!(flatten_buffer(&ds), b"ACGT--GGGGGGTTTT--");
        assert_eq!(ds.sequences[1].name, "wide");
        // Undo trims the existing rows back to width 4 AND removes the inserted row.
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
        // Redo restores the grown, interior-inserted state.
        history.redo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(flatten_buffer(&ds), b"ACGT--GGGGGGTTTT--");
        assert_eq!(ds.sequences[1].name, "wide");
    }

    #[test]
    fn paste_sequences_cmd_no_grow_when_records_fit() {
        // Records no wider than the alignment → a plain InsertRows (pad short ones),
        // no truncation, width unchanged.
        let ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let records = [rec("short", "GG"), rec("exact", "CCCC")];
        let (cmd, truncated) = paste_sequences_cmd(&ds, 2, &records);
        assert_eq!(truncated, 0);
        match cmd {
            EditCmd::InsertRows { at, rows } => {
                assert_eq!(at, 2);
                assert_eq!(rows[0].gapped, b"GG--"); // padded to width 4
                assert_eq!(rows[1].gapped, b"CCCC");
                assert_eq!(rows[0].id, 2); // fresh ids past the max existing
                assert_eq!(rows[1].id, 3);
            }
            other => panic!("expected InsertRows, got {other:?}"),
        }
    }

    #[test]
    fn paste_sequences_cmd_empty_alignment_adopts_widest() {
        // No rows yet → a plain InsertRows establishing the width (the widest record).
        let ds = Dataset::default();
        let records = [rec("a", "ACG"), rec("b", "TTTTT")];
        let (cmd, truncated) = paste_sequences_cmd(&ds, 0, &records);
        assert_eq!(truncated, 0);
        match cmd {
            EditCmd::InsertRows { at, rows } => {
                assert_eq!(at, 0);
                assert_eq!(rows[0].gapped, b"ACG--"); // padded to the widest (5)
                assert_eq!(rows[1].gapped, b"TTTTT");
            }
            other => panic!("expected InsertRows, got {other:?}"),
        }
    }

    #[test]
    fn paste_sequences_cmd_empty_records_is_noop() {
        let ds = Dataset::from_records(&[rec("a", "ACGT")]);
        let (cmd, truncated) = paste_sequences_cmd(&ds, 1, &[]);
        assert_eq!(truncated, 0);
        assert!(matches!(cmd, EditCmd::InsertRows { rows, .. } if rows.is_empty()));
    }

    #[test]
    fn paste_sequences_cmd_keeps_empty_record_as_padded_gap_row() {
        // An empty-body record (a `>name` with no residues — how FASTA copy
        // serializes an all-gap selection) inserts as an all-gap row padded to the
        // alignment width, name preserved. The round-trip the empty-FASTA copy needs.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let records = [rec("empty", "")];
        let (cmd, truncated) = paste_sequences_cmd(&ds, 2, &records);
        assert_eq!(truncated, 0);
        match &cmd {
            EditCmd::InsertRows { rows, .. } => {
                assert_eq!(rows[0].gapped, b"----"); // padded to width 4
                assert_eq!(rows[0].name, "empty");
            }
            other => panic!("expected InsertRows, got {other:?}"),
        }
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT----");
        assert_eq!(ds.sequences[2].name, "empty");
        assert!(ds.sequences[2].residues.is_empty()); // an empty sequence (no residues)
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn paste_sequences_cmd_empty_record_into_empty_alignment_no_panic() {
        // Degenerate edge: an empty record into a 0-row/0-width alignment → widest 0
        // → a width-0 InsertRows. Must apply without panicking the width check.
        let mut ds = Dataset::default();
        let mut history = align_core::EditStack::new();
        let records = [rec("e", "")];
        let (cmd, truncated) = paste_sequences_cmd(&ds, 0, &records);
        assert_eq!(truncated, 0);
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.num_rows(), 1);
        assert_eq!(ds.alignment.width, 0);
        assert_eq!(ds.sequences[0].name, "e");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 0);
    }

    // ---- structural delete (delete_rows / delete_columns) ------------------

    #[test]
    fn delete_columns_splices_remove_w_at_c0_for_every_row() {
        // One splice per row, each removing W = c1-c0+1 cells at c0 (no bytes), so
        // every row shrinks equally and the result stays single-width.
        let ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        assert_eq!(
            delete_columns_splices(&ds, 1, 2),
            vec![
                RowSplice {
                    row: 0,
                    col: 1,
                    remove: 2,
                    bytes: Vec::new()
                },
                RowSplice {
                    row: 1,
                    col: 1,
                    remove: 2,
                    bytes: Vec::new()
                },
            ]
        );
    }

    #[test]
    fn delete_columns_through_history_shrinks_width_and_undo_restores() {
        // The path the `delete_columns` command runs, minus the Tauri State plumbing.
        // Delete cols 1..=2 from a width-4, 2-row alignment → width 2; undo restores
        // both the width and the exact bytes (the inverse re-inserts the columns).
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let splices = delete_columns_splices(&ds, 1, 2);
        let changed = history
            .apply(&mut ds, EditCmd::SpliceRows { splices })
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.width, 2);
        // Row 0: "ACGT" minus cols 1,2 = "AT"; row 1: "TTTT" → "TT".
        assert_eq!(flatten_buffer(&ds), b"ATTT");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn delete_all_columns_leaves_width_zero_and_undo_restores() {
        // The delete-every-column edge: removing cols 0..=width-1 from every row
        // leaves a legal empty (width-0) alignment with the row COUNT intact. The
        // render buffer is empty, but it is a real edit (not a no-op), so the
        // frontend must resync from dimensions — hence `delete_columns` returns a
        // DTO, not the empty-bytes-is-no-op transport. Undo restores everything.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        let splices = delete_columns_splices(&ds, 0, 3);
        assert_eq!(splices.len(), 2); // one per row
        let changed = history
            .apply(&mut ds, EditCmd::SpliceRows { splices })
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.width, 0);
        assert_eq!(ds.alignment.num_rows(), 2); // rows survive, just empty
        assert!(flatten_buffer(&ds).is_empty());
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    #[test]
    fn delete_columns_splices_clamp_and_noop_edges() {
        let ds = Dataset::from_records(&[rec("a", "ACGT")]);
        // c1 past the right edge clamps to the last column (delete cols 2..=3).
        assert_eq!(
            delete_columns_splices(&ds, 2, 99),
            vec![RowSplice {
                row: 0,
                col: 2,
                remove: 2,
                bytes: Vec::new()
            }]
        );
        // c0 past the right edge ⇒ no splices (graceful no-op).
        assert!(delete_columns_splices(&ds, 9, 9).is_empty());
        // No rows ⇒ no splices.
        let empty = Dataset::default();
        assert!(delete_columns_splices(&empty, 0, 0).is_empty());
    }

    #[test]
    fn delete_rows_through_history_drops_sequences_and_undo_restores() {
        // The path the `delete_rows` command runs: DeleteRows through the history
        // removes the sequences (names included); undo re-inserts them verbatim.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT"), rec("c", "GGGG")]);
        let mut history = align_core::EditStack::new();
        let changed = history
            .apply(&mut ds, EditCmd::DeleteRows { at: 0, count: 2 })
            .unwrap();
        assert!(!changed.is_empty());
        assert_eq!(ds.alignment.num_rows(), 1);
        assert_eq!(ds.sequences[0].name, "c");
        assert_eq!(flatten_buffer(&ds), b"GGGG");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 3);
        assert_eq!(ds.sequences[0].name, "a");
        assert_eq!(ds.sequences[1].name, "b");
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTTGGGG");
    }

    #[test]
    fn delete_all_rows_leaves_empty_alignment() {
        // The delete-every-row edge: 0 rows is a legal empty state (undoable). The
        // surviving width is irrelevant (no rows render); the frontend keys its
        // empty branch off num_rows == 0.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT")]);
        let mut history = align_core::EditStack::new();
        history
            .apply(&mut ds, EditCmd::DeleteRows { at: 0, count: 2 })
            .unwrap();
        assert_eq!(ds.alignment.num_rows(), 0);
        assert!(flatten_buffer(&ds).is_empty());
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.num_rows(), 2);
        assert_eq!(flatten_buffer(&ds), b"ACGTTTTT");
    }

    // ---- pairwise realign splice ------------------------------------------

    #[test]
    fn realign_splice_two_rows_shrinks_to_pair_width() {
        // Only two rows: the realigned pair becomes the whole alignment, so the
        // matrix can shrink to the pair's width (here 4, from a padded width 6).
        let mut ds = Dataset::from_records(&[rec("a", "AC--GT"), rec("b", "ACGGGT")]);
        let mut history = align_core::EditStack::new();
        let cmd = realign_splice(&ds, 0, 1, b"ACGT", b"ACGT");
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.alignment.rows[1].gapped, b"ACGT");
        // One reversible edit: undo restores the originals + width.
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[0].gapped, b"AC--GT");
        assert_eq!(ds.alignment.rows[1].gapped, b"ACGGGT");
    }

    #[test]
    fn realign_splice_widens_other_rows_with_trailing_gaps() {
        // Three rows, width 4; the realigned pair comes out width 6, so every OTHER
        // row trailing-pads to 6 (its content untouched) to keep the matrix square.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT"), rec("c", "GGGG")]);
        let mut history = align_core::EditStack::new();
        let cmd = realign_splice(&ds, 0, 2, b"A-C-GT", b"-G-G-G");
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[0].gapped, b"A-C-GT");
        assert_eq!(ds.alignment.rows[2].gapped, b"-G-G-G");
        assert_eq!(ds.alignment.rows[1].gapped, b"TTTT--"); // untouched row, padded
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[1].gapped, b"TTTT");
    }

    #[test]
    fn realign_splice_equal_width_leaves_others_untouched() {
        // Pair width == current width and >2 rows: no widening splices, only the two
        // target rows are replaced; the other row keeps its exact bytes.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "TTTT"), rec("c", "GGGG")]);
        let mut history = align_core::EditStack::new();
        let cmd = realign_splice(&ds, 0, 1, b"A-GT", b"T-TT");
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"A-GT");
        assert_eq!(ds.alignment.rows[1].gapped, b"T-TT");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGG");
    }

    // ---- MSA realign splice (N rows) --------------------------------------

    #[test]
    fn msa_splice_all_rows_shrinks_to_alignment_width() {
        // Every row selected: the MSA becomes the whole alignment, so the matrix
        // can shrink to the aligned width (here 4, from a padded width 6).
        let mut ds =
            Dataset::from_records(&[rec("a", "AC--GT"), rec("b", "ACG-GT"), rec("c", "AC-GGT")]);
        let mut history = align_core::EditStack::new();
        let aligned = vec![b"ACGT".to_vec(), b"ACGT".to_vec(), b"ACGT".to_vec()];
        let cmd = msa_splice(&ds, &[0, 1, 2], &aligned);
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.alignment.rows[2].gapped, b"ACGT");
        // One reversible edit: undo restores the originals + width.
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[0].gapped, b"AC--GT");
        assert_eq!(ds.alignment.rows[2].gapped, b"AC-GGT");
    }

    #[test]
    fn msa_splice_subset_widens_other_rows() {
        // Four rows, width 4; align rows 0,1,3 into width 6 → the unselected row 2
        // trailing-pads to 6 (content untouched) to keep the matrix square.
        let mut ds = Dataset::from_records(&[
            rec("a", "ACGT"),
            rec("b", "TTTT"),
            rec("c", "GGGG"),
            rec("d", "CCCC"),
        ]);
        let mut history = align_core::EditStack::new();
        let aligned = vec![b"A-C-GT".to_vec(), b"T-T-TT".to_vec(), b"C-C-CC".to_vec()];
        let cmd = msa_splice(&ds, &[0, 1, 3], &aligned);
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[0].gapped, b"A-C-GT");
        assert_eq!(ds.alignment.rows[1].gapped, b"T-T-TT");
        assert_eq!(ds.alignment.rows[3].gapped, b"C-C-CC");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGG--"); // untouched, padded
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGG");
    }

    // ---- block / sub-area align --------------------------------------------

    /// Unwrap a Fit/Grow placement to its edit; a Fit-overflow refusal is a test bug.
    fn placement_cmd(p: BlockPlacement) -> EditCmd {
        match p {
            BlockPlacement::Fit(cmd) | BlockPlacement::Grow(cmd) => cmd,
            BlockPlacement::Overflow(by) => panic!("unexpected Fit overflow needing {by} cols"),
        }
    }

    /// A row's ungapped residues — the losslessness invariant reads these.
    fn degapped(ds: &Dataset, row: usize) -> Vec<u8> {
        ds.alignment.rows[row]
            .gapped
            .iter()
            .copied()
            .filter(|&b| !align_core::coords::is_gap(b))
            .collect()
    }

    #[test]
    fn block_window_seqs_extracts_windowed_ungapped_residues() {
        // Only the residues inside the column window, gaps dropped — the whole
        // point of block align (not the whole row).
        let ds = Dataset::from_records(&[rec("a", "A-CGT"), rec("b", "AG--T")]);
        // cols 1..=3: row a "-CG" ⇒ "CG"; row b "G--" ⇒ "G".
        assert_eq!(
            block_window_seqs(&ds, &[0, 1], 1, 3),
            vec![b"CG".to_vec(), b"G".to_vec()]
        );
    }

    #[test]
    fn block_align_fit_dropin_when_block_equals_window() {
        // wblock == worig ⇒ a width-preserving SetCells drop-in over [c0,c1]; only
        // the selected rows' window changes, other rows + out-of-window cells stay.
        let mut ds =
            Dataset::from_records(&[rec("a", "ACGTA"), rec("b", "AC-TA"), rec("c", "GGGGG")]);
        let mut history = align_core::EditStack::new();
        // Rows 0,1, window cols 1..=3 (worig 3). Window residues: a "CGT", b "CT".
        let aligned = vec![b"CGT".to_vec(), b"-CT".to_vec()];
        let cmd = placement_cmd(block_align_cmd(&ds, &[0, 1], 1, 3, &aligned, false));
        assert!(matches!(cmd, EditCmd::SetCells { .. }));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 5); // preserved
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGTA");
        assert_eq!(ds.alignment.rows[1].gapped, b"A-CTA");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGGG"); // untouched
                                                           // Lossless: degapped residues unchanged for every row.
        assert_eq!(degapped(&ds, 0), b"ACGTA");
        assert_eq!(degapped(&ds, 1), b"ACTA");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.rows[1].gapped, b"AC-TA");
    }

    #[test]
    fn block_align_fit_gap_pads_when_block_narrower() {
        // wblock < worig ⇒ left-justify + gap-pad the window tail to worig (still a
        // width-preserving SetCells). Both rows' single residue "C" lands at c0.
        let mut ds = Dataset::from_records(&[rec("a", "A-C-T"), rec("b", "A--CT")]);
        let mut history = align_core::EditStack::new();
        // Rows 0,1, window cols 1..=3 (worig 3). Residues: a "C", b "C" ⇒ wblock 1.
        let aligned = vec![b"C".to_vec(), b"C".to_vec()];
        let cmd = placement_cmd(block_align_cmd(&ds, &[0, 1], 1, 3, &aligned, false));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 5); // preserved
        assert_eq!(ds.alignment.rows[0].gapped, b"AC--T");
        assert_eq!(ds.alignment.rows[1].gapped, b"AC--T");
        assert_eq!(degapped(&ds, 0), b"ACT");
        assert_eq!(degapped(&ds, 1), b"ACT");
    }

    #[test]
    fn block_align_grow_inserts_columns_and_undo_restores() {
        // wblock > worig + Grow ⇒ SpliceRows: selected rows replace their window with
        // the wider block; the non-selected row gets a gap column at the block's right
        // edge. Every row grows by g=1 ⇒ still rectangular; undo restores width.
        let mut ds = Dataset::from_records(&[rec("a", "ACGT"), rec("b", "ATGC"), rec("c", "GGGG")]);
        let mut history = align_core::EditStack::new();
        // Rows 0,1, window cols 1..=2 (worig 2). Residues a "CG", b "TG".
        let aligned = vec![b"C-G".to_vec(), b"T-G".to_vec()]; // wblock 3, g 1
        let cmd = placement_cmd(block_align_cmd(&ds, &[0, 1], 1, 2, &aligned, true));
        assert!(matches!(cmd, EditCmd::SpliceRows { .. }));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 5); // grew by g=1
        assert_eq!(ds.alignment.rows[0].gapped, b"AC-GT");
        assert_eq!(ds.alignment.rows[1].gapped, b"AT-GC");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGG-G"); // gap inserted at c1+1
                                                           // Every row is width 5 (rectangular) and residues are unchanged.
        for r in 0..3 {
            assert_eq!(ds.alignment.rows[r].gapped.len(), 5);
        }
        assert_eq!(degapped(&ds, 0), b"ACGT");
        assert_eq!(degapped(&ds, 1), b"ATGC");
        assert_eq!(degapped(&ds, 2), b"GGGG");
        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"ACGT");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGGG");
    }

    #[test]
    fn block_align_grow_at_right_edge_inserts_at_row_end() {
        // Right-edge window (c1 == width-1): the non-selected row's gap column is
        // inserted at col == width (an append). Must not panic / go out of bounds.
        let mut ds = Dataset::from_records(&[rec("a", "ACG"), rec("b", "ATG"), rec("c", "GGG")]);
        let mut history = align_core::EditStack::new();
        // Rows 0,1, window cols 1..=2 (c1 == 2 == width-1, worig 2). Residues a "CG", b "TG".
        let aligned = vec![b"C-G".to_vec(), b"T-G".to_vec()]; // wblock 3, g 1, insert_col == 3 == width
        let cmd = placement_cmd(block_align_cmd(&ds, &[0, 1], 1, 2, &aligned, true));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 4);
        assert_eq!(ds.alignment.rows[0].gapped, b"AC-G");
        assert_eq!(ds.alignment.rows[1].gapped, b"AT-G");
        assert_eq!(ds.alignment.rows[2].gapped, b"GGG-"); // appended at the end
    }

    #[test]
    fn block_align_fit_all_rows_preserves_width_no_shrink() {
        // Cols-mode (every row selected) + Fit gap-pads to worig — it does NOT shrink
        // the matrix the way whole-row msa_align's all-selected path does. This pins
        // the intentional divergence (Fit is width-preserving by definition).
        let mut ds = Dataset::from_records(&[rec("a", "AC-GT"), rec("b", "AT-GT")]);
        let mut history = align_core::EditStack::new();
        // All rows [0,1], window cols 1..=3 (worig 3). Residues a "CG", b "TG" ⇒ wblock 2.
        let aligned = vec![b"CG".to_vec(), b"TG".to_vec()];
        let cmd = placement_cmd(block_align_cmd(&ds, &[0, 1], 1, 3, &aligned, false));
        history.apply(&mut ds, cmd).unwrap();
        assert_eq!(ds.alignment.width, 5); // NOT shrunk to 4
        assert_eq!(ds.alignment.rows[0].gapped, b"ACG-T");
        assert_eq!(ds.alignment.rows[1].gapped, b"ATG-T");
    }

    #[test]
    fn block_align_seam_real_aligner_is_lossless() {
        // The one test that drives the REAL seam end-to-end — window extraction →
        // actual `pairwise` → `block_align_cmd` → apply — not a hand-crafted block.
        // This is what proves extraction + dispatch + reconcile compose correctly;
        // the other tests pin the reconcile branches with synthetic input. Assert
        // losslessness against the real aligner's output (whatever gaps it chooses).
        let mut ds = Dataset::from_records(&[rec("a", "AC-GTA"), rec("b", "A-C-TA")]);
        let mut history = align_core::EditStack::new();
        let before0 = degapped(&ds, 0);
        let before1 = degapped(&ds, 1);

        // Sub-column window cols 1..=4 (worig 4). Row a window "C-GT" ⇒ "CGT",
        // row b window "-C-T" ⇒ "CT" — different lengths, so the aligner must gap.
        let (c0, c1) = (1, 4);
        let worig = c1 - c0 + 1;
        let seqs = block_window_seqs(&ds, &[0, 1], c0, c1);
        assert_eq!(seqs, vec![b"CGT".to_vec(), b"CT".to_vec()]);

        let alphabet = dataset_alphabet(&ds);
        let matrix = SubstitutionMatrix::default_for(alphabet);
        let scoring = Scoring::default_for(alphabet);
        let r = pairwise(&seqs[0], &seqs[1], &matrix, AlignMode::Global, scoring);
        assert!(
            r.aligned_a.len() <= worig,
            "widen the fixture if the block overflows"
        );

        let cmd = placement_cmd(block_align_cmd(
            &ds,
            &[0, 1],
            c0,
            worig,
            &[r.aligned_a, r.aligned_b],
            false,
        ));
        history.apply(&mut ds, cmd).unwrap();

        // Lossless: every row's ungapped residues are byte-identical to before.
        assert_eq!(degapped(&ds, 0), before0);
        assert_eq!(degapped(&ds, 1), before1);
        // Out-of-window cells (col 0 and col 5) are untouched; width preserved (Fit).
        assert_eq!(ds.alignment.width, 6);
        assert_eq!(ds.alignment.rows[0].gapped[0], b'A');
        assert_eq!(ds.alignment.rows[0].gapped[5], b'A');
        assert_eq!(ds.alignment.rows[1].gapped[0], b'A');
        assert_eq!(ds.alignment.rows[1].gapped[5], b'A');

        history.undo(&mut ds).unwrap();
        assert_eq!(ds.alignment.rows[0].gapped, b"AC-GTA");
        assert_eq!(ds.alignment.rows[1].gapped, b"A-C-TA");
    }

    #[test]
    fn block_align_fit_overflow_makes_no_edit() {
        // wblock > worig + Fit ⇒ Overflow(g), no edit. The command turns this into a
        // "needs N more cols" message; here we pin the reconcile decision + count.
        let ds = Dataset::from_records(&[rec("a", "AC"), rec("b", "GT"), rec("c", "TT")]);
        // Rows 0,1, window cols 0..=1 (worig 2), a wider block ⇒ overflow by 1.
        let aligned = vec![b"A-C".to_vec(), b"G-T".to_vec()]; // wblock 3
        match block_align_cmd(&ds, &[0, 1], 0, 2, &aligned, false) {
            BlockPlacement::Overflow(by) => assert_eq!(by, 1),
            _ => panic!("expected a Fit overflow"),
        }
    }
}
