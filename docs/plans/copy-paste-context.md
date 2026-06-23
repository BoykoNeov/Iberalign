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

## Seams for Batches B–D (paste/cut, the edit foundation)

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
