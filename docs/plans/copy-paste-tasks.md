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

## Batch B — Edit foundation (NEXT)

- [ ] **B1** `edit.rs::apply → EditOutcome{inverse, changed_rows}` + undo/redo stack
      in `AppState`; first concrete cmd `SetCells` (overwrite) + tests (apply/inverse
      round-trip, width preserved, caches invalidated).
- [ ] **B2** IPC `apply_edit`/`undo`/`redo`; changed-rows render-buffer patch on the
      frontend (`AlignmentView` + `markDirty`); `Ctrl+Z`/`Ctrl+Y` in `Grid`.

## Batch C — Paste

- [ ] **C1** Paste overwrite (clipboard read perm + `readText`; parse; `SetCells`).
- [ ] **C2** Paste insert, shift-only-pasted-rows (default) — `InsertBlock`.
- [ ] **C3** Paste insert, shift-all toggle.
- [ ] **C4** FASTA auto-detect; alphabet warn; size-guard; multi-row geometry;
      Insert|Overwrite + shift-mode toggle buttons in the toolbar.

## Batch D — Cut

- [ ] **D1** Cut → mask-to-gaps.
- [ ] **D2** Cut → shorten (`DeleteBlock`).
- [ ] **D3** Cut toggle button.

## Open question

- [ ] **Cut default** — mask-to-gaps (recommended, safe/shape-preserving) vs shorten
      (symmetric with the local paste default). One-line flip; decide before D1.
