# Consensus + coloring + shell — task checklist

Companion to `consensus-coloring-plan.md` (the design + decisions) and
`consensus-coloring-context.md` (key files). Tracks the remaining work per phase.

## Phase 1 — quick wins ✅ DONE (GUI smoke PASSED 2026-06-25)
- [x] spacebar → gap (`model/typing.ts::residueForKey`)
- [x] `cons` → `Consensus` gutter label
- [x] minimap sharpness (size aggregate near strip device px; nearest-neighbor safe)
- [x] confirm insert-mode-only-grows-active-row (smoke-only)
- [x] follow-up: trailing-gap padding renders faint grey

## Phase 2 — consensus engine ✅ DONE (code complete + green; committed 924a0c5)
- [x] `model/profile.ts` — `ColumnProfiles` SoA backbone (nonGap/gap/topByte/topCount/
      distinct/baseMask), `columnProfiles(view, r0, r1)`
- [x] `model/consensus.ts` — `consensusBytes(profiles, config, alphabet)` ordered pipeline;
      `ConsensusConfig`; `defaultConfigFor`; `columnConsensus` reimplemented on top
- [x] 4 advisor corrections (RNA U-rewrite centralized, integer-exact majority, ≤2 cutoff,
      pipeline order); back-compat byte-identical

## Phase 3 — consensus options dialog ✅ DONE (GUI smoke PASSED 2026-06-29; committed 65dba05 + pushed)
- [x] `consensus.ts`: `consensusControlsEnabled(config)` pure helper (which sub-controls the
      pipeline reads) + tests
- [x] `consensus.ts`: `sameTypeMaxBases: 2 | 3` config field (RESOLVED open question — user
      chose "both options"); threaded into the `sameType` iupac-class branch; default 2
      (back-compat); `STRICT_CONFIG`/`PLURALITY_CONFIG` updated; +cutoff tests
- [x] `TrackLaneRenderer`: nullable `config` + `setConfig(cfg | null)` (null = alphabet
      default via `columnConsensus`); `ensureConsensus` rederives via `consensusBytes`
- [x] `ConsensusDialog.tsx` + `.css`: real modal (backdrop + card, Esc/click-outside/×),
      live-apply, segmented controls, `>N%` threshold input, Reset + Done; disabled (not
      hidden) sub-controls per `consensusControlsEnabled`
- [x] `Grid.tsx`: `consensusConfig` (override, nullable) + `consensusOpen` state;
      `trackRendererRef`; live-apply `useEffect([consensusConfig])` → setConfig + markDirty;
      cross-alphabet reset via `prevAlphabetRef` in `[view]` effect; `consensusOpenRef`
      keydown guard; render the dialog with the EFFECTIVE config
- [x] `Toolbar.tsx`: throwaway "Consensus…" button (Phase 5 → menu bar)
- [x] typecheck + 259 vitest + build green
- [x] **GUI smoke** PASSED (2026-06-29, user "all good"); committed 65dba05 + pushed

## Phase 4 — coloring (4A+4B+4C code complete + green; GUI smoke PENDING)
### 4A — data layer ✅ DONE (committed e0eaf6a)
- [x] `model/coloring.ts`: `ColoringConfig` + `DEFAULT_COLORING`; `conservedColumns(profiles,
      threshold, denominator)` integer-exact inclusive `≥`, all-gap col never conserved;
      `coloringControlsEnabled`; tests (both denominators, boundaries, all-gap guard)
- [x] `model/columnData.ts`: `ColumnData` shared cache (`profiles`/`consensus`/`conserved`,
      keyed by view + config object identity; `invalidate()`); NOT a WeakMap; tests
### 4B — renderers ✅ code complete
- [x] `render/runs.ts`: `forEachFillRun` styleFor widened to `(byte, col)`; +column-aware test
- [x] `render/coloring.ts`: pure `makeGridStyleFor` + `trackFillFor`; headless tests
- [x] `render/colors.ts`: `mutedStyle` + `accentStyle` themeable fills (defaults + overrides
      tested); neutrals + SchemeSpec + makeScheme
- [x] `Canvas2DRenderer`: inject `ColumnData`, `setColoring`/`setConsensusConfig`,
      `gridStyleFor` built once/frame → `forEachFillRun`; density tier + trailing tail untouched
- [x] `TrackLaneRenderer`: delegate consensus to `ColumnData`, `setColoring`, conserved-mask
      for consensus-only/nonconsensus-only via `trackFillFor`
- [x] `Grid.tsx`: construct `ColumnData` → both renderers; `columnData.invalidate()` in both
      edit paths; `coloringConfig` state + `gridRendererRef`; fan consensus + coloring configs
      to BOTH renderers via effects
### 4C — dialog ✅ code complete
- [x] `ConsensusDialog`: retitled "Consensus & coloring" + Coloring section (track/grid modes
      + `≥N%` + basis + highlight toggles), live-apply, disabled via `coloringControlsEnabled`;
      `.cons-section` divider CSS (light + dark)
