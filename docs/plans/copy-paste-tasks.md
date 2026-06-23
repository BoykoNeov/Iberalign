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

## Batch B — Edit foundation ✅ (code complete + green; **GUI smoke PASSED** 2026-06-23)

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
- [x] **GUI smoke (human, 2026-06-23):** select a rect → Delete (cells → gaps,
      repaint) → Ctrl+Z (restored) → Ctrl+Y (re-applied); scroll + selection survive;
      load a new file → undo stack cleared. **All PASSED.** Three follow-up fixes
      landed during the smoke (below) and were re-confirmed.

### B2 smoke fixes (2026-06-23)
- [x] **OOM on open-after-edit (FIXED).** Opening a 2nd large file right after an
      edit crashed the WebView2 renderer with "Error code: Out of Memory" (clean Rust
      terminal ⇒ renderer, not engine — confirmed by a throwaway headless repro that
      the pure engine survives the worst case). Cause: `App.tsx::showAlignment` held
      the old view's ~100MB *contiguous* buffer live while `getRenderBuffer` allocated
      the new one (+ the IPC transport copy) → contiguous-allocation failure. Fix:
      **null the view/summary BEFORE the fetch** so A's buffer is reclaimable before
      B's is allocated. User re-test: Ctrl+A→Delete *alone* on the 100MB fixture works
      (renderer survives the ~200MB edit transient), and the crash no longer
      reproduces ⇒ the trigger was open-path allocation churn, **not** the per-edit
      transport ⇒ no transport shrink needed. Consequence: a *failed* open now drops to
      the open screen rather than keeping A (Rust already swapped to B by then).
- [x] **Focus (FIXED).** `Delete`/`Ctrl+Z`/`Ctrl+Y`/`Ctrl+C`/nav now fire without the
      grid cell holding focus — `Grid` binds `onKeyDown` on `window` (was the grid
      cell), with a guard that bails when an editable field (`input`/`textarea`/
      `select`/`contenteditable`) is focused so real typing is never hijacked. The cell
      stays `tabIndex=0` + focused-on-click for a11y.
- [x] **Gap glyph (FIXED).** Gap cells render a `-` at the letter tier
      (`Canvas2DRenderer.ts` `GAP_GLYPH`) instead of a blank fill, so a gap reads as a
      gap and a deleted/masked cell visibly shows the dash.

### B2 design notes / known consequences
- **Delete = clear-to-gap (mask), Cut = remove + close up (shorten).** Delete is a
  *new user-facing key* (advisor #4) — spreadsheet-consistent with cut=shorten, but
  surfaced for veto.
- **Full-buffer transport** is fine at the design target; only heavy at the 10k×10k
  ceiling (the edit's ~200MB live transient survives; the *open-after-edit* peak was
  the crash, now fixed on the open path). Add a changed-rows patch later *only* if a
  profile shows width-preserving edits on big alignments are slow.
- **Undo memory:** the inverse stores the old bytes, so select-all-delete parks the
  whole old block per edit (ceiling consequence, not a target concern).

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
