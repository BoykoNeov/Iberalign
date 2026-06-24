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
