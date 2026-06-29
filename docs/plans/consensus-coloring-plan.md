# Consensus + coloring + shell — roadmap plan

Umbrella plan for the large multi-feature batch requested 2026-06-24. Spans
several work-batches; each gets its own `{plan,context,tasks}` triad when it
starts. This file is the agreed design + decisions + phasing.

## Status

- **Phase 1 (quick wins) — GUI smoke PASSED (2026-06-25, user "all work").** Plus a
  smoke-driven follow-up landed the same day:
  - **Trailing-gap padding renders FAINT GREY (not as real gaps) — GUI smoke PASSED
    (2026-06-25, user "all works"; blank tried first, faint grey chosen).** Smoke
    observation: insert-mode "appears to grow all sequences" — because splicing a
    column into the active row trailing-pads every OTHER row to keep the matrix
    rectangular (the core trailing-pad-only invariant; the buffer MUST stay
    rectangular, so this is a RENDER fix, never an engine change). The grid draws each
    row's trailing gap run (gaps past its last residue) as a recessive grey fill
    (`trailingStyle` = `[230,230,230]`) with NO `-` glyph — so sequences read "ragged
    right" and don't look like they grew. INTERIOR gaps still show as full gaps.
    **Color tuning (advisor):** the interior-gap↔background band (`232`–`250`) is too
    narrow for a third clearly-separated grey, so trailing sits at ~gap lightness and is
    distinguished from interior gaps by the ABSENT glyph, not by color — spending the Δ
    where the eye needs it (Δ20 vs background; the first try `[241]` was an invisible Δ9
    and read as empty space). `colors.test.ts` now asserts `background − trailing ≥ 12`
    (a perceptibility floor) rather than bare `!==` (which passed at the invisible Δ9).
    Generalized to ALL trailing padding (file-loaded ragged lengths, cut-shorten pad),
    not just the last insert — more correct, not scope creep (advisor-confirmed).
    First shipped as bare BACKGROUND (blank); user smoke-passed it then asked for the
    faint grey ("looks better"), now applied. New pure
    `model/trailing.ts::trailingGapStarts(buffer, width, numRows)` (per-row first
    trailing-gap column; ends-in-residue → `width`, all-gap row → `0`);
    `trailing.test.ts` pins the boundaries. `trailingStyle` lives on the `ColorScheme`
    (themeable; `colors.test.ts` asserts it ≠ gap and ≠ background). Renderer caches
    the per-row starts by view identity like occupancy and **drops them in
    `invalidateContentCaches`** (the in-place edit path keeps the same view object —
    without the reset, insert would show the old padding boundary until reload; the
    exact bug this targets). `drawCells` clamps fills + glyphs to `[cols.first,
    trailStart)` then paints one faint-grey rect for the padding tail. Scoped to the
    letter/block tiers (the density tier already fades gaps via occupancy); trailing
    only (leading gaps left as-is, per the request). An all-gap row now renders as a
    faint-grey row (name in the gutter, recessive cells) rather than fully blank.

- **Phase 1 quick wins (the three items) — landed 2026-06-25, smoke PASSED above**
  (frontend-only; typecheck + 221 vitest + build all green):
  - **spacebar → gap.** New pure `model/typing.ts::residueForKey(key) → string |
    null` (space → `-`; a residue glyph → itself; else `null` so the grid falls
    through to nav). `isResidueKey` stays strict (its test that space is *not* a
    glyph is unchanged). `Grid.tsx` keydown now routes through `residueForKey`, so
    pressing space writes a gap at the cursor in the current type-mode (Replace
    overwrites; Insert splices a gap column into the active row). `typing.test.ts`
    grew a `residueForKey` block.
  - **`cons` → `Consensus`.** Track-lane gutter label text in `Grid.tsx`; renders
    `CONSENSUS` (the `.grid-track-corner` `text-transform: uppercase` is kept for
    chrome consistency) and fits the 124px content box, no resize needed.
  - **minimap sharpness.** `MinimapLayer` now sizes the offscreen aggregate to
    `min(content, strip-device-px, cap)` per axis, so the blit is only ever an
    upscale or 1:1 → `imageSmoothingEnabled = false` is unconditionally safe (crisp
    few-row bands; box accumulation still anti-aliases the downscale, so no thin-
    column loss). Cache keyed on the CLAMPED resolution, so it rebuilds on a
    strip-resolution change but stops rebuilding past the cap. Pure-geometry
    `minimap.test.ts` is unaffected (it tests only `viewportRectInMinimap` /
    `minimapToScroll`).
  - **insert-mode-only-grows-the-active-row** — already the behavior
    (`doType` → `pasteInsert(row, col, [ch], /*shiftAll*/ false)` at `Grid.tsx`);
    verified in code, smoke-only.

  **GUI-smoke checklist (next `tauri dev`):** space inserts a gap in both Replace
  and Insert modes; `CONSENSUS` label reads cleanly in the gutter; minimap is sharp
  with few sequences AND with a wide alignment, AND a window-resize doesn't visibly
  jank at a large alignment (the new per-resolution-change rebuild is O(width×rows);
  10k×10k is the ceiling, not the target — debounce only if it janks). Folds in the
  still-pending keyboard-entry + strict-IUPAC consensus-track smokes.

