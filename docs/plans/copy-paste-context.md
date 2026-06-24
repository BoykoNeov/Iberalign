# Copy / Paste / Cut — Context (where things live)

Companion to `copy-paste-plan.md` / `copy-paste-tasks.md`.

## Batch A (copy) — files

**New**
- `src/model/copy.ts` — pure `buildCopyText(view, rect, format)` (Raw/FASTA,
  gaps kept) + `COPY_CELL_CAP` (10M cells). `src/model/copy.test.ts` covers it.
- `src/ipc/clipboard.ts` — `copyText(text)` over the plugin's `writeText`. The
  single clipboard seam (UI never imports the plugin directly). Write only.
- `src/ui/Toolbar.tsx` + `src/ui/Toolbar.css` — the top action strip:
  `Sel: C cols × R seqs` readout, Copy button (disabled when no selection),
  Raw|FASTA segmented toggle, ephemeral message. Presentational; all state in Grid.
  This is where the paste/cut toggles join (Batches C/D).

**Edited**
- `package.json` — `@tauri-apps/plugin-clipboard-manager`.
- `src-tauri/Cargo.toml` — `tauri-plugin-clipboard-manager` 2.3.2 (pulls arboard/
  image/clipboard-win transitively; first build ~2.5 min).
- `src-tauri/src/lib.rs` — `.plugin(tauri_plugin_clipboard_manager::init())`.
- `src-tauri/capabilities/default.json` — `clipboard-manager:allow-write-text`
  (write only; validated at compile time by `generate_context!`).
- `src/state/store.ts` — `setSelectionListener(cb)` + a `onSelectionChange`
  notify from the single write paths (`setSelection`, `clearSelection`, `setDims`).
  The coarse React-mirror hook the selection foundation reserved for exactly this.
  Tested in `store.test.ts`.
- `src/ui/Grid.tsx` — copy state (`copyFormat` + `copyFormatRef`, `selInfo`,
  `copyMsg`), `doCopy` (reads store/view/format via refs, `COPY_CELL_CAP` guard),
  `Ctrl/⌘+C` via the latest-callback `doCopyRef`, the selection listener →
  `selInfo` (throttled to size identity), and the `<Toolbar/>` render.

## Patterns reused (don't reinvent)

- **Coarse React mirror of store state** — the `hover`/`zoom` throttle idiom in
  `Grid` (a ref holds the last displayed identity; `setState` only on change). The
  selection mirror uses it keyed on `${cols}x${rows}`.
- **Latest-callback ref** — `doCopyRef.current = doCopy` each render; the
  once-bound keydown calls `doCopyRef.current()` (no stale closure, no re-bind).
- **Pure model + tested** — `selection.ts` `normalize`/`rectDims` give the
  copy/edit target rect; `copy.ts` is pure like `viewport.ts`/`selection.ts`.

## Batch B (edit foundation) — files

**New**
- `src/ipc/edit.ts` — `clearCells(rect)` / `undoEdit()` / `redoEdit()` over the
  three edit commands; each returns the post-edit render buffer (`Uint8Array`),
  empty ⇒ no-op. The editing seam (UI calls these, never `invoke` directly).
- `src/model/view.test.ts` — covers `AlignmentView.replaceContents`.

**Edited**
- `crates/align-core/src/edit.rs` — `CellWrite`, `EditError`, `apply` (atomic,
  `Result`), `SetCells` impl, `apply_to_dataset` (resync), `EditStack` (undo/redo
  over `Dataset`) + 12 tests. `lib.rs` re-exports the new types.
- `crates/align-core/src/model.rs` — *(unchanged)*; `Sequence.residues` is the
  derived cache `resync_residues` refreshes.
- `src-tauri/src/state.rs` — `AppState{dataset, history: EditStack}`.
- `src-tauri/src/commands.rs` — `clear_cells`/`undo_edit`/`redo_edit` (+ helpers
  `gap_fill_writes`, `edit_bytes`); `store()` resets history on load; +2 tests.
