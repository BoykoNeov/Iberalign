# Block / sub-area align + non-adjacent multi-select (plan)

The two threads M3 deferred as "design open" (see `m3-plan.md` §"Deferred to a
future session"). This is the **design** — decided with the user + advisor on
2026-06-30. **No code was written this session** (user chose "design doc only");
this file + `block-align-context.md` + `block-align-tasks.md` are the deliverable,
and the checklist drives a future implementation session.

Spec: §5 "Pairwise alignment" / §12 (alignment in the grid). Builds directly on
the shipped M3 + progressive-MSA + KAlign align path (`commands.rs::pairwise_align`
/ `msa_align`, `Grid.tsx::doAlign`).

## User decisions (2026-06-30)

Captured via an explicit decision prompt (advisor-reviewed first):

1. **Scope — design doc only.** Decide the open questions, write the plan; build
   next session. Block align is implementable in one focused session; multi-select
   is a separate (larger) milestone.
2. **Overflow behavior — choosable `Grow | Fit` toggle, default `Fit`.** Matches
   the user's standing lean ("Variant 2, maybe choosable"). **No constrained-width
   DP** — `Fit` packs in place when the optimal alignment fits the window and
   *refuses with a clear message* when it doesn't; `Grow` inserts the needed
   columns. (The user did NOT pick the "constrained, always-fits-in-box" branch,
   which would have needed a new bounded-width DP.)
3. **Trigger — implicit.** A **sub-column** selection (the rectangle does not span
   the full width) ⇒ block align; a **full-width** selection (name-gutter row
   select, or a cell rectangle spanning every column) ⇒ today's whole-row align.
   The user chose this over the advisor's "explicit action/toggle" recommendation;
   see the trade-off recorded under "Thread 1 → Trigger" below.

## Thread 1 — Block / sub-area align (build next session)

### What it does

Align only the residues **inside the selected column window**, for the selected
rows, leaving every other cell (other rows; the selected rows' cells outside the
window) untouched. "Align this region," vs today's "align these whole sequences."

### Trigger (implicit — user decision #3)

`doAlign` branches on the selection's column extent:

- **Full-width selection** (`c0 == 0 && c1 == width-1`) — includes every
  name-gutter row selection (`SelectionMode::rows` spans all columns) and any cell
  drag that happens to cover the full width ⇒ **whole-row align, exactly as today**
  (`pairwise_align` / `msa_align`, column extent ignored). This path is **left
  byte-for-byte unchanged** — block align is a new, additive branch, NOT a refactor
  of the smoke-passed whole-row code (advisor).
- **Sub-column selection** (`c1 - c0 + 1 < width`) ⇒ **block align** over columns
  `[c0, c1]`.

**Recorded trade-off (advisor flagged; user accepted).** Today a partial-rectangle
selection + Align aligns the *whole* rows (column extent ignored). After this
change, the same gesture aligns only the windowed residues — a real semantic
change, triggered silently by selection shape. Two things bound the surprise:
(a) the default is `Fit`, so a sub-window that fits just packs in place (no matrix
change), and an overflow gets a clear refusal message — never a silent grow;
(b) the status readout must name the mode it took (e.g. `Block-aligned cols a–b:
…` vs `Aligned N sequences · L cols`) so the behavior is legible. If users still
trip on it, the fallback is to surface the trigger as the explicit menu toggle the
advisor preferred — cheap to add later, so this is a reversible decision.

### Algorithm

For selection rect rows `r0..=r1`, cols `c0..=c1`, `worig = c1 - c0 + 1`:

1. **Extract** each selected row's ungapped residues *within the window*: read the
   gapped row bytes at columns `c0..=c1`, drop gaps (`align_core::coords::is_gap`).
   A row that is all-gaps in the window contributes an empty sequence (legal — the
   MSA `one-empty` test already covers an empty input → all-gap output row).
2. **Align** the extracted residues, reusing the existing engine exactly:
   - 2 rows under the progressive engine ⇒ `pairwise` (Gotoh global) — keeps the
     score/%id readout.
   - 3+ rows, or any row count under KAlign ⇒ `progressive_align` / `kalign_align`.
   - Matrix/scoring default by the alphabet widened over the selected rows' window
     residues (same `default_for` logic as the whole-row path).
   Result is `wblock` columns wide, rows in input order.
3. **Reconcile** `wblock` against `worig` and apply ONE reversible edit:

   | Case | Placement | Edit | Matrix width |
   |------|-----------|------|--------------|
   | `wblock == worig` | drop-in over `[c0,c1]` | `SetCells` | unchanged |
   | `wblock < worig`  | left-justify in `[c0,c1]`, gap-pad tail to `worig` | `SetCells` | unchanged |
   | `wblock > worig` + **Fit**  | — | **refuse, no edit** | unchanged |
   | `wblock > worig` + **Grow** | insert `wblock - worig` cols at the block's right edge | mixed `SpliceRows` | `+(wblock-worig)` |

### The Grow | Fit fork (user decision #2)

- **Fit (default).** If `wblock <= worig`, place left-justified and gap-pad the
  window tail to `worig` — a pure width-preserving `SetCells` (mirror of
  `gap_fill_writes` / `cut_shorten_writes`: per-row `CellWrite` over `[c0, c1]`,
  the captured old bytes are the inverse for free). If `wblock > worig`, **make no
  edit** and show: *"Optimal alignment needs N more column(s) than selected — widen
  the selection or switch to Grow."* Never disturbs neighbors; never lossy.
- **Grow.** Always succeeds. Insert `g = wblock - worig` columns at column `c1+1`:
  - selected rows: `SpliceRows` replacing `[c0, c1]` (`remove = worig`) with the
    aligned block bytes (length `wblock`);
  - non-selected rows: `SpliceRows` inserting `g` gap bytes at column `c1+1`
    (`remove = 0`).
  Both deltas are `+g`, so every row stays width `W + g` (rectangular). Columns
  left of `c0` and right of the old `c1` stay mutually aligned across all rows —
  only the block region changes. This is the same `realign_splice` shape
  generalized to a column window; **no new `EditCmd` variant**.

`Grow | Fit` is a MenuBar **Align → Mode** submenu (radio, default `Fit`),
identical wiring to the `CutMode` (`Shorten | Mask`) submenu: `BlockAlignMode =
"fit" | "grow"` type in `MenuBar.tsx`, threaded as `blockAlignMode` /
`onSetBlockAlignMode` props into `Grid.tsx` state + a ref the effect-scoped
`doAlign` reads. The collapsed row shows the current value; the toggle is only
*meaningful* for sub-column selections but stays always-enabled (hiding/disabling
it would reflow the right-pinned message — same reasoning as the paste shift
toggle).

### Losslessness (assert in a test)

Block align never changes the derived ungapped `Sequence.residues`: it re-arranges
the *same* residues, in the *same* order, only moving the gap pattern within the
window (Fit/`==`/`<`) or widening the matrix (Grow). So `apply_to_dataset`'s
residue resync is a no-op on residue content ⇒ undo is lossless **by construction**.
Pin it: a unit test that block-aligns a window and asserts every row's degapped
residues are byte-identical before/after (and that `c < c0` / `c > c1` cells are
untouched in the no-grow cases). Use `coords` (`col_to_seq_pos`) to reason about
placement; do **not** hand-slice raw bytes for the position mapping — that
round-trip is already property-tested.

### Edge cases

- **Window all-gaps for some rows** → empty extracted sequence → that row is all
  gaps in the aligned block (MSA `one-empty` behavior). No special-case.
- **All selected rows empty in the window** → `wblock == 0` → nothing to align;
  message *"Nothing to align (selection is all gaps)."*, no edit (mirror the
  existing `length == 0` guard).
- **`wblock == worig` is the common, cheap case** (the window had enough slack) —
  pure `SetCells`, no width change, Fit and Grow behave identically.
- **2-row pairwise in Fit that overflows** still reports the would-be score in the
  refusal? No — keep it simple: refuse before applying, no readout (consistent with
  "no edit made").
- **Selection clamp invariant** (`c1 < width`, `r1 < num_rows`) holds from the
  selection layer; the command still validates (a stale index must error, not
  panic — `cut_shorten_writes` reads rows directly and already documents this).

## Thread 2 — Non-adjacent / arbitrary N≥2 multi-select (DESIGN ONLY — deferred)

**Not built next session.** Recorded here so the future milestone starts from a
decided shape. Do **not** begin this rework without an explicit go from the user —
it is large and cross-cutting (advisor + user's standing tight-scope rule).

### Why it's a separate milestone

The align **backend already accepts arbitrary rows**: `msa_align(rows: Vec<usize>)`
sorts/dedups/validates an arbitrary list (`commands.rs:1004`). The *only* blocker
is the frontend selection model: a single `Selection { anchor, active }` rectangle
(`state/selection.ts`) can only express contiguous rows. Lifting that touches every
consumer of the selection — **copy, cut, delete-rows/cols, the SelectionLayer
paint, and all mouse/keyboard handlers** — not just align. That breadth is the
milestone; align itself is a one-line `rowList` change once a multi-row set exists.

### Options (decide at milestone start)

1. **Full multi-rectangle selection** — `Selection` becomes a list of rects (or a
   primary rect + an additive set). Most general (non-adjacent rows *and* multiple
   column blocks), most invasive: copy/cut/delete must define semantics over a
   ragged union (what does "copy" of 3 disjoint rects produce? FASTA per row-run?).
2. **Ctrl/⌘-click row set (align-scoped, lighter)** — keep the rectangle for
   copy/cut/edit; add a separate *additive row set* (Ctrl-click in the name gutter
   toggles a row into an "align set"), used **only** by Align. Smaller blast radius
   (copy/cut/delete unchanged), but introduces a second selection concept the UI
   must show distinctly (e.g. a different gutter highlight). Risk: two overlapping
   "what's selected" notions confuse users.
3. **Defer entirely** until a concrete user need names which of (1)/(2) fits.

**Recommendation:** option 2 if multi-select is wanted soon and align is the driver
(cheapest path to "align rows 1, 4, 9"); option 1 only if copy/cut over disjoint
regions is *also* wanted (then it's a true selection-model milestone). Either way,
N>2 already routes to the in-process progressive/KAlign MSA — there is **no MAFFT
dependency** here (that warning is long gone).

### Downstream impact checklist (for whoever builds it)

- `state/selection.ts` — the reducers + `CellRect`/`normalize` assume one rect.
- `GridStore` — single `Selection | null`; `SelectionMode`.
- `render/SelectionLayer.ts` — paints one inverted rect + border.
- `model/copy.ts`, cut (`writeClipboard`), `delete_rows`/`delete_columns`,
  `clear_cells` — all read one normalized rect.
- Mouse/keyboard handlers in `Grid.tsx` — drag/shift-extend/arrows assume one rect.

## Locked decisions (summary)

1. Design-only this session; block align builds next session; multi-select is a
   later, explicitly-gated milestone.
2. Block align: extract windowed ungapped residues → existing pairwise/MSA engine →
   reconcile width. `Grow | Fit` toggle, default `Fit`. **No new `EditCmd`** (Fit =
   `SetCells`, Grow = mixed `SpliceRows`); **no constrained-width DP**.
3. Implicit trigger (sub-column ⇒ block; full-width ⇒ whole-row); whole-row path
   untouched; trade-off recorded; reversible to an explicit toggle if it confuses.
4. Losslessness is by construction (residues unchanged) and must be asserted.
5. Multi-select backend is ready (`Vec<usize>`); the cost is the cross-cutting
   frontend selection rework — its own milestone, not part of block align.
