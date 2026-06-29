# Consensus + coloring + shell — key files & decisions

Companion to `consensus-coloring-plan.md` (design) and `consensus-coloring-tasks.md`
(checklist). The map of what lives where + the load-bearing decisions, so a future
session (or Phase 4/5) doesn't have to re-derive them.

## The backbone (one profile → everything)

`model/profile.ts` — `ColumnProfiles` (structure-of-arrays, per column: `nonGap`,
`gap`, `topByte` uppercase smallest-byte-tie, `topCount`, `distinct`, `baseMask`).
`columnProfiles(view, r0, r1)` builds it; clamps + accepts reversed bounds. This
compact set is provably sufficient for every consensus rule AND both Phase-4
colorings — no full per-residue histograms. ~15 bytes/column.

`model/consensus.ts` — `consensusBytes(profiles, config, alphabet)` runs the ordered
pipeline (gap short-circuit → nonGap==0 guard → agreement rule → fallback).
`ConsensusConfig` is the config object; `consensusControlsEnabled(config)` reports
which sub-controls the pipeline reads (drives the dialog's disabled states — they
can't drift from the engine). `defaultConfigFor(alphabet)` → DNA/RNA strict-IUPAC,
else plurality (== majority@0). `columnConsensus(view, r0, r1)` is the back-compat
entry (default config); still used by the track when no override is set.

## Phase 3 wiring (consensus dialog)

- **`ui/ConsensusDialog.tsx` + `.css`** — presentational modal. Owns NO consensus
  state; renders the EFFECTIVE config and reports changes via `onChange`. Live-apply
  (no OK/Cancel). Reuses the `ctx-backdrop` modal pattern + the toolbar's segmented-
  toggle look. `Segmented<T>` is a small in-file generic control.
- **`render/TrackLaneRenderer.ts`** — `config: ConsensusConfig | null` (+ `setConfig`).
  `null` = follow the alphabet default (`columnConsensus`); a config = `consensusBytes`
  over a transient profile. `setConfig` invalidates the by-view byte cache.
- **`ui/Grid.tsx`** — `consensusConfig` (override, nullable) + `consensusOpen` state +
  `trackRendererRef` + `consensusOpenRef` (keydown guard) + `prevAlphabetRef`.
  Live-apply `useEffect([consensusConfig])` → `setConfig` + `markDirty`. Cross-alphabet
  reset in the `[view]` effect. Renders the dialog with `consensusConfig ??
  defaultConfigFor(view.meta.alphabet)`.
- **`ui/Toolbar.tsx`** — throwaway "Consensus…" button (`onOpenConsensus`).

## Load-bearing decisions

- **Nullable track config** (advisor): `null` = alphabet default. Keeps `columnConsensus`
  alive, makes the untouched case auto-track the alphabet per load with zero lifecycle
  code, and is the single source the dialog seeds from (`?? defaultConfigFor`).
- **Cross-alphabet reset, not per-alphabet persistence** (advisor): a protein file must
  not inherit a DNA strict-IUPAC override. `prevAlphabetRef` compare; same-alphabet
  reload keeps the user's choices. Per-alphabet persistence is a future refinement, not
  Phase 3.
- **Disable, don't hide** irrelevant sub-controls (hiding reflows the card). Driven by
  `consensusControlsEnabled` so the UI mirrors exactly what the engine reads.
- **IUPAC-class cutoff is user-configurable** (`sameTypeMaxBases: 2 | 3`, default 2). The
  user chose "add both options" (2026-06-29) over a fixed value. Only the one `sameType`
  branch consults it; only `iupac-class` display exposes it.
- **No coloring, no profile cache, no IPC in Phase 3** (advisor guardrails). Consensus is
  a derived view computed frontend-side; Rust still owns the truth. The one engine touch
  is the `sameTypeMaxBases` field — flagged in the plan as confirmable here, not scope
  creep into Phase 4.

## Phase 4/5 hooks already in place

- `columnProfiles` is row-range-parameterized → selection-scoped consensus + copy-as-IUPAC
  fall out for free.
- `profile.ts` keeps `nonGap` and `gap` separate → the Phase-4 conservation denominator
  choice (`topCount/nonGap` vs `/(nonGap+gap)`) is still open.
- The track is a `Drawable` on the shared rAF loop → a show/hide gate + coloring modes are
  cheap additions.
- The "Consensus…" toolbar button + every toolbar toggle move into the Phase-5 menu bar.
