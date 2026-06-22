# CLAUDE.md — Iberalign working notes

Desktop MSA viewer/editor: Tauri v2 + native Rust core + React/TS webview.
The full brief is [`iberprime-spec.md`](./iberprime-spec.md) — read it for any
non-trivial change. This file is the short list of things to get right.

## Architecture invariants (do not violate)

- **Rust owns the truth.** The authoritative `Alignment` + undo/redo stack live
  in `src-tauri` managed state (`Mutex<AppState>`). The frontend holds only a
  render-buffer copy (a flat `Uint8Array`) and view state. One source of truth.
- **No IPC per frame.** Panning/zooming/rendering reads only the JS buffer. IPC
  happens on coarse events (load, align, analyze, edit, export) — never per
  keystroke or per frame.
- **No DOM-per-cell.** The grid is a virtualized Canvas2D (→ WebGL later)
  drawing only the visible window. Millions of cells; never one element each.
- **Don't write MSA/phylogenetics heuristics.** Optimal MSA is NP-hard —
  shell out to MAFFT/MUSCLE/Clustal Omega; trees to FastTree/IQ-TREE. The only
  hand-written alignment is *pairwise* NW/SW (Gotoh affine), in `align-core`.
- **Three coordinate spaces, never conflated:** ungapped position ↔ alignment
  column ↔ screen pixel. Mapping lives in `align-core::coords`; the round-trip
  invariant is property-tested. Features anchor to *ungapped* positions and
  remap at draw time.
- **Capabilities stay scoped.** `src-tauri/capabilities/default.json` grants the
  minimum. Add `fs`/`dialog`/`shell` permissions only as the feature that needs
  them lands. No broad permissions.

## Layout

- `crates/align-core/` — pure engine, no Tauri/UI. `model parse coords align
  analyze edit io`. Keep it serde-free; DTOs for IPC live in `src-tauri`.
- `crates/align-cli/` — headless harness over the engine; the CI integration path.
- `src-tauri/` — `lib.rs` (builder + handlers), `commands.rs` (coarse async
  commands → DTOs), `state.rs` (`AppState`).
- `src/` — React frontend. `ipc/` is the only place that calls `invoke`; UI
  code imports typed wrappers from there. Also `model/ render/ state/ ui/`.

## Commands

```bash
cargo test --workspace                          # all Rust tests
cargo fmt --all                                 # format (CI checks --check)
cargo clippy -p align-core -p align-cli --all-targets -- -D warnings
cargo run -p align-cli -- summary fixtures/sample.fasta
npm run typecheck && npm run build              # frontend
npm run tauri dev                               # full app (run from repo root)
```

Build the engine crates before the Tauri shell when iterating — they're
dependency-light and surface toolchain/linker issues fast.

## Conventions

- **Stubs are explicit:** unimplemented engine functions are `todo!("Mx: ...")`
  with the milestone noted. Don't wire a `todo!()` into a Tauri command or a
  passing test — keep CI genuinely green.
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`). Each commit compiles and passes tests.
- **Editing = commands.** Every mutation is a reversible `EditCmd` applied in
  Rust; `apply` returns its inverse and the changed rows. Invalidate the
  affected row coordinate indexes and the consensus/conservation caches on edit.
- **Tests:** parser against messy fixtures; NW/SW vs hand-worked cases;
  coordinate round-trip + edit/undo invariants via `proptest`. Add a test only
  if it can fail for a real defect.

## Milestone status

- **M0 scaffolding — done.** Workspace builds; tolerant FASTA parser + coordinate
  API (property-tested); `parse_summary` IPC round-trip; CI; public repo.
- **M1 model + parsing + coordinates — code complete, green.** Gap-preserving
  parser (case-preserved, `.`→`-`, `ParseOutcome` warnings: dup-name/empty/
  malformed); `Dataset::from_records` (trailing-pad-only invariant, derives
  ungapped `Sequence`s); `Composition` stats + `align-cli composition`;
  construction round-trip proptest; per-feature fixtures; `load_alignment(path)`
  (Rust reads the file) + `dialog:allow-open` capability; "Open file…" UI.
  Done: GUI smoke + commit (`301c561`) + push; CI green. See `docs/plans/m1-*`.
- **M2 — in progress.** Rendering MVP: virtualized Canvas2D grid from the
  in-memory buffer. Landed + green: binary render-buffer IPC (raw bytes, once per
  load); frontend model/coords (col→ungapped parity-guarded vs `coords.rs`);
  canvas core (colors / glyph atlas / LOD tiers / rAF draw loop, all outside the
  React render cycle); `ui/Grid` container with drag/wheel pan + ctrl-wheel zoom;
  pinned name column + scroll-synced ruler; **status-bar readout** (hover →
  `ui/hover.ts` `computeHover` → column + ungapped position + residue, gap → "—",
  never "length" — the first UI exercise of the col→ungapped parity logic). A
  floating hover tooltip was built then dropped by request — the readout lives
  only in the bottom status bar; a **zoom indicator** (`N px/cell · tier`) sits at
  the right of the status bar. **Perf fixture** landed: `align-cli generate
  <rows> <cols> <out.fasta> [gap_pct]` (bytes straight to a file from Rust — not
  stdout, which PowerShell would corrupt to UTF-16LE+BOM; SplitMix64, no `rand`
  dep; gitignored `fixtures/generated/`). **Manual fps smoke passed** (human at
  `tauri dev`, 2026-06-22): 10k×10k loads, panning smooth by observation across
  all tiers incl. the zoomed-out density tier; **fps not numerically measured**
  (no meter that run) — target met by observation, not a number; no-per-frame-IPC
  + single-canvas confirmed in source. NB **10k×10k is the stress ceiling, not the
  design target** — the program isn't aimed at that many sequences. Remaining:
  track lane, minimap, keyboard/scrollbar scroll. Plan/context/tasks in
  `docs/plans/m2-*`.

## Dev-docs

Per work batch, keep `docs/plans/<batch>-{plan,context,tasks}.md` current:
the accepted plan, key files/decisions, and the remaining checklist. Update them
(and this file) at the end of a batch, before committing.
