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

## Phase C — IPC + reversible edit (`src-tauri` + `src/ipc`)
- [ ] `commands.rs`: `pairwise_align(row_a, row_b, mode, matrix, gap_open, gap_extend)` —
      read ungapped residues, run `pairwise`, apply `Batch[SpliceRows…]` (replace 2 rows +
      widen all to `W=max(width,len)`), return `PairwiseResultDto{score,percent_identity,length}`
- [ ] `lib.rs`: register `commands::pairwise_align`
- [ ] `src/ipc/commands.ts`: `pairwiseAlign(...)` wrapper + `PairwiseResult` TS type + `fromWire`
- [ ] frontend resync after the edit (meta + buffer → `replaceAll`); undo/redo round-trips
- [ ] typecheck + build green

## Phase D — UI (`src/ui`; needs GUI smoke)
- [ ] "Align selected" MenuBar entry; enabled iff exactly 2 distinct rows selected;
      else disabled with reason ("select 2 sequences" / "3+ requires MAFFT")
- [ ] mode Global (default)/Local; matrix auto by alphabet (protein BLOSUM62); sensible
      gap defaults — click-through MVP, options affordance can follow
- [ ] run → resync buffer → show `score · %id · length` in the status bar; `Ctrl/⌘+Z` restores
- [ ] typecheck + vitest + build green
- [ ] **GUI smoke**: select 2 rows → Align (global + local) → rows replaced, readout shows;
      undo restores; 3+ selection disables with the MAFFT note; protein vs DNA pick the right
      default matrix
- [ ] advisor review + commit + push + update memory/CLAUDE.md after smoke

## Notes
- Align the **ungapped** residues, not the gapped rows.
- Subset realign is a *local* realign (pair gaps independent of global columns) — by design.
- MAFFT (M6) is the agreed next batch; "Align selected" extends to any N there.
