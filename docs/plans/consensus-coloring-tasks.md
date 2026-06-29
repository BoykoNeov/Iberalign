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

## Phase 3 — consensus options dialog ✅ code complete + green; GUI smoke PENDING
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
- [ ] **GUI smoke** (next `tauri dev`): open the dialog; toggle each rule and watch the
      track repaint live; confirm disabled states (strict-iupac greys fallback + sub-modes;
      same-type display only under same-type; cutoff only under same-type+iupac-class;
      threshold only under majority); `≤2`/`≤3` cutoff changes a 3-base column; majority %
      input; Reset; Esc/click-outside/× close; arrows don't drive the grid behind the modal;
      load a different-alphabet file → override resets to default
- [ ] commit + push after smoke

## Phase 4 — coloring (NOT STARTED)
- [ ] profile cache (`profile(view, r0, r1)` memoized by view identity + invalidate-on-edit)
- [ ] consensus-track coloring modes: full | none | consensus-only | nonconsensus-only
- [ ] main-grid coloring: by-residue (current) | by-conservation (custom %) |
      match-consensus | mismatch-consensus — threaded into `Canvas2DRenderer` as a passive
      per-column array read (VERIFY it stays a lookup, not per-frame work)

## Phase 5 — shell (NOT STARTED)
- [ ] toolbar → menu bar (`Edit` / `View` / `Consensus`); actions + checkable mode items +
      submenus; the "Consensus…" button + all toolbar toggles move here

## Carry-over GUI smokes (fold into the next `tauri dev`)
- [ ] keyboard entry (Replace/Insert) + the strict-IUPAC track — ride along with Phase 3's
      smoke since Phase 3 extends that track
