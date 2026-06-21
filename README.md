# Iberalign

A cross-platform, open-source desktop **viewer/editor for multiple sequence
alignments (MSA)** of DNA, RNA, and protein sequences — the space occupied by
Jalview, AliView, SeaView, and UGENE. Built with **Tauri v2**: a webview UI
(React + TypeScript) driven by a native **Rust** core.

> **Status: M0 — scaffolding.** The workspace builds, the engine has a tolerant
> FASTA parser + coordinate API (property-tested), and a `parse_summary` command
> round-trips from the React UI to the native core over Tauri IPC. Subsequent
> milestones (rendering, pairwise alignment, analyses, editing, MSA) are tracked
> in [`iberprime-spec.md`](./iberprime-spec.md) §12 and `docs/plans/`.

## Why native + Rust

The authoritative alignment and undo/redo stack live in Rust (single source of
truth); the frontend holds only a render-buffer copy and view state. Panning and
zooming cost **zero IPC** — the grid draws from an in-memory byte buffer. Heavy
work (parsing, pairwise alignment, all-pairs identity) runs on background threads
via async Tauri commands. See the spec for the full architecture.

## Tech stack

| Layer        | Choice                                  |
|--------------|-----------------------------------------|
| Core engine  | Rust (`crates/align-core`)              |
| Desktop shell| Tauri v2 (`src-tauri/`)                 |
| Frontend     | TypeScript + React + Vite (`src/`)      |
| Frontend state| Zustand (view/UI state only)           |
| Rendering    | Canvas 2D (MVP) → WebGL/pixi.js (scale) |
| License      | Apache-2.0                              |

## Repository layout

```
Iberalign/
├── Cargo.toml            # Rust workspace (engine crates + Tauri shell)
├── crates/
│   ├── align-core/       # pure engine: parse, model, coords, align, analyze, io
│   └── align-cli/        # headless CLI over align-core (CI integration harness)
├── src-tauri/            # Tauri v2 app: commands, managed state
├── src/                  # React frontend: {ipc,model,render,state,ui}/
├── fixtures/             # sample alignments
├── docs/plans/           # dev-docs: plan / context / tasks per work batch
└── iberprime-spec.md     # the full build brief
```

> **Layout note:** the spec sketches the frontend under a `frontend/` directory.
> We keep the JS project at the repo root (where the Tauri CLI runs and
> `beforeDevCommand` executes) — the idiomatic Tauri layout that avoids fighting
> the CLI's project-root assumptions. The spec's module separation is preserved
> via `src/{ipc,model,render,state,ui}/`.

## Prerequisites

- **Rust** (stable, ≥ 1.80) — https://rustup.rs
- **Node.js** ≥ 20 and npm
- Platform webview: WebView2 (Windows, preinstalled on Win11), WebKitGTK
  (Linux: `libwebkit2gtk-4.1-dev` + `libgtk-3-dev`), WKWebView (macOS).
- Optional, for MSA later: `mafft` on PATH.

## Develop

```bash
npm install                # install frontend deps
npm run tauri dev          # launch the desktop app (hot-reloads the UI)

# Engine only (fast iteration, no GUI):
cargo test --workspace     # run all Rust tests
cargo run -p align-cli -- summary fixtures/sample.fasta

# Frontend only:
npm run typecheck
npm run build
```

## Build a desktop binary

```bash
npm run tauri build        # produces .exe/.msi (Win), .dmg (macOS), AppImage/.deb (Linux)
```

## Contributing

All edits to alignment state flow through the Rust command stack (undo/redo).
Do not implement MSA or phylogenetics heuristics from scratch — integrate
external tools. Never render one DOM element per cell. See
[`CLAUDE.md`](./CLAUDE.md) for working conventions and the spec for the rationale.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
