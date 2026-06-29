# M3 — Pairwise alignment (context / key files)

Companion to `m3-plan.md` (design + decisions) and `m3-tasks.md` (checklist).
Key files and their current state, from the Phase-0 code map.

## Engine — `crates/align-core`
- `src/align.rs` — the stub to implement. `AlignMode {Global, Local}`,
  `Scoring` (currently `{match_score, mismatch, gap_open:-10, gap_extend:-1}` —
  **refactor to gap-only**), `PairwiseResult {aligned_a, aligned_b, score,
  percent_identity, length}`, `pairwise(...) -> todo!("M3: …")`. Dead code today
  (nothing calls it) → implementing it cannot break CI until wired.
- `src/matrix.rs` — **new**. `SubstitutionMatrix`.
- `src/model.rs` — `Alphabet {Dna, Rna, Protein}` (`infer()` heuristic);
  `Sequence { residues: Vec<u8> /* ungapped, case-preserved */ }`;
  `AlignedRow { gapped: Vec<u8>, lazy col_to_pos/pos_to_col }`;
  `Alignment { width, rows }`; `Dataset { alignment, sequences }`.
- `src/coords.rs` — `is_gap(b)` (`-` and `.`), `col_to_seq_pos`, `seq_pos_to_col`,
  `residue_count`. Works on any gapped row — pairwise results inherit it once in
  the dataset.
- `src/edit.rs` — `EditCmd`: `SetCells` / `SpliceRows` / `InsertRows` /
  `DeleteRows` / `Batch` implemented (reversible, atomic). The in-place realign
  composes `Batch[SpliceRows…]` (no new variant). `RowSplice` / `RowData` are
  re-exported from `lib.rs`.
- `src/lib.rs` — add `pub mod matrix;`; re-export the new public types; update the
  milestone comment (M3 align → implemented).

## CLI — `crates/align-cli/src/main.rs`
- `match args.first()` dispatch (`summary` / `composition` / `generate`). Add an
  `align` arm. `summary` is the worked example of read-file → call core → print.

## Tauri — `src-tauri`
- `src/commands.rs` — `#[tauri::command] async fn(…, state: State<Mutex<AppState>>)
  -> Result<Dto, String>`. Lock + split-borrow `&mut *guard` to touch `dataset`
  and `history` together (see `clear_cells`, `cut_shorten`). Edit commands build a
  `Vec<CellWrite>`/splices then `history.apply(ds, cmd)`. Width/row-count changing
  edits return via the resync path. Add `pairwise_align` + `PairwiseResultDto`.
- `src/state.rs` — `AppState { dataset: Option<Dataset>, history: EditStack }`.
- `src/lib.rs` — `tauri::generate_handler![…]` registration list. Add
  `commands::pairwise_align`.

## Frontend — `src`
- `src/ipc/commands.ts` — public camelCase type + snake_case `*Wire` type +
  `fromWire`; `invoke<T>(name, args)`. `getRenderBuffer()` returns raw
  `ArrayBuffer`. Add `pairwiseAlign(...)`.
- `src/ipc/edit.ts` — `editBuffer(cmd, args)` returns bytes; the resync helpers
  (`getAlignmentMeta` + `getRenderBuffer` → `replaceAll`) used by row-count
  -changing paste/undo are the template for the realign resync.
- `src/model/view.ts` — `AlignmentView { buffer, meta }`; `replaceAll` /
  `resizeContents` swap the buffer in place (scroll + selection survive).
- `src/ui/Grid.tsx` — owns `Canvas2DRenderer` + `GridStore` + the rAF loop;
  selection state lives here. Reads selected rows for the "Align selected" guard.
- `src/ui/MenuBar.tsx` — the shell; add the "Align selected" entry + enable/disable
  by selection size.
- Status readout — the Toolbar/MenuBar message area shows `score · %id · length`.

## Watch-outs
- Align the **ungapped** residues (`sequences[row].residues`), not the gapped row.
- Width never shrinks below the other rows' width: `W = max(current_width,
  aligned_len)`; realigned rows pad to `W`, others trailing-pad if widened.
- Subset-of-larger-alignment realign is a *local* realign — the pair's gaps don't
  correspond to the global columns. Correct for "align these two"; noted for users.
- `i32::MIN/2` sentinel; deterministic `max` tie order; %-identity denominator
  pinned (matches / alignment length).
