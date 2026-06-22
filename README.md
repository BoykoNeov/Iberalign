# Iberalign

**Iberalign is a free, open-source desktop app for viewing and editing multiple
sequence alignments (MSA)** — the DNA, RNA, and protein alignments produced by
tools such as MAFFT, MUSCLE, or Clustal Omega. It aims to be a fast, native,
cross-platform alternative to Jalview, AliView, SeaView, and UGENE, and runs on
Windows, Linux, and macOS.

> **Early development.** Today Iberalign can open a FASTA alignment and let you
> explore it as a fast, zoomable grid. Editing, building alignments, and
> sequence analyses are on the way. The app currently **runs from source** (see
> *Start Iberalign* below) — a one-click installer will ship with a later
> release.

## What you can do today

- **Open** a FASTA alignment file.
- **Explore** it as a smooth, zoomable grid — coloured residues up close, a
  zoomed-out overview for the whole alignment — and it stays fluid even for very
  large files.
- **Read coordinates while you hover:** the status bar shows the alignment
  column and the sequence position under the cursor, the residue there, and the
  current zoom level.

## Start Iberalign

Iberalign builds itself from source the first time you run it, so two free tools
need to be installed first:

| You need | Where to get it |
|----------|-----------------|
| **Node.js**, version 20 or newer | https://nodejs.org |
| **Rust** | https://rustup.rs |

**On Linux** you also need the system webview packages. On Debian or Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev build-essential curl
```

Then start the app with the single launcher file in this folder — **one file
works on every platform**:

- **Windows** — double-click **`start.cmd`** (or type `start.cmd` in a terminal).
- **Linux / macOS** — run **`sh start.cmd`** in a terminal
  (or, once, `chmod +x start.cmd` and then `./start.cmd`).

The launcher checks that Node.js and Rust are installed — and tells you exactly
where to get anything that's missing — installs the user-interface packages the
first time, then opens Iberalign.

> **The first launch takes a few minutes** while it compiles the engine. That is
> normal and happens only once; a window opens when it is ready, and later
> launches are quick. To quit, just close the app's window.

## License

Apache-2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

---

## For developers

The launcher above wraps the standard developer commands; you can also run them
directly. Working conventions live in [`CLAUDE.md`](./CLAUDE.md) and the full
build brief is [`iberprime-spec.md`](./iberprime-spec.md).

### How it's built

Iberalign is a **Tauri v2** app: a webview UI (React + TypeScript) driven by a
native **Rust** core. The authoritative alignment and undo/redo stack live in
Rust (one source of truth); the frontend holds only a render-buffer copy and
view state. Panning and zooming cost **zero IPC** — the grid draws from an
in-memory byte buffer — and heavy work (parsing, pairwise alignment, all-pairs
identity) runs on background threads via async Tauri commands.

| Layer          | Choice                                   |
|----------------|------------------------------------------|
| Core engine    | Rust (`crates/align-core`)               |
| Desktop shell  | Tauri v2 (`src-tauri/`)                  |
| Frontend       | TypeScript + React + Vite (`src/`)       |
| Rendering      | Canvas 2D (MVP) → WebGL/pixi.js (scale)  |
| License        | Apache-2.0                               |

### Repository layout

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
├── start.cmd             # cross-platform launcher (sh/cmd polyglot — keep LF)
└── iberprime-spec.md     # the full build brief
```

The JS project lives at the repo root (where the Tauri CLI runs), which is the
idiomatic Tauri layout; the spec's module separation is preserved via
`src/{ipc,model,render,state,ui}/`.

### Common commands

```bash
npm install                # install frontend deps
npm run tauri dev          # launch the desktop app (hot-reloads the UI)

# Engine only (fast iteration, no GUI):
cargo test --workspace     # run all Rust tests
cargo run -p align-cli -- summary fixtures/sample.fasta

# Frontend only:
npm run typecheck
npm run build

# Package a desktop binary:
npm run tauri build        # .exe/.msi (Win), .dmg (macOS), AppImage/.deb (Linux)
```

> `start.cmd` is a single file that is **both** a Windows batch script and a
> POSIX shell script (a polyglot). It must stay LF-only — `.gitattributes` pins
> it, because the shell half won't parse with CRLF endings.

### Contributing

All edits to alignment state flow through the Rust command stack (undo/redo). Do
not implement MSA or phylogenetics heuristics from scratch — integrate external
tools (MAFFT/MUSCLE/Clustal Omega; FastTree/IQ-TREE). Never render one DOM
element per cell. See [`CLAUDE.md`](./CLAUDE.md) for conventions and the spec for
the rationale.
