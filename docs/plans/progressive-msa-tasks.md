# Progressive MSA — task checklist

Companion to `progressive-msa-plan.md` + `-context.md`. Pure-Rust progressive
aligner, in-process (no shell), surfaced as "Align selected sequences" for N≥2.

## Phase A — engine (`align-core::msa`; pure, CI-covered, no smoke)
- [ ] `msa.rs`: distance matrix — all-pairs global `pairwise`, `d = 1 − %id/100`,
      symmetric; small `DistMatrix` helper
- [ ] `msa.rs`: UPGMA guide tree from the distance matrix; deterministic tie-break
      (smallest index pair); rooted; yields a leaves→root merge order
- [ ] `msa.rs`: `Profile` — equal-width gapped rows + per-column residue frequency
      counts; each leaf carries its original input index
- [ ] `msa.rs`: profile–profile 3-state Gotoh DP over columns (M>X>Y ties, affine
      column gaps, sum-of-pairs column score normalized by non-gap pair count);
      inserting a gap column gaps every row of one profile
- [ ] `msa.rs`: `progressive_align(seqs, &matrix, scoring) -> MsaResult{rows,length}`
      — merge leaves→root, emit rows in INPUT order; N=0 empty, N=1 unchanged
- [ ] `lib.rs`: `pub mod msa;` + re-exports; milestone comment; `align.rs` module
      doc updated (pairwise here / progressive in `msa.rs`)
- [ ] tests: residue-fidelity proptest (`degap(out[i])==in[i]`); equal width;
      input-order preserved; N=0/N=1; one-empty; all-identical (no internal gaps);
      profile-of-one×profile-of-one == `pairwise` global; hand-worked 3-seq;
      UPGMA known-matrix topology; determinism (byte-identical)
- [ ] `cargo test --workspace` + clippy + fmt green

## Phase B — CLI (`align-cli`; CI path)
- [ ] `main.rs`: `msa <file.fasta> [--matrix NAME] [--gap-open N] [--gap-extend N]`
      → parse all records, `progressive_align` over ungapped residues, print
      aligned FASTA; alphabet = `widen` over all records; usage line
- [ ] CLI smoke test against a fixture (rows equal width, round-trip to inputs)

## Phase C — IPC + edit (`src-tauri` + `src/ipc`)
- [ ] `commands.rs`: `msa_splice(ds, rows: &[usize], aligned: &[Vec<u8>]) -> EditCmd`
      (generalize `realign_splice`; `target` = `w` when rows==all else `max(w,cur)`)
- [ ] `commands.rs`: `msa_align(rows, matrix?, gap_open?, gap_extend?)` — degap
      selected rows, `progressive_align`, apply `msa_splice` via `history.apply`;
      skip when `length==0`; `MsaResultDto{num_seqs,length}`
- [ ] `msa_splice` unit tests (shrink when all rows, widen others, undo round-trip)
- [ ] `lib.rs`: register `commands::msa_align`
- [ ] `src/ipc/edit.ts`: `msaAlign(...)` wrapper + `MsaResult`/`*Wire`/`fromWire`
- [ ] cargo test workspace + clippy + fmt + typecheck green

## Phase D — UI (`src/ui`) + GUI smoke
- [ ] `Grid.tsx` `doAlign`: 3+ rows ⇒ `msaAlign(rows)` (replace the MAFFT warn);
      2 rows ⇒ `pairwiseAlign` unchanged; readout `N sequences · length L`;
      reuse `runEdit` + `getRenderBuffer` resync; undo/redo ride existing route
- [ ] `MenuBar.tsx`: drop the "needs MAFFT" deferral copy; item stays "Align
      selected sequences", `canAlign = rows>=2`
- [ ] typecheck + vitest + build green
- [ ] **GUI smoke**: select 3+ rows → Align → rows replaced by the MSA, readout
      shows count/length; `Ctrl/⌘+Z` restores; 2 rows still pairwise; protein vs
      DNA pick the right default matrix; a column-subset selection still aligns the
      whole rows (column extent ignored, as pairwise)
- [ ] update CLAUDE.md (invariant override: in-process progressive MSA) + memory;
      commit per phase; push

## Deferred (separate batches)
- [ ] Bundle permissive external aligners in-process (MEGA model — POA/`spoa`…)
- [ ] NJ guide tree · iterative refinement · position-specific gaps · Kimura dist
- [ ] Sub-area/block align (overflow policy) — now a sub-function of MSA
- [ ] SVG/PNG figure export · Local as a non-destructive view
