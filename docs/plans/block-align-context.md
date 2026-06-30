# Block / sub-area align (context / key files)

Companion to `block-align-plan.md` (design + decisions) and `block-align-tasks.md`
(checklist). The code the future implementation session touches, with current
line anchors (as of 2026-06-30, `main`). Block align is **additive** — the
whole-row align path stays as-is.

## Engine — `crates/align-core`

- `src/align.rs` — `pairwise(a, b, &matrix, mode, scoring) -> PairwiseResult`
  (Gotoh global/local). Block align of 2 rows reuses it **unchanged** — the only
  difference is the *input* (windowed residues, not whole rows).
- `src/msa.rs` — `progressive_align(&[&[u8]], &matrix, scoring) -> MsaResult`
  (input order preserved; N=0/1 trivial; one-empty → all-gap row). Reused
  **unchanged** for 3+ block rows.
- `src/coords.rs` — `is_gap(b)` (`-`/`.`), `AlignedRow::col_to_seq_pos(col) ->
  Option<usize>` / `seq_pos_to_col(pos)` / `residue_count()`. Use `is_gap` to drop
  gaps when extracting the window; use `col_to_seq_pos` to *reason about* placement
  / losslessness. **Don't hand-slice bytes for the position mapping.**
- `src/edit.rs` — `EditCmd::{SetCells, SpliceRows, …}` (reversible, atomic). Block
  align needs **no new variant**: Fit = `SetCells`, Grow = `SpliceRows`.
- `src/model.rs` — `Dataset { alignment, sequences }`; `Alignment { width, rows }`;
  `Sequence { residues /* ungapped */ , alphabet }`. Block align must NOT change
  `sequences[*].residues` (losslessness invariant).

## Tauri — `src-tauri/src/commands.rs`

The whole-row align commands and their splice helpers are the templates:

- `realign_splice(ds, row_a, row_b, &aligned_a, &aligned_b) -> EditCmd` (line ~809)
  — the 2-row whole-row splice. **Grow** block align is this generalized to a
  column window: replace `[c0,c1]` in the 2/N selected rows; insert `g` gap cols at
  `c1+1` in the rest.
- `msa_splice(ds, rows, aligned) -> EditCmd` (line ~955) — the N-row generalization
  (`target = w` if all rows selected else `max(w, cur)`). The Grow block splice is
  the column-windowed sibling.
- `gap_fill_writes(r0,r1,c0,c1) -> Vec<CellWrite>` (line ~190) — per-row `SetCells`
  over a rect. **Fit** block align mirrors this: per selected row, one `CellWrite`
  at `col c0` with the aligned-then-gap-padded window bytes (length `worig`).
- `cut_shorten_writes(ds,…) -> Vec<CellWrite>` (line ~214) — the read-the-row
  variant of the above; documents the **clamp-`r1` / bail-on-stale-`r0`** guard so
  a direct row read can't panic. Block align reads rows too → copy that guard.
- `pairwise_align(...)` (line ~868) / `msa_align(...)` (line ~1004) — the whole-row
  commands. Add the block command(s) alongside; they share the lock +
  split-borrow `let AppState { dataset, history } = &mut *guard;` pattern and the
  `history.apply(ds, cmd)` apply. Return a small DTO (reuse `PairwiseResultDto` /
  `MsaResultDto`, or a `BlockAlignResultDto { num_seqs, length, grew }`).
- `src/lib.rs` — `tauri::generate_handler![…]` registration list; add the new
  command(s).

**New command shape (proposed):** one `block_align(rows, c0, c1, mode_or_engine,
grow: bool, …)` that extracts the window, dispatches pairwise vs MSA exactly like
`doAlign` does today, reconciles width, and returns whether it grew (or a
"would-need N more cols" refusal for Fit-overflow → surface as an `Err(String)` or
a `grew:false, fit_overflow:N` field the UI turns into the message).

## Frontend — `src`

- `src/ui/Grid.tsx` — `doAlign` (line ~1006) is the branch point. Add: read the
  selection's `c0,c1`; if full-width → existing path (unchanged); else → block path
  calling the new `blockAlign` IPC wrapper with `c0,c1` + the `blockAlignMode` ref.
  `doAlignRef`/`handleAlign` bridge (lines ~266, ~404) and `editingRef`
  serialization stay as-is. Width may change (Grow) → ride the same `runEdit` →
  `getRenderBuffer` resync the whole-row path already uses.
- `src/ipc/edit.ts` — add a `blockAlign(...)` wrapper beside `pairwiseAlign` /
  `msaAlign` (camelCase type + `fromWire`).
- `src/ui/MenuBar.tsx` — the **Align** menu (line ~332) has "Align selected
  sequences" + an "Engine" submenu (line ~343). Add a **Mode** submenu
  (`Grow | Fit`, default `Fit`) using the same radio `kind:"submenu"` pattern as
  `CutMode` (line ~296): `BlockAlignMode = "fit" | "grow"` type; `blockAlignMode` /
  `onSetBlockAlignMode` props (line ~78 `cutMode`/`onSetCutMode` is the template).
- `src/state/selection.ts` — `normalize(sel) -> CellRect {r0,r1,c0,c1}` gives the
  window; `SelectionMode` distinguishes gutter row-select (full width) from a cell
  drag. No change needed for block align (single rect suffices); multi-select
  (Thread 2) is what rewrites this file.

## Watch-outs

- **Extract the WINDOW's ungapped residues**, not the whole row — that's the whole
  point of block align. Whole-row align (full-width selection) still reads
  `sequences[row].residues`.
- **Whole-row path stays byte-for-byte unchanged.** Branch early in `doAlign`;
  don't "unify" whole-row into "block with full width" — it spends regression risk
  on a smoke-passed feature for no user-visible gain (advisor).
- **Rectangularity:** Fit/`==`/`<` keep width (per-row net delta 0); Grow adds `+g`
  to *every* row (selected replace, non-selected insert) — same delta everywhere.
  Assert no row drifts off-width.
- **Losslessness:** degapped residues identical before/after; cells outside `[c0,c1]`
  untouched in the no-grow cases. Unit-test it.
- **Stale index safety:** the block command reads rows directly (to extract the
  window) → clamp `r1`, bail on `r0 >= num_rows` (copy `cut_shorten_writes`).
- **Fit-overflow is reachable** (e.g. 2-col window, `AB`/`BA`, cheap gaps → 3 cols)
  — the refusal message is a normal path, not an assertion.
- **`wblock == 0`** (all selected rows all-gap in the window) → "nothing to align"
  guard, no edit (mirror the `length == 0` whole-row guard).
