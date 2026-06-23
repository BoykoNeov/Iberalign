# Copy / Paste / Cut — Tasks

Companion to `copy-paste-plan.md` / `copy-paste-context.md`.

## Batch A — Copy ✅ (code complete + green; GUI smoke pending)

- [x] Clipboard plugin deps (npm + Cargo) + `lib.rs` init + `clipboard-manager:
      allow-write-text` capability (compile-time validated).
- [x] `model/copy.ts` — `buildCopyText` (Raw/FASTA, gaps kept) + `COPY_CELL_CAP`;
      `copy.test.ts` (raw/fasta/single-cell/full-width/missing-name).
- [x] `ipc/clipboard.ts` — `copyText` seam (write only).
- [x] `GridStore.setSelectionListener` + notify from the write paths; `store.test.ts`.
- [x] `ui/Toolbar.tsx` + CSS — Sel readout, Copy button, Raw|FASTA toggle, message.
- [x] `Grid.tsx` — copy state/refs, `doCopy` (+ size guard), `Ctrl/⌘+C`, selection
      mirror → `selInfo`, Toolbar render.
- [x] Verify: typecheck ✓, 152 vitest ✓, `npm run build` ✓, `cargo build -p
      iberalign` ✓, `cargo fmt --check` ✓.
- [ ] **GUI smoke (human):** `npm run tauri dev` → select a rect → Copy (and
      Ctrl/⌘+C) → paste into a text editor; check Raw vs FASTA, gaps kept, the Sel
      readout, the size-guard message on select-all of a big fixture.

## Batch B — Edit foundation ✅ (code complete + green; GUI smoke pending)

- [x] **B1** `edit.rs`: `apply → Result<EditOutcome{inverse, changed_rows}, EditError>`
      (atomic — validates all writes before mutating); first concrete cmd `SetCells`
      (in-place overwrite, inverse replays in reverse for overlaps); `EditStack`
      undo/redo history over a **`Dataset`** (`apply_to_dataset` wraps the matrix
      apply + **resyncs derived ungapped residues** for changed rows so undo is
      lossless on derived state); `AppState{dataset, history}`, history reset on load.
      12 align-core tests (round-trip, width preserved, atomicity, overlap inverse,
      undo/redo, redo-fork, residue resync).
- [x] **B2** IPC `clear_cells`/`undo_edit`/`redo_edit` returning the **full post-edit
      render buffer** as raw bytes (advisor #1 — dropped the hand-rolled changed-rows
      binary patch; C/D change width and rebuild anyway, so the patch was a B2-only
      orphan). Frontend `ipc/edit.ts` + `AlignmentView.replaceContents` (in-place copy,
      same buffer object ⇒ scroll + selection survive). `Grid`: **Delete/Backspace →
      clear-to-gap** (the first reversible edit; doubles as cut-mask), `Ctrl/⌘+Z` undo,
      `Ctrl/⌘+Shift+Z` / `Ctrl/⌘+Y` redo, all serialized via an `editingRef` in-flight
      guard. Empty buffer ⇒ no-op ⇒ skip repaint. 2 view tests + 1 commands test.
- [x] Verify: align-core 12 ✓ + clippy ✓; `cargo test -p iberalign` 5 ✓; typecheck ✓,
      154 vitest ✓, `npm run build` ✓, `cargo fmt --check` ✓.
- [ ] **GUI smoke (human):** select a rect → Delete (cells → gaps, repaint) → Ctrl+Z
      (restored) → Ctrl+Y (re-applied); confirm scroll + selection survive each edit;
      load a new file → undo stack is cleared.

### B2 design notes / known consequences
- **Delete = clear-to-gap (mask), Cut = remove + close up (shorten).** Delete is a
  *new user-facing key* (advisor #4) — spreadsheet-consistent with cut=shorten, but
  surfaced for veto.
- **Full-buffer transport** is fine at the design target; only sluggish at the
  10k×10k ceiling. Add a changed-rows patch later *only* if a profile shows
  width-preserving edits on big alignments are slow.
- **Undo memory:** the inverse stores the old bytes, so select-all-delete parks the
  whole old block per edit (ceiling consequence, not a target concern).
- **Focus:** `Ctrl+Z`/`Delete` (like `Ctrl+C`) only fire when the GRID is focused —
  after clicking a toolbar button, click back into the grid first.

## Batch C — Paste

- [ ] **C1** Paste overwrite (clipboard read perm + `readText`; parse; `SetCells`).
- [ ] **C2** Paste insert, shift-only-pasted-rows (default) — `InsertBlock`.
- [ ] **C3** Paste insert, shift-all toggle.
- [ ] **C4** FASTA auto-detect; alphabet warn; size-guard; multi-row geometry;
      Insert|Overwrite + shift-mode toggle buttons in the toolbar.

## Batch D — Cut

- [ ] **D1** Cut → mask-to-gaps.
- [ ] **D2** Cut → shorten (`DeleteBlock`).
- [ ] **D3** Cut toggle button. **Default = shorten** (user-decided 2026-06-23);
      mask-to-gaps is the toggle.

## Resolved

- [x] **Cut default = shorten** (user, 2026-06-23). Symmetric with the local paste
      default; mask-to-gaps becomes the toggle alternative.