- **Phase 2 (consensus engine) — code complete + green (typecheck + 253 vitest +
  build; +28 new tests; advisor-reviewed).** Pure model, NO UI — the consensus track is
  byte-for-byte unchanged (its `columnConsensus` now routes through the new engine under
  the alphabet default). Two files:
  - **`src/model/profile.ts`** — the shared backbone the advisor confirmed: a per-column
    `ColumnProfiles` (structure-of-arrays, length = width) holding `nonGap` / `gap` /
    `topByte` (uppercase, smallest-byte tiebreak) / `topCount` / `distinct` / `baseMask`
    (OR of nucleotide base-bits). The KEY result: that compact set is sufficient for EVERY
    rule AND both Phase-4 colorings — no full per-residue histograms (~15 bytes/col). One
    reused 256-count table, column-major, `touched`-list reset (cache O(alphabet) not
    O(width×256)). `BASE_MASK` moved here. `columnProfiles(view, r0, r1)` clamps + accepts
    reversed bounds. Storing `nonGap` and `gap` separately keeps the Phase-4 conservation
    denominator choice open (`topCount/nonGap` vs `/(nonGap+gap)`).
  - **`src/model/consensus.ts`** — the ordered pipeline `consensusBytes(profiles, config,
    alphabet)`: (1) gap short-circuit FIRST (`gap-priority`→`-` / `star-if-gap`→`*` /
    `ignore`), (2) `nonGap==0 → '-'` guard, (3) agreement rule
    {`strict-iupac` | `all-identical` | `same-type{ry-code|majority-base|iupac-class}` |
    `majority{threshold}`}, (3') `noConsensus` fallback (`gap`|`star`, non-strict rules
    only). `ConsensusConfig` type exported. `columnConsensus` reimplemented on top via
    `defaultConfigFor(alphabet)` (DNA/RNA → strict-IUPAC; anything else → plurality ==
    `majority@0`). **Four advisor corrections baked in from the start:** (a) RNA U-rewrite
    centralized in `decodeMask(mask,rna)` so BOTH mask-decoding rules (strict-iupac AND
    same-type/iupac-class) get it; (b) **integer-exact** majority threshold (`topCount*1000
    > round(threshold*1000)*nonGap`) — fp `>` mis-rounds e.g. 3/5 vs 0.6; (c) `same-type/
    iupac-class` cutoff = **≤2 distinct bases** (see open question below); (d) pipeline
    order pinned so `star-if-gap` reaches an all-gap column. Back-compat verified
    byte-identical (advisor): protein plurality ≡ majority@0 incl. the `["W","A"]→A` tie;
    strict-iupac `mask==0 → '-'` quirk kept (new rules send `mask==0` → fallback).

**Phases 3–5 below: not started.** (Profile CACHING is deferred to Phase 4, when the
colorings share the profile; Phase 2's `columnConsensus` builds a transient profile per
call — same cost as before, the track's by-view-identity byte cache untouched.)

## Open questions (surface in the Phase-3 dialog)

- **`same-type / iupac-class` cutoff is ≤2 distinct bases.** Advisor-greenlit as the
  defensible plain reading ("same type" with S/W/K/M = 2-base codes; it MUST cut below 4
  or it is literally strict-iupac), but it is the one rule whose semantics the user hasn't
  explicitly confirmed. The Phase-3 dialog should surface/confirm it (one branch in
  `sameType()`, trivially flippable to include the 3-base codes B/D/H/V).
- **`majority-base` / `iupac-class` can echo an ambiguity code straight from the data.**
  If the source contains a literal `R`/`N`/`*`, the top residue or class can be that code
  — a known limitation of deriving consensus from possibly-malformed input, not a bug. No
  code now; flagged so it is a known edge, not a surprise.

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
