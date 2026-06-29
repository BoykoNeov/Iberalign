# Progressive MSA (in-process) — plan

Our **own** pure-Rust multiple-sequence aligner in `align-core`, surfaced as the
existing **"Align selected sequences"** action extended to **N ≥ 2** rows. No
shelling out: the algorithm is compiled into the binary and called as a function
(the MEGA model — see "Direction" below). This **supersedes the old M6 plan**
(MAFFT/MUSCLE/Clustal via a sidecar/PATH subprocess), which the user has ruled
out: "I don't want shell integration for alignment at all."

Spec touchpoints: §5 (MSA), §12 (M6). **Invariant override:** CLAUDE.md says
"Don't write MSA heuristics — shell out." The user has deliberately reversed this
(2026-06-29). A *basic progressive* aligner is a finite, well-trodden heuristic
(not the NP-hard search for the optimal MSA), so it honors the spirit, but it
means **we own MSA correctness/quality from here on**. CLAUDE.md will be updated
when this lands.

## Direction (user, 2026-06-29)

- **First**, write our own progressive aligner (this batch).
- **Then**, like MEGA, also bundle the **maximum number** of *permissively
  licensed* external MSA algorithms, **linked in-process** (compiled-in C/C++ via
  FFI, called as a library — NOT a subprocess). That is a **future batch**; the
  research into which permissive libraries expose a linkable API (POA/`spoa`
  MIT, etc.) is captured in the context doc's appendix.

## Honest quality ceiling

"No shell" + "in-process" + "MAFFT-grade" cannot coexist — MAFFT-grade essentially
*requires MAFFT*. A from-scratch progressive aligner caps at **ClustalW-class**:
respectable on similar sequences, visibly below MAFFT on divergent sets, **no
iterative refinement** in v1. The user accepts this (MAFFT-grade not required).

## Algorithm (textbook progressive)

Three stages, the first reusing the existing pairwise engine, the third being the
genuinely new code (a Gotoh DP generalized from residues to profile columns).

1. **Distance matrix** — all-pairs global pairwise via the existing `pairwise(...)`.
   Distance `d(i,j) = 1 − percent_identity/100` (identity already defined as
   `matches / aligned_length`). **Compute the `i<j` triangle only and mirror
   `d(j,i)=d(i,j)`** — the pairwise *score* is symmetric (M3 proptest) but the
   *traceback* (hence length/%id) need not be under tie-breaking, so computing both
   directions independently could yield a non-symmetric matrix. `d(i,i)=0`. Kimura
   correction is a future refinement.
2. **Guide tree** — **UPGMA** (rooted, deterministic, gives a natural merge
   order). Ties (equal minimal distance) broken by smallest index pair, so runs
   are reproducible. **NJ is a documented quality follow-up** (better on divergent
   sets, but needs midpoint rooting); UPGMA first keeps v1 simple and fully
   testable.
3. **Profile–profile progressive merge** — walk the tree leaves→root. A **Profile**
   = a group of already-aligned, equal-width rows (each carrying its original input
   index). A leaf is a one-row profile (the ungapped sequence). Each internal node
   aligns its two child profiles with a **3-state Gotoh DP over columns** (the same
   M/X/Y structure as `align.rs`, tie order M>X>Y), where the cell substitution
   score is the **sum-of-pairs column score** and gaps are affine at the column
   level: opening/extending a gap **column** inserts a gap into *every* row of one
   profile. The root profile **is** the MSA.
   - **Column score** `s(colA, colB)` = **integer** sum-of-pairs over non-gap
     residue pairs `(x∈A, y∈B)` of `matrix.score(x,y)`, divided (integer division)
     by the pair count: `sum_pair_scores / pair_count`, both `i32`. Existing
     within-column gaps contribute no substitution term. **Everything stays `i32` —
     no floats, no `HashMap` accumulation:** float sums are non-associative, so any
     unordered residue iteration would make the output order-dependent and break the
     determinism test *intermittently*. Counts accumulate in a fixed `[i32; A]`
     array indexed by residue; the DP runs in `i32` exactly like `align.rs`. (Bonus:
     this makes the 1×1 cross-check **byte-exact** — divisor 1 ⇒ average == the raw
     score ⇒ identical recurrence/ties/traceback to `pairwise`.)
   - `debug_assert!(pair_count > 0)` before the divide, with a comment: safe today
     (every column of any merged profile has ≥1 non-gap residue, by induction from
     single-sequence leaves), but the deferred **block-align** could feed an all-gap
     sub-region — cheap insurance against a silent divide-by-zero on that path.
   - Per-column residue **frequency counts** are precomputed per profile so a
     column–column score is O(alphabet²), not O(rowsA·rowsB).

**We own row identity and residue fidelity** (unlike the deferred FFI/shell paths
that would consume foreign output): we only ever **insert gap columns** — residues
and case are never altered — and each leaf keeps its original index, so the output
maps back to input order by construction. No "trust only the gap pattern" dance.

## Engine API (`align-core/src/msa.rs`, new)

```rust
pub struct MsaResult {
    pub rows: Vec<Vec<u8>>, // gapped, equal width, in INPUT order
    pub length: usize,      // alignment width
}
pub fn progressive_align(
    seqs: &[&[u8]],                  // ungapped, case-preserved
    matrix: &SubstitutionMatrix,
    scoring: Scoring,
) -> MsaResult;
```

- `lib.rs`: `pub mod msa;` + re-export `progressive_align`, `MsaResult`.
- `align.rs` module doc ("MSA is intentionally *not* here…") updated: pairwise
  lives here, progressive MSA in `msa.rs`.