- `src-tauri/src/lib.rs` — registers the three edit commands. No new capability
  (custom app commands aren't gated by capabilities, unlike plugin perms).
- `src/model/view.ts` — `replaceContents(bytes)` (in-place, length-guarded).
- `src/ui/Grid.tsx` — `editingRef` in-flight guard; `runEdit(op)` (IPC → in-place
  patch → `markDirty`); Delete/Backspace + Ctrl/⌘+Z/Y/Shift+Z in `onKeyDown`.

**Edited (B2 GUI-smoke fixes, 2026-06-23)**
- `src/ui/App.tsx` — `showAlignment` nulls `view`/`summary` BEFORE fetching the next
  meta + render buffer, so the old ~100MB buffer is reclaimable before the new one is
  allocated → fixes the open-after-edit "Out of Memory" renderer crash at the ceiling.
- `src/ui/Grid.tsx` — `onKeyDown` now bound on `window` (was the grid cell) with an
  editable-target guard (`input`/`textarea`/`select`/`contenteditable` → bail), so the
  edit/nav keys fire regardless of which control was last clicked.
- `src/render/Canvas2DRenderer.ts` — `GAP_GLYPH` (`-`); the letter-tier blit draws it
  for any gap byte (was: skip gaps) so gaps/deleted cells show a dash, not a blank.

## Batch C1 (paste overwrite) — files

**New**
- `src/model/paste.ts` — pure `parseClipboard(text) → string[]`: split CRLF/LF, drop
  FASTA `>` headers (this app's FASTA copy is unwrapped — header-strip round-trips it),
  drop trailing blank lines, KEEP internal blanks (a blank line = "leave that row").
  `src/model/paste.test.ts` covers it. Wrapped external FASTA = C4.

**Edited**
- `src-tauri/capabilities/default.json` — add `clipboard-manager:allow-read-text`.
- `src/ipc/clipboard.ts` — `readClipboardText()` (`?? ""` so a non-text clipboard
  reads as empty; the read can still reject → caller wraps it).
- `src/ipc/edit.ts` — `pasteOverwrite(r0, c0, rows)` over the post-edit-buffer transport.
- `src-tauri/src/commands.rs` — `paste_overwrite` cmd + `paste_overwrite_writes(ds, r0,
  c0, rows)` helper (sibling of `gap_fill_writes`; clamps to bounds, width-preserving,
  reuses `EditCmd::SetCells`) + 3 tests. `src-tauri/src/lib.rs` registers it.
- `src/ui/Grid.tsx` — `runEdit` now returns `boolean`; effect-scoped `doPaste` (read +
  parse outside `runEdit`; guards no-selection / empty / denied; overflow → clip +
  message; expands the selection to the pasted block); `Ctrl/⌘+V`; `doPasteRef` +
  body `handlePaste`. `src/ui/Toolbar.tsx` — **Paste** button + `onPaste` prop.

**Semantics (C1):** anchor = selection top-left `(r0,c0)`; overflow → clip-to-fit +
advisory message (grow-to-fit needs the C2 width-change path); bytes verbatim (alphabet
warn = C4). Default mode is still overwrite here; the user's *insert* default arrives
with C2's toggle — so the human GUI smoke waits until after C2.

## Batch C2 (paste insert, shift-only) — files

The first WIDTH-CHANGING edit; reworks the edit transport.

**Engine (`crates/align-core`)**
- `edit.rs` — new `RowSplice { row, col, remove, bytes }` + `EditCmd::SpliceRows`
  (general splice primitive; symmetric inverse via per-splice old-byte capture, so it
  serves insert AND the future cut-shorten). `apply_splice_rows`: atomic bounds check,
  **`EditError::WidthMismatch`** real `Result` error for a ragged result (one-splice-per-
  row is a `debug_assert`), sets `aln.width` post-splice. 5 new tests. `lib.rs` re-exports
  `RowSplice`.

**Command (`src-tauri`)**
- `commands.rs` — `paste_insert(r0,c0,rows,shift_all)` cmd + `paste_insert_splices` helper
  (target rows: gap-padded line at c0; others: W gaps trailing (shift-only) / at c0
  (shift-all)). 3 tests (drop-past-end, shift-only buffer+undo, shift-all aligned).
  `lib.rs` registers it. No new capability.

**Frontend**
- `model/view.ts` — `buffer`/`meta` now mutable; **`resizeContents(bytes)`** replaces
  `replaceContents` (derives newWidth = len/numRows, reassigns on the same view object).
  `view.test.ts` rewritten (same-width / width-grow / not-a-whole-row throw).
- `state/selection.ts` — `clampSelection(sel, dims)` (used by updateDims on a shrink).
- `state/store.ts` — `updateDims(cols, rows)`: re-clamp viewport, KEEP scroll + selection
  (vs `setDims` which resets on load), clamp+notify the selection on a shrink.
- `ipc/edit.ts` — `pasteInsert(r0,c0,rows,shiftAll)`.
- `ui/Grid.tsx` — `runEdit` unified on `resizeContents` + `updateDims` (handles width-
  changing undo/redo for free) + `onResized` notify; `doPaste` → insert (shift-only),
  selects the inserted block, reports dropped overflow rows; `onResizedRef` + `onResized`
  prop. `ui/App.tsx` — passes `onResized` → `setSummary({...,width})` so the header
  follows (same `view` ref ⇒ no `[view]` re-fire). Toolbar Paste title → "inserting".

**Why SpliceRows-general (decision):** a dedicated `DeleteBlock` would need different
restore behavior as the inverse-of-insert vs as a primary cut; per-splice old-byte
capture collapses both into one symmetric primitive. **Why real `WidthMismatch` error:**
it guards genuine data corruption (a wrong `width` over differing-length rows), so it must
survive release builds — unlike the one-per-row guard, which is a pure caller-contract.

## Batch C5 (paste FASTA as new sequences + Insert|Overwrite toggle) — files

Two user asks, one batch (advisor-reviewed before building). The FIRST row-COUNT-changing
edit — so it reuses the LOAD path for transport, not a bespoke names+buffer channel.

**Engine (`crates/align-core`)**
- `edit.rs` — `RowData { id, name, description, gapped }`; `EditCmd::InsertRows { at, rows }`
  / `DeleteRows { at, count }` (Dataset-level — they add/remove both an `AlignedRow` and its
  derived `Sequence`). `apply_to_dataset` now DISPATCHES: structural commands → `insert_rows`
  / `delete_rows` (own the whole `Dataset`, NO matrix `apply` + NO residue-resync loop);
  matrix commands → the old `apply` + resync. Symmetric inverse (Insert↔Delete; delete
  captures rows verbatim so redo restores ids/names). `apply(&mut Alignment, …)` gets an
  `unreachable!` arm for the structural variants (routing guard). Width: new rows must equal
  the alignment width; an EMPTY alignment adopts the inserted width. 8 new tests. `lib.rs`
  re-exports `RowData`.

**Command (`src-tauri`)**
- `commands.rs` — `paste_sequences(at, text)` → `PasteSeqDto { inserted, truncated }` (JSON,
  NOT a buffer — the row count changed, so the frontend re-syncs via the load path). Helpers
  `paste_sequences_rows` (clamp/pad to width, count truncated, fresh ids via `next_seq_id`)
  + `next_seq_id`. **`paste_overwrite` rewritten** from clamp/truncate → **grow-to-fit**
  (`paste_overwrite_cmd`: `SetCells` when the block fits, `SpliceRows` when it runs past the
  right edge). 4 new/updated tests. `lib.rs` registers `paste_sequences`.

**Frontend**
- `model/view.ts` — `replaceAll(bytes, names)`: reassigns buffer + width + **numRows +
  names** on the SAME view object (row count from `names.length`, width derived against
  THAT). Distinct from `resizeContents` (numRows fixed). `view.test.ts` +4.
- `model/paste.ts` — `looksLikeFasta(text)` (first non-blank line starts `>`). `paste.test.ts`
  +2. NB **reconciles the old "FASTA ⇒ strip headers" note**: `parseClipboard` still strips
  `>` for the RAW path, but FASTA now ROUTES to `paste_sequences` (names kept) BEFORE
  `parseClipboard` runs — so a FASTA copy becomes new sequences, not column-spliced residues.
- `ipc/edit.ts` — `pasteSequences(at, text)` (JSON, not `editBuffer`); `pasteOverwrite` doc
  updated (grow-to-fit). `ipc/commands.ts` — reuses existing `getAlignmentMeta` /
  `getRenderBuffer` for the re-sync.
- `ui/Grid.tsx` — `pasteMode` state + ref (Insert|Overwrite, default Insert); `showMsg(text,
  tone)`; effect-scoped `applyResynced` (replaceAll + updateDims + repaint), `runResyncEdit`
  (undo/redo — **the landmine fix**: full meta+buffer re-sync since a generic undo/redo can
  flip the row count), `pasteFasta` (insert new seqs, select the block), `pasteRawBlock`
  (insert|overwrite via `runEdit`), `doPaste` (reads clipboard once, routes on
  `looksLikeFasta`). `ui/Toolbar.tsx` — `PasteMode` type + Insert|Overwrite toggle; `message`
  prop → `{text, tone}`. `ui/Toolbar.css` — `.toolbar-msg.warn` (bold red, light + dark).

**Transport decision:** a structural edit IS a load (new row set + names), so re-sync via
`get_alignment_meta` + `get_render_buffer` + `replaceAll` rather than inventing a combined
names+buffer transport. Matrix edits keep the fast buffer-only `runEdit` path. **The
landmine:** once any edit changes the row count, the generic `undo_edit`/`redo_edit` can flip
numRows — deriving `width = bytes.len/numRows` against a stale numRows silently corrupts the
render — so undo/redo MUST re-sync authoritative dims+names (verify in the GUI smoke).

**Deferred:** grow-to-fit for paste-as-sequences (today: clamp to width + warn on truncate);
alphabet-mismatch warning; the within-insert shift-all toggle (C3).

## Batch C4 (paste polish: alphabet warn + size-guard + grow-to-fit) — files

**Engine (`crates/align-core`)**
- `edit.rs` — new GENERAL primitive `EditCmd::Batch { commands: Vec<EditCmd> }` + `apply_batch`
  (dispatched in `apply_to_dataset`; matrix-only `apply` joins it to the `InsertRows/DeleteRows`
  `unreachable!` arm). Atomic compound edit: sub-commands run in order via `apply_to_dataset`
  (each does its own structural/matrix dispatch + residue resync); the batch inverse is the
  collected sub-inverses **reversed**; on any sub-command error the applied ones are rolled back
  (inverses replayed newest-first) so the dataset is untouched. The `changed_rows` union is only
  a non-empty marker (record + repaint) — each sub-command already resynced its own rows. 3 new
  tests (in-order + one-undo, rollback-on-error, grow-then-insert round-trip incl. redo).

**Command (`src-tauri`)**
- `commands.rs` — `paste_sequences` is now **grow-to-fit**. `paste_sequences_rows` (clamp-only)
  → `paste_sequences_cmd(ds, at, records) -> (EditCmd, truncated)`: GROW to the widest record
  (the result is a `Batch[SpliceRows(pad every existing row), InsertRows(wider rows)]` = one
  undo); plain `InsertRows` when records fit or the alignment is empty. `grow_target_width`
  isolates the grow / clamp / keep decision (testable with a small cap); `PASTE_GROW_CELL_CAP`
  (100M cells = the 10k×10k ceiling) is the **blow-up guard** — a sequence far wider than the
  alignment would pad EVERY existing row out to it (`num_rows × new_width`), so above the cap it
  falls back to clamp-to-width (the only `truncated > 0` case). `PasteSeqDto` doc updated; shape
  unchanged. New tests: `grow_target_width_picks_grow_clamp_or_keep`, `paste_sequences_cmd_*`
  (grows-and-undo / **interior-row grow at `at=1` undo+redo** / no-grow-when-fits /
  empty-alignment-adopts-widest / empty-records-noop).

**Frontend**
- `model/paste.ts` — `PASTE_TEXT_CAP` (10M chars, input) + `PASTE_RESULT_CELL_CAP` (100M cells,
  raw-block output) + `pasteAlphabetWarning(lines, alphabet)` (advisory; nucleotide alignments
  flag non-IUPAC-nucleotide LETTERS, Protein never warns; gaps / `*` / digits / case ignored;
  returns a `"N residues outside the X alphabet (e.g. …)"` string or null). `paste.test.ts` +6.
- `ipc/edit.ts` — `PasteSeqResult` + `pasteSequences` docs note grow-to-fit (`truncated` is the
  rare cap fallback now).
- `ui/Grid.tsx` — `doPaste`: **input size-guard** (refuse over `PASTE_TEXT_CAP`), then compute
  the **alphabet note** once over `parseClipboard(text)` and thread it into `pasteFasta` /
  `pasteRawBlock`; both append it to the result message (presence → tone `warn`). `pasteRawBlock`:
  an **output size-guard** (refuse when `numRows × (width + w) > PASTE_RESULT_CELL_CAP` — insert /
  grow-overwrite widen every row by `w`, the OOM vector `PASTE_TEXT_CAP` can't catch; advisor).
  `pasteFasta` captures `prevWidth` and adds an `"alignment widened to W"` info note when grow
  widened the alignment (mutually exclusive with the truncated note).

## Seams for Batches C–D (paste/cut, building on the B foundation)

- `crates/align-core/src/edit.rs` — `EditCmd` enum (variants: InsertGap, DeleteGap,
  SlideResidues, ReorderRows, RenameSeq, SetRowHidden, DeleteSeq), `RowSel`
  (One/Many/All), `EditOutcome{inverse, changed_rows}`. `apply()` is `todo!()` —
  B1 implements it + adds `SetCells` (overwrite) and later `InsertBlock`/`DeleteBlock`.
- `crates/align-core/src/model.rs` — `Alignment{width, rows}`, `AlignedRow{seq_id,
  gapped, …}`, `invalidate_index()` (per row) + `invalidate_caches()` (consensus/
  conservation). All edits keep rows equal-width and invalidate appropriately.
- `src-tauri/src/state.rs` — `AppState{dataset}`; the undo/redo stack lands here (B1).
- `src-tauri/src/commands.rs` — coarse commands → DTOs; add `apply_edit`/`undo`/
  `redo` here (B2). `get_render_buffer` returns raw bytes — the changed-rows patch
  path mirrors that transport.
- `src/ipc/commands.ts` — typed `invoke` wrappers (camelCase ⇄ snake_case). Add the
  edit/undo wrappers here.
- `src/model/view.ts` — `AlignmentView` is the frontend render-buffer copy; after
  an edit, patch its `buffer` from `changed_rows` (or rebuild) and `markDirty`.
- Clipboard READ — add `clipboard-manager:allow-read-text` + a `readText` wrapper
  in `ipc/clipboard.ts` only when paste-from-system-clipboard lands (Batch C).
