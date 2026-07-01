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

## Block / sub-area align — CODE COMPLETE + GREEN (2026-07-01); GUI smoke pending

### Engine / command (`src-tauri`, reusing `align-core`) ✅
- [x] `block_align(rows, c0, c1, grow, engine?, matrix?, gap_open?, gap_extend?)`
      command: extract each row's **windowed** ungapped residues via
      `block_window_seqs` (gapped bytes in `[c0,c1]` minus `coords::is_gap`);
      dispatch 2-row→`pairwise`, 3+/KAlign→`progressive_align`/`kalign_align`
      (same logic as `doAlign`; KAlign branch cfg-gated verbatim from `msa_align`)
- [x] Width reconcile in the pure `block_align_cmd` → `BlockPlacement` enum:
      `wblock<=worig` ⇒ `Fit(SetCells)` (left-justify + gap-pad tail to `worig`);
      `wblock>worig` + Grow ⇒ `Grow(SpliceRows)` (replace selected window, insert
      `g` gaps at `c1+1==c0+worig` in non-selected — append-at-`width` on a
      right-edge window); `wblock>worig` + Fit ⇒ `Overflow(g)` (no edit)
- [x] `wblock==0` guard (all-gap window) ⇒ no edit, `length:0` DTO
- [x] Column clamp done ONCE in the command (`c1 = c1.min(width-1)`; `worig`
      derived from the clamped `c1`); row list validated (sorted/dedup/≥2/in-bounds)
- [x] `BlockAlignResultDto { num_seqs, length, grew, fit_overflow }`
- [x] Register in `lib.rs`
- [x] Tests (8): window extraction; `wblock==worig` drop-in; `wblock<worig`
      gap-pad; Grow insert + undo round-trip; **right-edge Grow** (insert at
      `col==width`); **cols-mode all-rows Fit preserves width (no shrink)**;
      Fit-overflow makes no edit; **a seam test driving the REAL `pairwise`
      end-to-end** (extraction → aligner → reconcile → apply, lossless) — the other
      7 feed synthetic blocks, so this closes the extraction/dispatch seam
      (advisor-flagged). Losslessness (degapped residues byte-identical) +
      out-of-window-untouched + rectangularity asserted inside the drop-in/grow tests.

### Frontend (`src`) ✅
- [x] `ipc/edit.ts`: `blockAlign(rows,c0,c1,mode,engine?)` wrapper + `BlockAlignMode`
      + `BlockAlignResult` types + `fromWire`
- [x] `MenuBar.tsx`: Align → **Block overflow** submenu (`Fit | Grow`, default
      `Fit`); `blockAlignMode`/`onSetBlockAlignMode` props (mirror the Engine
      submenu). `BlockAlignMode` imported from `ipc/edit` (domain type)
- [x] `Grid.tsx`: `blockAlignMode` state + ref + handler; `doAlign` branches on
      `fullWidth = c0===0 && c1===v.width-1` — full-width ⇒ whole-row path
      (byte-for-byte unchanged); else ⇒ `blockAlign(rowList, c0, c1, mode, engine)`.
      Fit-overflow / all-gap return an empty buffer so `runEdit` skips the repaint.
- [x] Status readout: `Block-aligned cols a–b · N seqs · L cols [(grown)] [· KAlign]`;
      Fit-overflow → warn "needs N more cols — widen or switch Block overflow to Grow"
- [x] typecheck + 295 vitest + build green (clippy `-D warnings` + fmt clean; 43 iberalign tests)

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
