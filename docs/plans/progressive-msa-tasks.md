# Progressive MSA — task checklist

Companion to `progressive-msa-plan.md` + `-context.md`. Pure-Rust progressive
aligner, in-process (no shell), surfaced as "Align selected sequences" for N≥2.

Status: **Phases A–D code complete + green; all phases COMMITTED; GUI smoke pending.**
Commits: `19fca13` (A/B engine+CLI), `39ee16c` (C IPC), `ed1af00` (D UI),
`5cf28d2` (3-seq quality anchor). Docs/memory closed out 2026-06-30 (this commit).

## Phase A — engine (`align-core::msa`; pure, CI-covered, no smoke) ✅ `19fca13`
- [x] `msa.rs`: distance matrix — all-pairs global `pairwise`, `d = 1 − %id/100`,
      `i<j` triangle mirrored
- [x] `msa.rs`: UPGMA guide tree, fused into the merge loop; deterministic
      tie-break (smallest index pair); leaves→root merge order
- [x] `msa.rs`: `Profile` — equal-width rows + per-column residue counts; each
      leaf carries its original input index
- [x] `msa.rs`: profile–profile 3-state Gotoh DP over columns (M>X>Y ties, affine
      column gaps, **integer** sum-of-pairs column score; `debug_assert` + guard on
      the divide); inserting a gap column gaps every row of one profile
- [x] `msa.rs`: `progressive_align(seqs, &matrix, scoring) -> MsaResult{rows,length}`
      — merge leaves→root, emit rows in INPUT order; N=0 empty, N=1 unchanged
- [x] `lib.rs`: `pub mod msa;` + re-exports; milestone comment; `align.rs` module
      doc updated; CLAUDE.md invariant updated (MSA in-process)
- [x] tests: keystone 1×1 byte-exact vs `pairwise`; fidelity + equal width;
      input-order; N=0/N=1; one-empty; all-identical; guide-tree grouping;
      determinism; fidelity + determinism proptests (9 unit + 2 proptest)
- [x] `cargo test --workspace` + clippy + fmt green

## Phase B — CLI (`align-cli`; CI path) ✅ `19fca13`
- [x] `main.rs`: `msa <file.fasta> [--matrix NAME] [--gap-open N] [--gap-extend N]`
      → all records, `progressive_align`, print aligned FASTA; alphabet widened
      over all records; usage line
- [x] CLI decision-path test (widen → default_for → equal-width fidelity); manual
      binary smoke vs `fixtures/sample.fasta` (3 seqs → width 12)

## Phase C — IPC + edit (`src-tauri` + `src/ipc`) ✅ `39ee16c`
- [x] `commands.rs`: `msa_splice(ds, rows, aligned)` — generalize `realign_splice`
      (`target` = `w` when rows==all else `max(w,cur)`)
- [x] `commands.rs`: `msa_align(rows, matrix?, gap_open?, gap_extend?)` — validate
      row list (in-bounds/sorted/dedup/≥2), widen alphabet over ALL rows, degap,
      `progressive_align`, apply `msa_splice`; skip when `length==0`;
      `MsaResultDto{num_seqs,length}`
- [x] `msa_splice` unit tests (shrink-when-all-selected, widen-others, undo)
- [x] `lib.rs`: register `commands::msa_align`
- [x] `src/ipc/edit.ts`: `msaAlign(...)` wrapper + `MsaResult`/`*Wire`
- [x] cargo test workspace + clippy + fmt + typecheck green (35 iberalign tests)

## Phase D — UI (`src/ui`) + GUI smoke
- [x] `Grid.tsx` `doAlign`: 3+ rows ⇒ `msaAlign(rowList)` (replaced the MAFFT warn);
      2 rows ⇒ `pairwiseAlign` unchanged; readout `N sequences · L cols`; reuse
      `runEdit` + `getRenderBuffer`; undo/redo ride existing route
- [x] `MenuBar.tsx`: Align item copy updated (2 ⇒ pairwise, 3+ ⇒ progressive MSA);
      `canAlign = rows>=2`; "needs MAFFT" copy removed
- [x] typecheck + 295 vitest + build green
- [ ] **GUI smoke**: select 3+ rows → Align → rows replaced by the MSA, readout
      shows count/cols; `Ctrl/⌘+Z` restores; 2 rows still pairwise; protein vs DNA
      pick the right default matrix; a column-subset selection still aligns the
      whole rows (column extent ignored); a selection incl. an all-gap row still
      aligns (others define width)
- [x] commit Phase D (`ed1af00`) + quality anchor (`5cf28d2`)
- [x] update CLAUDE.md milestone status + memory; commit + push docs (2026-06-30)

## Deferred (separate batches)
- [ ] Bundle permissive external aligners in-process (MEGA model — KAlign v3
      Apache-2.0; POA `poasta`/rust-bio/`spoa`) — see context appendix
- [ ] NJ guide tree · iterative refinement · position-specific gaps · Kimura dist
- [ ] Sub-area/block align (overflow policy) — now a sub-function of MSA
- [ ] SVG/PNG figure export · Local as a non-destructive view
