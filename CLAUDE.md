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
- **M1 next** — full data model, messy-FASTA polish, `Alignment`, composition
  stats, native file-open dialog. See `docs/plans/`.

## Dev-docs

Per work batch, keep `docs/plans/<batch>-{plan,context,tasks}.md` current:
the accepted plan, key files/decisions, and the remaining checklist. Update them
(and this file) at the end of a batch, before committing.
