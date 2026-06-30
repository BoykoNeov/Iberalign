# Block / sub-area align + multi-select (task checklist)

Companion to `block-align-plan.md` + `block-align-context.md`. Decisions locked
2026-06-30 (advisor + user): **design-only this session**; block align builds next
session; multi-select is a later, explicitly-gated milestone.

## This session (2026-06-30) — design only ✅ DONE

- [x] Advisor-reviewed the framing (block align vs multi-select separation; the
      Fit≠constrained nuance; implicit-trigger trade-off)
- [x] User decisions captured: design-only · `Grow|Fit` toggle default `Fit` ·
      implicit trigger
- [x] Wrote `block-align-{plan,context,tasks}.md`
- [ ] Update `m3-tasks.md` "Deferred" section to point at these docs (optional
      tidy; do when block align actually lands)

## Block / sub-area align (NEXT SESSION — code + GUI smoke)

### Engine / command (`src-tauri`, reusing `align-core`)
- [ ] `block_align(rows, c0, c1, …, grow: bool, engine?, matrix?, gap_open?,
      gap_extend?)` command: extract each row's **windowed** ungapped residues
      (gapped bytes in `[c0,c1]` minus `is_gap`); dispatch 2-row→`pairwise`,
      3+/KAlign→`progressive_align`/`kalign_align` (same logic as `doAlign`)
- [ ] Width reconcile: `wblock==worig` / `wblock<worig` ⇒ `SetCells` (gap-pad tail
      to `worig`); `wblock>worig` + Grow ⇒ mixed `SpliceRows` (replace selected,
      insert `g` gaps at `c1+1` non-selected); `wblock>worig` + Fit ⇒ no edit +
      "needs N more cols" signal
- [ ] `wblock==0` guard (all-gap window) ⇒ no edit + "nothing to align"
- [ ] Stale-index guard: clamp `r1`, bail `r0 >= num_rows` (copy `cut_shorten_writes`)
- [ ] Reuse/extend a DTO (`grew` / `fitOverflow` field for the UI message)
- [ ] Register in `lib.rs`
- [ ] Tests: `wblock==worig` drop-in; `wblock<worig` gap-pad; Grow insert +
      undo round-trip; Fit-overflow makes no edit; **losslessness** (degapped
      residues byte-identical before/after; out-of-window cells untouched);
      rectangularity after Grow; all-gap-window no-op

### Frontend (`src`)
- [ ] `ipc/edit.ts`: `blockAlign(...)` wrapper + camelCase type + `fromWire`
- [ ] `MenuBar.tsx`: Align → **Mode** submenu (`Grow | Fit`, default `Fit`);
      `BlockAlignMode` type + `blockAlignMode`/`onSetBlockAlignMode` props (mirror
      `CutMode`/`onSetCutMode`)
- [ ] `Grid.tsx`: `blockAlignMode` state + ref; `doAlign` branches on full-width
      vs sub-column selection (`normalize` → `c0,c1`, compare to `width`); block
      branch calls `blockAlign(rows, c0, c1, mode)`; whole-row branch unchanged
- [ ] Status readout names the mode it took (`Block-aligned cols a–b · L cols` vs
      `Aligned N sequences · L cols`); Fit-overflow → warn message "widen or Grow"
- [ ] typecheck + vitest + build green

### GUI smoke (next session, after code-complete)
- [ ] Sub-column select 2 rows → Align → only the window re-aligns; cells outside
      `[c0,c1]` and other rows unchanged; `Ctrl+Z` restores
- [ ] Fit (default): a window with slack packs in place (no width change); a tight
      window that overflows → refusal message, nothing changes
- [ ] Grow: the same overflow case inserts columns; the rest of the alignment
      shifts but stays mutually aligned; `Ctrl+Z` restores
- [ ] 3+ rows block align (progressive); KAlign engine; protein vs DNA defaults
- [ ] Full-width selection still does whole-row align (regression check)
- [ ] All-gap window → "nothing to align"

## Non-adjacent / arbitrary N≥2 multi-select (LATER MILESTONE — gated)

**Do not start without an explicit user go.** Large + cross-cutting (changes
copy/cut/delete semantics). Backend is already done (`msa_align(Vec<usize>)`).

- [ ] Decide the selection-model shape: (1) full multi-rectangle, (2) Ctrl-click
      align-scoped row set, or (3) keep deferring (see plan §Thread 2 options)
- [ ] If built: rework `state/selection.ts` (multi-rect/-set reducers), `GridStore`,
      `render/SelectionLayer.ts`, and every selection consumer (`model/copy.ts`,
      cut `writeClipboard`, `delete_rows`/`delete_columns`, `clear_cells`,
      Grid mouse/keyboard handlers)
- [ ] Align over the resulting non-adjacent row set (one-line `rowList` change —
      the backend already takes it)
- [ ] Define copy/cut semantics over a disjoint selection (FASTA per row-run?)
- [ ] Full GUI smoke across all selection consumers

## Notes
- Block align is **additive**: the whole-row align path (`pairwise_align`/
  `msa_align`, `doAlign` full-width branch) is left byte-for-byte unchanged.
- No new `EditCmd` variant; no constrained-width DP (user picked `Grow|Fit`, not
  "always fits in box").
- Implicit trigger is reversible to an explicit menu toggle if it confuses users
  (advisor's flagged concern; user accepted the trade-off).