- N=0 → empty; N=1 → the single sequence unchanged (width = its len). Empty
  sequences and identical sequences handled (latter ⇒ no internal gaps).

## CLI (`align-cli`)

`msa <file.fasta> [--matrix NAME] [--gap-open N] [--gap-extend N]` → parse the
multi-record FASTA, run `progressive_align` over all records' ungapped residues,
print aligned FASTA (`>name` + gapped row). The headless CI path; mirrors the
`align` arm's flag parsing and `default_for(alphabet)` defaults (alphabet =
`widen` over all records).

## IPC + edit (`src-tauri`)

- `msa_align(rows: Vec<usize>, matrix?, gap_open?, gap_extend?)` async command —
  **validates the row list** (each `< num_rows`; sort + dedup; require ≥2 distinct,
  mirroring `pairwise_align`'s bounds checks). Defaults the matrix/scoring by
  **widening the alphabet over ALL selected rows** (not row[0]/the first two), so a
  protein set resolves to BLOSUM62. Reads the selected rows' **ungapped**
  `sequences[row].residues` (Rust owns truth), runs `progressive_align`, splices the
  aligned rows back in place via
  **`msa_splice`** = `realign_splice` generalized to N rows (replace each selected
  row padded to `target = max(w, cur)`; `target = w` when the selection *is* all
  rows so it can shrink; trailing-pad the others if `target > cur`). One
  `EditCmd::SpliceRows` ⇒ one undo step.
- DTO `MsaResultDto { num_seqs, length }`. Row count / names / alphabet unchanged
  (we align rows in place), so the caller re-syncs with the **fast** path
  (`get_render_buffer` only — same as pairwise), and undo/redo ride the existing
  width-changing route. Skip the edit when `length == 0` (all-gap inputs).
- Register in `lib.rs`; `ipc/edit.ts` `msaAlign(...)` wrapper + camelCase types.

## UI (`src/ui`) — needs GUI smoke

Extend `doAlign` in `Grid.tsx`:
- `< 2` rows ⇒ "Select 2+ sequences" (unchanged).
- **exactly 2** ⇒ `pairwiseAlign(r0, r1, "global")` (unchanged — keep the optimal,
  already-smoke-passed Gotoh path; profile-align of two singletons would match it,
  but no reason to risk a regression).
- **3+** ⇒ `msaAlign(rows)` (**replaces** the current "needs MAFFT" warn).
- Status readout: `N sequences · length L`. MenuBar item label stays "Align
  selected sequences"; its disabled/“needs MAFFT” copy is removed. `canAlign`
  stays `rows >= 2`.

## Tests

Engine (Phase A, pure, CI-covered, no smoke):
- **Residue fidelity (the critical invariant):** `degap(out[i]) == seqs[i]` for all
  i — proptested. We only insert gaps.
- All output rows equal width; output length == that width; input order preserved.
- N=1 (identity), N=0 (empty), one empty sequence among several, all-identical
  (⇒ no internal gaps).
- **Cross-check (keystone):** for **1×1** (two singleton profiles), the merge is
  **byte-exact** to `pairwise` global on the same two seqs — pins the DP
  generalization against the known-correct engine. For **multi-row** profiles assert
  only **score + degap-fidelity**, never byte-exact strings (two correct aligners
  produce different equal-scoring alignments).
- Hand-worked 3-sequence case (small, deterministic exact rows).
- UPGMA on a known distance matrix → known merge order/topology.
- Determinism: same input ⇒ byte-identical output (tie-breaks pinned).
- proptest: random small sets (DNA + protein) ⇒ fidelity + equal width.

CLI: `msa` over a fixture parses, all rows equal width, round-trips to inputs.

## Phasing (commit per phase, each green)

- **A — engine** (`msa.rs`: distance matrix, UPGMA, Profile + profile-profile
  Gotoh, `progressive_align`, tests/proptests). CI-green, no smoke.
- **B — CLI** (`msa` subcommand + usage + a fixture smoke). CI-green.
- **C — IPC** (`msa_align` + `msa_splice` + DTO + register + `ipc/edit.ts`
  wrapper). typecheck/build green.
- **D — UI** (`doAlign` 3+ branch + MenuBar copy + readout) + **GUI smoke**.

## Deferred (NOT this batch)

- **Bundle permissive external aligners in-process** (the MEGA direction — POA/
  `spoa`, etc.; see context appendix). Separate future batch.
- **NJ guide tree**, **iterative refinement**, **position-specific gap penalties**,
  Kimura distance — quality upgrades on the progressive core.
- **Sub-area / block align** (overflow policy: grow-past-borders vs reject) — the
  M3 carry-over; now a *sub-function* of MSA (extract block → degap → MSA → splice).
- **SVG/PNG figure export** (the other half of spec M6).
- **Local as a non-destructive view/report** (engine already supports it).

## Decided (advisor-confirmed 2026-06-29; not round-tripped — sensible defaults)

1. **UPGMA first, NJ later** — simpler, rooted, deterministic, fully testable;
   swappable for NJ later **without touching the profile-profile core** (the hard
   part). If divergent-set quality disappoints at smoke, the guide tree (UPGMA→NJ)
   is the first upgrade lever — *not* the profile DP.
2. **2 → pairwise, 3+ → progressive** — zero regression risk on the smoke-passed
   pairwise path (profile-of-two-singletons would match it anyway).
3. **Batch scope = the full A→D vertical slice** (engine + CLI + IPC + UI), like M3.
