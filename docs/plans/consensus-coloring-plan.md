# Consensus + coloring + shell — roadmap plan

Umbrella plan for the large multi-feature batch requested 2026-06-24. Spans
several work-batches; each gets its own `{plan,context,tasks}` triad when it
starts. This file is the agreed design + decisions + phasing. **Nothing here is
built yet** — this is the accepted plan, captured durably.

## Requests (verbatim intent)

1. Insert-mode typing expands ONLY the current sequence. *(Already the behavior
   — `pasteInsert(..., shiftAll=false)`; confirm in smoke.)*
2. Spacebar also inserts a gap.
3. Rename the `cons` track gutter label → `Consensus`.
4. Move the top toolbar buttons into a menu (chosen: **menu bar**).
5. Consensus options dialog (a real openable window):
   - **Gap handling:** ignore (current) · gap-priority (any gap → consensus is
     gap) · star (`*` in the consensus if any gap).
   - **Agreement rule:** strict-IUPAC (current, presence-union) · all-identical ·
     same-type · majority(threshold).
   - **No-consensus fallback:** gap or `*` (applies to identical/same-type/
     majority only — strict-IUPAC always yields a code).
6. Consensus-track coloring: none (glyph only) · color only consensus · color
   only non-consensus.
7. Majority consensus with a user-chosen percentage.
8. Color the MAIN GRID nucleotides by a custom percentage of identical residues
   per column (conservation coloring).
9. Minimap contours are not sharp (especially with few sequences).

## Decisions (user, 2026-06-24)

- **Shell:** a real **menu bar** — `Edit` / `View` / `Consensus`. Actions +
  checkable mode items + submenus; replaces the flat toolbar. (Advisor's "better
  idea" over the single gear-dropdown; user chose it.)
- **Same-type rule:** expose ALL THREE display sub-modes as user-selectable in
  the dialog: (a) purine/pyrimidine → show `R`/`Y`; (b) purine/pyrimidine → show
  the majority base; (c) any IUPAC class (incl. S/W/K/M…) → show its code.
- **Track vs grid coloring:** BOTH — conserved/unconserved coloring modes on the
  consensus track AND match/mismatch-vs-consensus coloring on the main grid, as
  separate options. (Folds requests 6 + 8.)
- **Majority default threshold:** strict **>50%** (a 50/50 two-way tie → no
  consensus → fallback). User-configurable.

## Architecture backbone (advisor-confirmed)

**One per-column profile, computed once, deriving everything.**
`profile(view, r0, r1)` → for each column: per-residue counts (case-folded),
non-gap total, gap count, top residue + its conserved fraction. Cached &
invalidated exactly like today's `columnConsensus` (view identity +
`invalidate()` on edit). Row-range-parameterized so Batch-3 selection-scoped
consensus + copy-as-IUPAC fall out for free. The consensus byte (#5), the
track coloring (#6), and the main-grid conservation coloring (#8) are **the same
data** — build it once.

**Consensus config = an ordered pipeline, not a flat bag of toggles:**
1. **Gap handling — short-circuit, checked first:** `gap-priority` → emit gap;
   `star-if-gap` → emit `*`; `ignore` → fall through to step 2.
2. **Agreement rule — on the non-gap residues:** `strict-iupac` |
   `all-identical` | `same-type{ry-code|majority-base|iupac-class}` |
   `majority{threshold, default >50%}`.
3. **No-consensus fallback:** `gap` | `star` — applies ONLY to identical /
   same-type / majority. Strict-IUPAC always yields a code, so the dialog GREYS
   OUT this control under strict-IUPAC (the UI can't express an impossible
   combo).

```
ConsensusConfig {
  gap: "ignore" | "gap-priority" | "star-if-gap",
  rule: "strict-iupac" | "all-identical" | "same-type" | "majority",
  sameTypeDisplay: "ry-code" | "majority-base" | "iupac-class",  // when rule=same-type
  majorityThreshold: number,        // fraction, default 0.5 exclusive (>50%)
  noConsensus: "gap" | "star",      // ignored under strict-iupac
}
```

**Coloring (passive hot-path lookups, no per-cell recompute):**
- Consensus-track mode: `full` | `none` | `consensus-only` (color conserved
  columns) | `nonconsensus-only` (color variable columns).
- Main-grid mode: `by-residue` (current) | `by-conservation` (custom %, #8) |
  `match-consensus` | `mismatch-consensus`. Threaded into `Canvas2DRenderer` as
  an optional per-column `conservation[]` / `consensusByte[]` array + a mode
  switch — a passive array read alongside the existing `fillStyleFor(byte)`
  table lookup. **Feasibility to VERIFY against the draw loop before this
  batch** (advisor): confirm it stays a lookup, not per-frame work.

## Phasing (order is the user's call)

1. **Quick wins** (no design decisions, shippable first): spacebar→gap ·
   `cons`→`Consensus` (mind the `NAME_W` gutter width — may need abbrev/resize) ·
   minimap sharpness · confirm insert-mode-already-correct.
2. **Consensus engine** — `profile` + config pipeline, pure model, fully tested
   BEFORE any UI. The current strict-IUPAC `columnConsensus` becomes one rule.
3. **Consensus options dialog** — the modal; live-apply (re-derive from the
   cached profile per toggle — no IPC, instant).
4. **Coloring** — track modes + main-grid conservation.
5. **Shell** — toolbar → menu bar. (Layout settled on paper above so it isn't
   built twice.)

## "Suggest more" (kept tight)
- Show/hide toggle for the consensus row (it's a `Drawable` — cheap to gate).
- Live-apply in the options dialog (instant feedback from the cached profile).

## Minimap sharpness (#9) — design note
`MinimapLayer.ts:100` sets `imageSmoothingEnabled = true` before the up-scale
blit; few rows → a tiny aggregate bilinearly smeared. Don't *just* flip it to
false: the aggregate is also DOWNSCALED horizontally (≤2048 cols → a narrow
strip) where nearest-neighbor can alias away a thin conserved column. Robust
fix = size the aggregate near the strip's device-pixel dimensions and rebuild on
resize. Validate empirically in the smoke (advisor).

## Open carry-over
- GUI smoke still pending for: keyboard entry (Replace/Insert) and the current
  consensus track (strict-IUPAC). Fold into the next `tauri dev` session; the
  consensus-engine work extends that track, so its smoke can ride along.
