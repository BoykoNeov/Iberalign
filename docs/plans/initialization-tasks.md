# Initialization — Tasks

## Done (M0)

- [x] Cargo workspace + `align-core` (model, coords, tolerant FASTA parser, io)
- [x] `align-cli` headless harness (`summary` subcommand)
- [x] Coordinate round-trip proptest + parser tests (7 tests green)
- [x] Tauri v2 baseline generated and restructured into the workspace
- [x] `parse_summary` async command + `Mutex<AppState>` managed state
- [x] Typed `ipc/commands.ts` + M0 demo UI
- [x] Minimal scoped capabilities (`core:default`)
- [x] `.gitignore`, `LICENSE` (Apache-2.0), `NOTICE`, `README`, `CLAUDE.md`
- [x] CI: ubuntu lint/test + windows desktop build
- [x] `.claude/settings.json` permission allowlist
- [x] dev-docs (plan/context/tasks)
- [x] Verified: fmt clean, clippy clean, workspace compiles+links, CLI correct
- [x] git init (main) → first commit → public repo
      (github.com/BoykoNeov/Iberalign) → push; **CI green** (both jobs)
- [ ] Manual smoke (user): `npm run tauri dev` → click "Parse FASTA" → summary
      shows (GUI can't be driven from this environment)

## Next (M1 — model + parsing + coordinates)

- [ ] Flesh out `Alignment` construction from parsed sequences (pad to width)
- [ ] Messy-FASTA polish: duplicate-name disambiguation + warnings, soft-mask
      preservation, `*` stop codons, streaming for large files
- [ ] Composition stats (GC content, gap fraction per seq/column, length dist)
- [ ] Native file-open dialog → add `dialog` + `fs` (read) capabilities
- [ ] UI: load a file, show sequence count / lengths / alphabet
- [ ] Property test: `apply(cmd)` then `apply(inverse)` restores state (prep edit)

## Backlog signposts

- M2 rendering MVP (virtualized Canvas2D) — the make-or-break module
- M3 pairwise NW/SW (Gotoh) in `align-core`
- M4 consensus / conservation / identity heatmap (rayon)
- M5 editing + undo/redo + project save/load + export
- M6 MAFFT sidecar + SVG/PNG figures
