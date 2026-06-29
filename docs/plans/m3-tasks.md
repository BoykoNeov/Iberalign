# M3 — Pairwise alignment (task checklist)

Companion to `m3-plan.md` + `m3-context.md`. Tracks remaining work per phase.
Decisions locked 2026-06-29 (advisor + user): hand-rolled Gotoh; in-place
reversible replace of exactly 2 selected rows; 3+ → "requires MAFFT" (M6 next).

## Phase A — engine (`align-core`; pure, CI-covered, no GUI smoke) ✅ DONE
- [x] `matrix.rs`: `SubstitutionMatrix` — ASCII-indexed `score(a,b)` (uppercase on
      lookup); `match_mismatch(m,mm)`; `blosum62()`; `default_for(alphabet)`
- [x] matrix validation tests: full symmetry + reference spot-checks (W·W=11, C·C=9,
      A·A=4, A·R=−1, …) for all four matrices
- [x] `align.rs`: refactored `Scoring` → gap-only `{gap_open, gap_extend}` +
      `dna_default(-10,-1)` / `protein_default(-11,-1)` / `default_for`; new
      `pairwise(a,b,&matrix,mode,scoring)` signature
- [x] `align.rs`: Gotoh affine **NW (global)** — 3-state M/X/Y, `NEG=-1e9` sentinel,
      boundary init per plan, deterministic tie order (M>X>Y), traceback, case preserved
- [x] `align.rs`: Gotoh affine **SW (local)** — 0-floored M, max-cell traceback to `M==0`
- [x] `align.rs`: `percent_identity` = 100·(identical non-gap cols)/length; length 0 → 0
- [x] tests: hand-worked global + local (exact score + strings); leading-gap;
      empty-sequence (+ both-empty); multi-gap cost-convention; protein BLOSUM62
- [x] proptests: round-trip (degap recovers inputs); score symmetry; self-align perfect;
      local ≥ max(0, global)
- [x] fast-follow matrices: `pam250()` / `blosum45()` / `blosum80()` + their validation tests
- [x] `lib.rs`: `pub mod matrix;` + re-exports + milestone comment update
- [x] `cargo test --workspace` + clippy + fmt green (43 lib + 4 align proptest)

## Phase B — CLI (`align-cli`; CI path) ✅ DONE
- [x] `main.rs`: `align <fileA> <fileB> [--mode global|local] [--matrix …]
      [--gap-open N] [--gap-extend N]` → print aligned pair + score + %id + length
- [x] usage text; unknown-flag handling; `matrix_by_name` test; CLI smoke against fixtures
      (DNA global/local, protein auto-BLOSUM62, bad-matrix exits 1) — green

## Phase C — IPC + reversible edit (`src-tauri` + `src/ipc`) ✅ DONE
- [x] `matrix.rs`: shared `SubstitutionMatrix::by_name` (CLI + command resolve names one way)
- [x] `commands.rs`: `pairwise_align(row_a, row_b, mode, matrix?, gap_open?, gap_extend?)` —
      read ungapped residues, run `pairwise`, apply a single reversible `SpliceRows` via
      `realign_splice` (replace 2 rows padded to `target`; widen others when the pair is
      wider; `target=W` when only 2 rows so it can shrink). Returns
      `PairwiseResultDto{score,percent_identity,length}`
- [x] `realign_splice` unit tests: shrink-to-pair-width, widen-others, equal-width + undo round-trip
- [x] `lib.rs`: registered `commands::pairwise_align`
- [x] `src/ipc/edit.ts`: `pairwiseAlign(...)` wrapper + `PairwiseResult`/`PairwiseMode` types + fromWire
- [x] cargo test workspace + clippy + fmt + typecheck green (33 iberalign tests)
- [x] frontend resync after the edit (buffer → `resizeContents`); undo/redo round-trips — Phase D wiring

## Phase D — UI (`src/ui`; GLOBAL-only; code complete + green; GUI smoke PASSED 2026-06-29) ✅ DONE

**Global-only decision (2026-06-29, user):** in-place Local is lossy (trims rows
to the matched region) → the Local/Method option was **removed** from "Align
selected". The engine + CLI keep Local for a future non-destructive view.

- [x] New "Align" MenuBar menu: single "Align selected sequences" action (disabled when
      <2 rows selected). **No Method submenu** — Global only (`AlignMethod` type removed)
- [x] `Grid` wiring: `doAlign` (effect-scoped) reads the selection — 2 rows ⇒
      `pairwiseAlign(r0, r1, "global")`, <2 ⇒ "Select 2 sequences", 3+ ⇒ "needs MAFFT";
      `doAlignRef` bridge + `handleAlign`; `canAlign = selInfo.rows >= 2` gates the item.
      (`alignMode` state/ref + `handleSetAlignMode` removed with the submenu)
- [x] matrix/gaps auto by alphabet (command-side default; no UI override in the MVP)
- [x] reuse `runEdit` (op returns `getRenderBuffer`, score captured in a closure) → in-place
      resize; readout `score · %id · length` in the message area; undo/redo ride `undoEdit`/`redoEdit`
- [x] empty-edge guard: two all-gap rows ⇒ length 0 ⇒ command skips the edit, UI says
      "Nothing to align (both sequences are empty)"
- [x] typecheck + 295 vitest + build green
- [x] **GUI smoke PASSED (2026-06-29, user "all works")**: select 2 rows → Align → the two
      rows are replaced by the aligned pair, readout shows score/%id/length; `Ctrl/⌘+Z`
      restores; a 3+ selection shows the MAFFT note; <2 disables the item; protein vs DNA
      pick the right default matrix; re-align an already-aligned pair (residue resync);
      width-shrink case (2-row alignment narrower than before)
- [x] commit/push of D — `src/ui/{Grid,MenuBar}.tsx` + `commands.rs` empty-result guard

## Deferred to a future session (design open — user, 2026-06-29)
- [ ] **Block / sub-area align**: when only part of some sequences is selected and gaps must
      be inserted — **Variant 1** grow past the selection borders vs **Variant 2** align
      within the allocated space (no gap insertion). **User leans Variant 2; maybe
      user-choosable.** Today `doAlign` ignores the column extent and aligns whole rows.
- [ ] **Arbitrary N≥2 / non-adjacent**: selection is one rectangle (contiguous rows only);
      multi-select + N>2 (→ MAFFT, M6) are future.
- [ ] **Local as a non-destructive view/report** (the engine already supports it).

## Notes
- Align the **ungapped** residues, not the gapped rows.
- Subset realign is a *local* realign (pair gaps independent of global columns) — by design.
- MAFFT (M6) is the agreed next batch; "Align selected" extends to any N there.
