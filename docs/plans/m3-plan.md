# M3 — Pairwise alignment (plan)

Hand-written **pairwise** alignment in `align-core`, surfaced as a reversible
"Align selected" action that re-aligns **exactly two** selected sequences in
place in the main grid. Multiple-sequence alignment (3+) is **out of scope** —
it is NP-hard and must shell out to MAFFT (milestone **M6**, the agreed next
batch); a 3+ selection disables the action with a "requires MAFFT" note.

Spec: §5 "Pairwise alignment", §12 "M3". Decisions below were taken with the
advisor and confirmed by the user (2026-06-29).

## Session-end status (2026-06-29)

- **Phases A–C committed** (`85b2252` engine + CLI, `b5d5305` IPC command +
  wrapper) — CI-green, no smoke needed.
- **Phase D (UI) is GLOBAL-ONLY and code-complete + green** (typecheck / 295
  vitest / build), but its **GUI smoke is deferred to a future session** along
  with the broader feature below. The Local (Smith–Waterman) option was **removed
  from the in-place "Align selected"** at the user's request: in-place Local is
  *lossy* (it trims each row to the matched region, discarding residues), and the
  user does not want a lossy in-place edit. **The engine + CLI keep Local** — it
  returns later as a **non-destructive view / report**, never as an in-place edit.
- **Current Phase-D behavior** = "select two rows (any columns), align the two
  **whole ungapped sequences** Global, replace both rows in place, reversibly."
  The column extent of the selection is **ignored** (it aligns whole sequences,
  not the selected sub-block). Adjacent-only (one selection rectangle ⇒ the rows
  are contiguous). This is complete and useful as-is; the refinements below are
  future work.

## Deferred to a future session (design open)

The user wants, eventually, to **align any two-or-more sequences and any selected
area** (not just two whole adjacent rows). Two threads:

1. **Block / sub-area align** — when only *part* of some sequences is selected
   (a column range, not the whole row) and the alignment needs to insert gaps,
   what happens at the selection borders? Two variants:
   - **Variant 1 — grow past the borders:** insert gaps / columns as needed and
     let the result extend beyond the originally selected region.
   - **Variant 2 — align within the allocated space** only: no gap insertion past
     the selection; the result stays inside the selected columns.
   **User leans Variant 2**, but it "maybe should be choosable by the user." Both
   are decisions for the future session — not built now.
2. **Arbitrary N≥2 / non-adjacent selection** — today selection is one rectangle,
   so only contiguous rows pair. Multi-select (non-adjacent pairs) and N>2 (true
   MSA → MAFFT, M6) are future. The `align-core` engine is pairwise-only by design.

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

## UI (`src/ui`) — needs GUI smoke (DEFERRED to a future session)
- "Align selected" entry in the MenuBar (the **Align** menu): enabled only when
  **at least two rows** are selected; the handler reports the exact case
  (<2 ⇒ "select 2 sequences", 3+ ⇒ "needs MAFFT").
- **GLOBAL only** — no mode submenu. Local was removed (lossy in-place; see the
  status block). Matrix auto by alphabet (protein BLOSUM62, DNA/RNA match/mismatch
  2/−1) — command-side default, no UI override in the MVP.
- On run: call the command, resync the buffer (via `runEdit` → `getRenderBuffer`),
  show `score · %id · length` in the status bar; `Ctrl/⌘+Z` restores (one edit).

## Phasing
- **A** engine (matrix + Gotoh + tests) — CI-green, no smoke. ✅ committed `85b2252`.
- **B** CLI — CI-green. ✅ committed `85b2252`.
- **C** IPC command + reversible edit + frontend wrapper — typecheck/build green.
  ✅ committed `b5d5305`.
- **D** UI action + status readout (GLOBAL-only) — code-complete + green; **GUI
  smoke DEFERRED to a future session** (carry-over), together with the block/sub-
  area + N≥2 design above.
