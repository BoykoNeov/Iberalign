# DNA/RNA ↔ Protein view + translation — tasks

Checklist companion to `dna-protein-view-plan.md`.

## Phase 1 — engine + CLI — DONE ✓
- [x] `align-core::translate` (`GeneticCode`, `TranslateMode`, `translate`) + tests
- [x] `align-cli translate` subcommand

## Phase 2 — `translate_block` IPC seam — DONE ✓
- [x] `translate_block_rows` pure helper + `translate_block` command + DTO
- [x] `src/ipc/translate.ts` wrapper; registered in `lib.rs`; 6 iberalign tests

## Phase 3 — selection → translate + read-only modal — DONE ✓ (GUI smoke PENDING)
- [x] `Translate` menu (action + Gap-mode Degap|Codon submenu) in `MenuBar.tsx`
- [x] `Grid.tsx` state/refs/handlers + `doTranslate` (mount effect, bridged via ref)
- [x] Selection-scoped: pass the selection's `[c0, c1]` (NOT whole-row like `doAlign`)
- [x] Alphabet gate `canTranslate = alphabet !== "Protein"` (command is permissive)
- [x] Edge cases: no selection warns; <3-col window (width 0) messaged explicitly
- [x] `TranslateDialog.tsx` + `.css` (read-only monospace rows, drag/Esc/backdrop/Done)
- [x] `translateOpenRef` keydown guard; `[view]` effect closes modal on load
- [x] `TranslateDialog.dom.test.tsx` (7 tests); typecheck + build + 349 vitest green
- [ ] **GUI smoke** (user): DNA/RNA file → select rows × columns → Translate menu →
      Degap vs Codon differ on a gapped row; Protein file greys the action; <3-col
      selection warns; no-selection warns; modal drags + closes
- [ ] Commit + push

## Deferred follow-ups (Phase 3 kept thin — noted, not started)
- [ ] Copy the translated block from the modal (raw / FASTA) — needs a copy affordance
- [ ] Live Degap⇄Codon toggle INSIDE the modal (re-translate without reopening)

## Phase 4 — real switchable protein view — PENDING
- [ ] The "protein subwindow" / view toggle (replaces the modal) + protein-palette coloring
- [ ] (Q1=A graduation candidate) Rust-owned editable/alignable protein `Alignment`

## Phase 5 — genetic-code picker — PENDING
- [ ] Code-table chooser dialog (default table 1 until then; `GeneticCode` already holds a
      full 64-codon table so more tables are data, not code)
