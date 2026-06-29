# M3 — Pairwise alignment (plan)

Hand-written **pairwise** alignment in `align-core`, surfaced as a reversible
"Align selected" action that re-aligns **exactly two** selected sequences in
place in the main grid. Multiple-sequence alignment (3+) is **out of scope** —
it is NP-hard and must shell out to MAFFT (milestone **M6**, the agreed next
batch); a 3+ selection disables the action with a "requires MAFFT" note.

Spec: §5 "Pairwise alignment", §12 "M3". Decisions below were taken with the
advisor and confirmed by the user (2026-06-29).

## Locked decisions

1. **Hand-rolled Gotoh DP**, not a `rust-bio` wrap. CLAUDE.md states pairwise
   NW/SW (Gotoh affine) is *the* sanctioned hand-written algorithm, and §10
   wants tests vs hand-worked cases. The DP is hand-written; the **matrix
   numbers are data** validated against a reference (a wrong cell fails
   silently — still produces *an* alignment).
2. **BLOSUM62 + match/mismatch land first**; PAM250 / BLOSUM45 / BLOSUM80 are a
   fast-follow inside Phase A, so the pipeline is proven before the
   transcription surface quadruples.
3. **Result surfaces in the grid by in-place replace**, reversible. The two
   selected rows are replaced by their aligned form as **one undoable edit**;
   score / %-identity / length show in the status bar. (Not a read-only modal —
   spec says "viewable in the grid"; not "insert as new rows" — the user wants
   the selected sequences themselves aligned, no duplicates.)
4. **Exactly two** sequences now. 3+ → action disabled, "requires MAFFT (M6)".
5. **MAFFT (M6) is the next batch** after M3.

## Engine design (`align-core`)

### `matrix.rs` — `SubstitutionMatrix`
- Dense ASCII-indexed table `score(a, b) -> i32`; inputs uppercased on lookup
  (case-insensitive; soft-masking lowercase still scores like its uppercase).
- Constructors: `match_mismatch(m, mm)` (nucleotide; equal byte → m, else mm),
  `blosum62()` (first), then `pam250()` / `blosum45()` / `blosum80()`.
- Unknown symbols (not in a protein matrix) default to the matrix's `X` row /
  a defined fallback — documented, not silent.
- `default_matrix(alphabet)`: DNA/RNA → `match_mismatch(2, -1)`; Protein →
  `blosum62()`.
- **Validation tests** (the transcription guard): full symmetry
  `score(a,b)==score(b,a)`, plus spot-checks of known reference cells
  (e.g. BLOSUM62 W·W=11, C·C=9, A·A=4, A·R=−1).

### `align.rs` — Gotoh affine NW + SW
- **Refine the stub signature** (no callers yet): `Scoring` becomes gap-only
  `{ gap_open, gap_extend }` (`dna_default` -10/-1, `protein_default` -11/-1);
  substitution moves to the matrix. New signature:
  `pairwise(a, b, matrix: &SubstitutionMatrix, mode, scoring) -> PairwiseResult`.
- **Gap-cost convention:** a gap of length k costs `gap_open + (k−1)·gap_extend`
  (gap_open is the *first* position's cost).
- **3-state DP** (M / X=gap-in-b / Y=gap-in-a), O(nm) time+space.
  - Sentinel `NEG = i32::MIN / 2` (NOT `i32::MIN` — `sentinel + gap_extend`
    overflows).
  - **Global init:** `M[0][0]=0`; `M[i][0]=M[0][j]=NEG`;
    `X[i][0]=gap_open+(i−1)·gap_extend`, `Y[0][j]` symmetric; cross terms NEG;
    final score = `max(M,X,Y)` at `(n,m)`.
  - **Local (SW):** `M` floored at 0, `M[*][0]=M[0][*]=0`; best = max `M` cell;
    traceback to the first `M==0`.
  - **Deterministic tie order** in every `max` (prefer M > X > Y), so
    hand-worked cases are reproducible. Output preserves input case.
- **%-identity** (pinned + documented): `100 · (identical non-gap columns) /
  (alignment length)`; length 0 → 0.0 (no div-by-zero).

### Tests (Phase A — pure, CI-covered, no GUI smoke)
- Hand-worked **global** and **local** cases (exact score + aligned strings).
- **Boundary/sentinel** cases the interior recurrence misses: a leading/trailing
  gap (`ACGT` vs `CGT` global), an **empty** sequence (n=0 → all gaps).
- **Multi-gap** case proving `gap_open+(k−1)·gap_extend` exactly (not just prose).
- Identity with gaps (denominator unambiguous).
- proptests: identical seqs → 100% id, no internal gaps; score symmetry
  `score(a,b)==score(b,a)`; local score ≤ global-bound where applicable.
- Matrix symmetry + reference-value spot checks.

## CLI (`align-cli`)
`align <fileA> <fileB> [--mode global|local] [--matrix blosum62|…]
[--gap-open N] [--gap-extend N]` → prints aligned pair + score + %id + length.
The headless CI path.

## IPC + edit (`src-tauri`)
- `pairwise_align(row_a, row_b, mode, matrix, gap_open, gap_extend)` async
  command. Reads the **ungapped** `dataset.sequences[row].residues` (Rust owns
  truth), runs `pairwise`, applies a reversible edit, returns a small
  `PairwiseResultDto { score, percent_identity, length }`.
- **Edit = compose tested primitives, no new `EditCmd` variant.** Replace the
  two rows' content + widen all rows to `W = max(width, aligned_len)` via a
  `Batch[SpliceRows…]` (the grow-to-fit paste already proved this shape). One
  undo step. Width changes → frontend does the established **full resync**
  (`getAlignmentMeta` + `getRenderBuffer` → `replaceAll`), as row-count/width
  -changing paste/undo already do.
- Register in `lib.rs`; `ipc` wrapper + camelCase TS types (`fromWire`).

## UI (`src/ui`) — needs GUI smoke
- "Align selected" entry in the MenuBar (an **Align** menu, or under Edit):
  enabled only when **exactly two distinct rows** are selected; otherwise
  disabled with a reason ("select 2 sequences" / "3+ requires MAFFT").
- MVP options: mode Global (default) / Local; matrix auto by alphabet (protein
  BLOSUM62 default). A small options affordance can follow; defaults click-through
  first.
- On run: call the command, resync the buffer, show `score · %id · length` in the
  status bar; `Ctrl/⌘+Z` restores (one edit).

## Phasing
- **A** engine (matrix + Gotoh + tests) — CI-green, no smoke.
- **B** CLI — CI-green.
- **C** IPC command + reversible edit + frontend wrapper — typecheck/build green.
- **D** UI action + status readout — GUI smoke, then commit + push + docs/memory.