- [x] typecheck + 295 vitest + build green
- [x] **GUI smoke** PASSED (2026-06-29, user "all good"); committed + pushed. KEY watch
      confirmed = match-consensus needs rule=Majority under the DNA strict-IUPAC default
- [x] commit + push after smoke

## Phase 5 — shell (code complete + green; GUI smoke PENDING)
- [x] `render/TrackLaneRenderer.ts`: `setColorScheme` (mirror `Canvas2DRenderer` — fill
      rederived per draw, atlas re-inks lazily) + `setVisible` (early-return in `draw`)
- [x] `ui/MenuBar.tsx` (+ `.css`): replaces the flat `Toolbar`. `Edit` / `View` / `Consensus`
      click-to-open dropdowns; mode groups are click-to-open `▸` flyout SUBMENUS (radio, the
      collapsed parent row shows the current value); outside-mousedown + Esc close (no overlay
      backdrop, so bar buttons switch in one click); dropdowns `position:fixed` (escape the
      strip clip). `Edit` = Copy/Cut/Paste/Delete-seqs/Delete-cols + 6 mode submenus
      (copy format · paste mode · insert shift · cut mode · delete key · typing). `View` =
      Color scheme · Grid coloring · Track coloring + Show-consensus-track toggle. `Consensus`
      = Options… (the dialog). Platform-aware accel (`Ctrl`/`⌘`). Right side keeps the
      selection readout + a compact DESTRUCTIVE-MODE glance-state (paste/cut/del) + the message.
- [x] `ui/Grid.tsx`: `schemeId` + `trackVisible` state; `handleSetScheme`/`handleToggleTrack`/
      `handleSetGridColoring`/`handleSetTrackColoring` (the View quick-picks patch the same
      `coloringConfig` the dialog edits); `minimapRendererRef`; live-apply effects
      (`[schemeId]` → all 3 renderers + minimap aggregate rebuild; `[trackVisible]` →
      `track.setVisible` + `--track-h` collapse); `SCHEMES = listSchemes()` const; swap
      `Toolbar`→`MenuBar`; conditional `--track-h: 0` + `.hidden` on the track elements
- [x] `menuOpenRef` guard (advisor): MenuBar reports open/closed via `onOpenChange`; the grid's
      window keydown bails while a menu is open so Delete/arrows can't mutate the selection
      behind the panel (mirrors `consensusOpenRef`)
- [x] delete `ui/Toolbar.tsx` + `.css` (mode types moved into `MenuBar.tsx`)
- [x] typecheck + 295 vitest + build green
- [x] **GUI smoke** PASSED (2026-06-29, user "all good"): menus open/switch/close (click,
      outside-click, Esc); submenu flyouts pick radios + show current value collapsed;
      destructive-mode glance-state reads on the strip. View: scheme picker recolors
      grid+track+minimap; grid/track coloring quick-picks match the dialog; Show-consensus-track
      collapses the lane + the grid reclaims the height (and restores). All Edit actions/modes
      behave as the old toolbar did.
- [x] advisor review + commit + push + update memory/CLAUDE.md after smoke

### Phase 5 follow-up — dialog help glyphs + draggable window (code complete + green; rides the Phase 5 smoke)
Prompted by a user question about Full vs Conserved coloring (track + grid) under highlight=residue.
- [x] `ConsensusDialog.tsx`: `RowLabel` helper — every option row's left label carries an inline
      ⓘ help glyph with a native `title` tooltip explaining that row's options (the answer to the
      Full-vs-Conserved question lives in the "Consensus track" / "Main grid" / "Conserved at" /
      "Highlight" tooltips). Both placements the user asked for ("the options" + "the left column")
      resolved to the dialog's row-label column (AskUserQuestion 2026-06-29). `off` dims the glyph's
      label like the disabled segments.
- [x] `ConsensusDialog.tsx`: drag-to-move — header is the handle; pointer-capture drag (same pattern
      as the name-gutter selection, so a fast drag can't get stuck if the pointer leaves the webview)
      translates the card via `transform`; offset resets on reopen (dialog is conditionally mounted);
      never starts from the × button.
- [x] `ConsensusDialog.css`: `.cons-help` glyph (muted ⓘ, `cursor: help`, brightens on hover/focus,
      light + dark); `.cons-head` gets `cursor: move` + `user-select: none`.
- [x] typecheck + 295 vitest + build green (no model logic changed — no new tests)
- [x] **GUI smoke** PASSED (2026-06-29, folded into the Phase 5 smoke): hover each row's ⓘ →
      correct tooltip; drag the dialog by its header around the screen, the × button still closes
      (doesn't drag); reopen re-centers; tooltips legible in dark mode.

## Carry-over GUI smokes (fold into the next `tauri dev`)
- [ ] keyboard entry (Replace/Insert) + the strict-IUPAC track — ride along with Phase 3's
      smoke since Phase 3 extends that track
