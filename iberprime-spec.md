# IberPrime — Specification (Claude Code handoff)

> Working name. A cross‑platform, open‑source viewer/editor for **multiple sequence alignments (MSA)** of DNA, RNA, and protein sequences. Runs as a **native desktop application** (Windows / macOS / Linux) built with Tauri — a webview UI driven by a native Rust core.

This document is the build brief. It locks the stack, fixes the architecture, defines the data model and algorithms, and sequences the work into milestones with acceptance criteria. Defaults are marked **DECISION**; remaining open forks are listed at the end under *Decisions to confirm*.

> **Target:** desktop only. There is no web build, so the Rust core is called **natively** via Tauri IPC — no WASM, no Web Workers.

---

## 1. Goal & scope

Build a tool to **align, visually compare, edit, and analyze** sets of homologous sequences — the space occupied by Jalview, AliView, SeaView, and UGENE. The primary objects are alignments of **tens to a few thousand sequences × hundreds to a few thousand columns**.

### In scope
- Import sequences (FASTA first), view them as a colored alignment grid, pan/zoom/scroll.
- Pairwise alignment (interactive, in‑engine) and multiple sequence alignment (via external aligners).
- Difference visualization against a reference or consensus; conservation tracks.
- Manual editing (gaps, reorder, rename, hide) with undo/redo.
- Analyses: consensus, per‑column conservation (entropy/identity), pairwise identity matrix, basic composition stats.
- Export to alignment formats and publication figures (SVG/PNG).
- Project save/load.

### Non‑goals / guardrails (do **not** drift into these)
- **Do not implement MSA heuristics from scratch.** Optimal MSA is NP‑hard; integrate MAFFT / MUSCLE / Clustal Omega as external processes. Hand‑written alignment code is limited to *pairwise* (NW/SW).
- **Do not implement ML phylogenetics from scratch.** If trees are added, shell out to FastTree / IQ‑TREE.
- **No read‑mapping / SAM‑BAM‑CRAM / variant‑calling pipeline in the MVP.** (Possible later mode; out of scope now.)
- **Never render the alignment as one DOM element per cell.** Use a virtualized canvas. (See §6.)
- **No WASM and no web build.** Desktop only; the core runs as native Rust behind Tauri commands.

---

## 2. Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Core engine | **Rust** | Pure, UI‑free. Parsing, data model, pairwise alignment, analyses, I/O. Runs as **native** code. |
| Bio algorithms | **`rust-bio`** (MIT) | Reuse parsers/alignment primitives where they fit; wrap rather than re‑derive. |
| Parallelism | **`rayon`** | All‑pairs identity matrix and other column/row‑parallel work on native threads. |
| Desktop shell | **Tauri v2** | Webview UI + native Rust backend; produces small native binaries incl. `.exe`. |
| Core ↔ UI | **Tauri IPC** (`invoke`, async `#[tauri::command]`) | Coarse‑grained calls (load, align, analyze, edit, export). Binary payloads for sequence data. |
| Frontend | **TypeScript + React + Vite** — **DECISION** | React maximizes ecosystem/library support. Svelte/Solid are acceptable swaps; nothing below depends on the framework except component files. |
| Frontend state | **Zustand** — **DECISION** | View/UI state only (viewport, selection, color scheme). The authoritative alignment lives in Rust, not in component state. Avoid Redux. |
| Rendering | **Canvas 2D** (MVP) → **WebGL via `pixi.js`** (scale path) | Behind one renderer interface so the backend is swappable. Draws from an in‑memory byte buffer; no IPC per frame. |
| Plots/trees | **d3** | Identity heatmap, conservation bars, future tree view. |
| License | **Apache‑2.0** — **DECISION** | Patent grant + permissive. MIT acceptable if simplicity preferred. See §11. |

---

## 3. Architecture

A clean split between a **native compute core** (Rust) and a **render/UI layer** (TS, in the webview) keeps heavy work off the UI thread. Because there is no web target, the frontend calls the core directly through Tauri IPC — no WASM bridge, no Worker.

```
┌─────────────────────────────────────────────────────────────┐
│ Webview  (TypeScript + React + Vite)                          │
│  • render/   virtualized grid (Canvas2D → WebGL)              │
│              draws from an in‑memory Uint8Array — no IPC/frame │
│  • model/    TS mirror types, coordinate helpers, selection   │
│  • state/    Zustand stores (viewport, selection, scheme)     │
│  • ipc/      typed wrappers over Tauri `invoke`  ◄── the seam  │
└───────────────────────────▲───────────────────────────────────┘
                            │ Tauri IPC: async commands, binary payloads
┌───────────────────────────┴───────────────────────────────────┐
│ src-tauri  (native Rust process)                               │
│  • commands:  load · align · msa · consensus · conservation ·  │
│               identity_matrix · edit · undo/redo · export …    │
│  • state:     Mutex<AppState> owns the authoritative Alignment │
│               + the undo/redo command stack                    │
│  • compute:   async + rayon for heavy work (all‑pairs, etc.)   │
│  • plugins:   fs · dialog · shell ;  MAFFT sidecar binary      │
│        └────────────── calls ─────────────►  align-core        │
│                                              (pure Rust engine)│
└─────────────────────────────────────────────────────────────┘
```

### The seam: calling the core
The frontend talks to the core through **one typed IPC layer** (`ipc/`), thin wrappers over Tauri `invoke`. There is a single backend (native Rust); the multi‑implementation abstraction the web design needed is gone.

- Heavy operations are **async `#[tauri::command]`s** that run on a background thread (Tauri's async runtime; use `rayon` inside for data‑parallel work like the all‑pairs identity matrix). The UI never blocks.
- Coarse calls only: parse a file, align two sequences, run MSA, compute consensus/conservation/identity, apply an edit, export. There is **no per‑keystroke or per‑frame** Rust call.

### State ownership & data flow (important)
- **Rust owns the authoritative `Alignment` and the undo/redo stack**, held in Tauri managed state (`tauri::State<Mutex<AppState>>`).
- **The frontend holds a render‑buffer copy** — a flat `Uint8Array` of the gapped matrix (rows × width) — and draws the visible window from it directly. A 2000×2000 alignment is ~4 MB; even a few‑thousand‑squared one is tens of MB, fine to hold in memory and cheap to redraw. Rendering touches only this JS buffer, so panning/zooming costs **zero IPC**.
- IPC happens only on **coarse events**: on load/align/MSA, Rust returns the new matrix (binary) → frontend replaces its buffer; on edit, Rust applies the command to authoritative state and returns the **changed rows** (or full matrix for small inputs) → frontend patches its buffer; per‑column tracks (consensus, conservation) are computed once in Rust, cached, and returned as arrays (size = width, modest).

This is simpler and faster than shuttling buffers across a WASM/Worker boundary, and it removes a class of state‑sync bugs by keeping one source of truth in Rust.

### Repository layout
```
alignstudio/
├── Cargo.toml                 # cargo workspace
├── crates/
│   ├── align-core/            # engine: parse, model, align, analyze, io
│   │   ├── src/{lib,model,parse,align,analyze,io,coords,edit}.rs
│   │   └── tests/             # incl. messy-FASTA fixtures, proptests
│   └── align-cli/             # optional: headless CLI over align-core (great for scripted tests)
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json        # scoped capabilities; sidecar config
│   └── src/
│       ├── main.rs            # builder, managed state, command registration
│       ├── commands.rs        # #[tauri::command] wrappers over align-core
│       └── state.rs           # AppState: Alignment + undo/redo stack
├── frontend/
│   ├── src/{render,model,state,ipc,ui}/
│   └── package.json
├── fixtures/                  # sample alignments (small + large)
├── LICENSE  NOTICE  README.md
└── .github/workflows/ci.yml   # build desktop binary, run tests
```

---

## 4. Data model

The single largest source of bugs in alignment tools is mixing up **three coordinate spaces**. Nail this abstraction first.

1. **Ungapped sequence position** — index into a sequence's real residues (what features/annotations anchor to).
2. **Alignment column index** — column in the gapped matrix (shifts whenever anyone edits gaps).
3. **Screen pixel** — derived from column index, zoom, and scroll (render concern only; §6).

### Core Rust types (sketch — refine as needed)
```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Alphabet { Dna, Rna, Protein }

pub type SeqId = u32;

/// A raw, ungapped sequence.
pub struct Sequence {
    pub id: SeqId,
    pub name: String,
    pub description: String,
    pub alphabet: Alphabet,
    pub residues: Vec<u8>,        // ungapped, uppercase ASCII; IUPAC codes allowed
}

/// One row of an alignment.
pub struct AlignedRow {
    pub seq_id: SeqId,
    pub gapped: Vec<u8>,          // residues interspersed with b'-'; len == width
    col_to_pos: OnceCell<Vec<i32>>, // lazy: column -> ungapped pos, or -1 at a gap
    pos_to_col: OnceCell<Vec<u32>>, // lazy: ungapped pos -> column
}

pub struct Alignment {
    pub width: usize,
    pub rows: Vec<AlignedRow>,
    consensus: OnceCell<Vec<u8>>,    // cached; invalidated on edit
    conservation: OnceCell<Vec<f32>>,// cached per-column score
}
```

### Representation decision — **DECISION**
Store each row as a **gapped byte vector** (`Vec<u8>` with `b'-'`), plus a **lazily built prefix index** (`col_to_pos` / `pos_to_col`) for coordinate mapping. Rebuild the index lazily after edits; invalidate consensus/conservation caches on edit. This is O(1) column access, trivial to render, and comfortably handles *thousands × few‑thousand*. (A run‑length gap map scales further but is not worth the complexity for the MVP; revisit only if profiling demands it.)

### Coordinate API (must round‑trip)
```rust
impl AlignedRow {
    pub fn col_to_seq_pos(&self, col: usize) -> Option<usize>; // None at a gap
    pub fn seq_pos_to_col(&self, pos: usize) -> usize;
}
```
Property test invariant: for every non‑gap column `c`, `seq_pos_to_col(col_to_seq_pos(c)) == c`.

### Features / annotations
A `Feature { seq_id, start, end, kind, label, color }` anchors to **ungapped positions**. The render layer maps these to columns at draw time via `seq_pos_to_col`, so features survive edits automatically.

### Editing as commands (undo/redo)
Every mutation is a reversible command applied to the authoritative `Alignment` in Rust:
```rust
pub enum EditCmd {
    InsertGap { rows: RowSel, col: usize, count: usize },
    DeleteGap { rows: RowSel, col: usize, count: usize }, // only over gaps
    SlideResidues { row: usize, range: Range<usize>, delta: i32 }, // across adjacent gaps
    ReorderRows { from: usize, to: usize },
    RenameSeq { seq_id: SeqId, name: String },
    SetRowHidden { seq_id: SeqId, hidden: bool },
    DeleteSeq { seq_id: SeqId },
}
```
A command stack in `AppState` provides undo/redo; each `apply` returns its inverse. Editing invalidates the affected lazy indexes and caches, and the command returns the changed rows so the frontend can patch its render buffer.

---

## 5. Algorithms (in‑engine)

### Pairwise alignment — implement in `align-core`
- **Global:** Needleman–Wunsch. **Local:** Smith–Waterman. Both with **affine gaps (Gotoh)**: `gap_open`, `gap_extend`.
- **Scoring:** DNA → match/mismatch (default `+2`/`−1`) or a substitution matrix; protein → **BLOSUM62** default (also ship PAM250, BLOSUM45/80).
- **Output:** aligned pair, score, %‑identity, alignment length.
- **Complexity:** O(nm) time/space; acceptable interactively for typical inputs. Add an optional **banded** variant later for long, similar sequences.

### Multiple sequence alignment — external (do not implement)
- Invoke **MAFFT** (BSD — default), optionally **MUSCLE v5** / **Clustal Omega** if present (GPL — see §11). Detect availability on PATH or run as a bundled **sidecar**; disable MSA actions gracefully when no binary is found.
- Stream input as temp FASTA → parse aligned FASTA back into an `Alignment`. Run on a background thread so the UI stays responsive.

### Analyses — implement in `align-core`
- **Consensus:** most frequent residue per column; configurable threshold and tie handling; optional IUPAC ambiguity codes for DNA/RNA.
- **Conservation:** per‑column **Shannon entropy** and/or **% identity to consensus** (selectable). Drives the conservation track and color‑by‑conservation.
- **Pairwise identity matrix:** all‑pairs %‑identity over aligned columns → heatmap. Parallelize with `rayon`.
- **Composition:** GC content (DNA/RNA), length distribution, gap fraction per sequence/column.

---

## 6. Rendering (the make‑or‑break module)

An alignment is a 2D grid that can reach millions of cells. **Render only the visible window**, drawing from the in‑memory byte buffer (no IPC per frame).

### Requirements
- **Virtualization:** draw the visible row/column window plus a small overscan; nothing more.
- **Two renderers behind one interface:** `Canvas2D` (MVP) and `WebGL`/`pixi.js` with a glyph texture atlas (scale path). Swap without touching grid logic.
- **Level of detail by zoom:**
  - Zoomed in → colored cell + residue letter.
  - Mid → colored cell, no letter.
  - Zoomed out → per‑column density/coverage strip.
- **Fixed chrome:** left **sequence‑name** column and top **position ruler**, both pinned while the grid scrolls.
- **Synchronized minimap** reflecting the current viewport.
- **Tracks above the grid:** ruler, consensus row, conservation/entropy bar, optional feature track — all column‑aligned with the grid.

### Color schemes
Nucleotide scheme; protein schemes (Clustal, Zappo, hydrophobicity); **color‑by‑conservation**; **color‑by‑identity‑to‑reference**. Ship a **colorblind‑safe palette** and make it the default option.

### Interactions
Pan (drag / wheel‑scroll), zoom (ctrl/⌘‑wheel or pinch), selection (cell / column / row / rectangular range), hover tooltip (sequence name, ungapped position, residue), copy selection to clipboard (as FASTA or raw block).

### Difference mode
Pick a **reference** (a chosen sequence or the consensus). Matches are dimmed or shown as a dot (`.`, the Clustal convention); mismatches are highlighted. For "selected few," restrict to the selection and recompute consensus/diff within just that subset.

### Performance
- Per‑frame rendering reads only the in‑memory `Uint8Array`; **no IPC during pan/zoom**.
- Heavy compute is delegated to **async Tauri commands on background threads** (rayon inside). Results return as binary blobs / arrays and update the buffer or tracks.
- Cache consensus/conservation in Rust; invalidate on edit. Never recompute on every frame.

---

## 7. File formats & parsing

### Read
**FASTA** (priority) and aligned FASTA; **Clustal `.aln`**, **Phylip**; later **Stockholm**, **GenBank**; **GFF/GFF3** for features.

### Write
Aligned FASTA, Clustal, Phylip; **SVG** and **PNG** figure export; **project file** (JSON) capturing sequences + edit history (or final state) + view settings.

### Tolerant FASTA parser (must handle real‑world mess)
Mixed line endings (LF/CRLF/CR); **IUPAC ambiguity codes** (N, R, Y, …); lowercase soft‑masking (preserve, normalize for analysis); **U vs T** (RNA vs DNA); gaps as `-` or `.`; stop codons `*`; blank lines and comment lines; duplicate names (disambiguate, warn); **streaming** for large files — native file reads make this straightforward, so never slurp multi‑gigabyte inputs whole.

---

## 8. Editing UX

Insert/delete gap at a column for a single row or a block/all rows; slide residues across adjacent gaps; reorder sequences (drag); rename; hide/show; delete sequence; ("realign selection" later, needs an aligner). All edits flow through the command stack (§4) in Rust for **undo/redo**, return the changed rows to the frontend, and features remap automatically via the coordinate API.

---

## 9. Desktop (Tauri v2)

- `tauri.conf.json` with **scoped capabilities only**: `fs` (read for open), `dialog` (open/save), `shell` (invoke aligners against a fixed command allowlist). No broad permissions.
- Native open/save dialogs.
- **External aligners:** detect MAFFT/MUSCLE/Clustal Omega on PATH, or ship MAFFT as a **sidecar** binary. If none found, disable MSA actions with a clear message and a link to install instructions.
- `tauri build` produces `.exe` (NSIS/MSI), `.dmg`, and AppImage/`.deb`.

---

## 10. Testing

- **Rust unit tests** in `align-core`: parser against messy fixtures; NW/SW correctness vs known hand‑worked cases; consensus/entropy on toy inputs; format round‑trips (read→write→read).
- **Property tests (`proptest`):** coordinate round‑trip invariant; `apply(cmd)` then `apply(inverse)` restores state exactly.
- **`align-cli`** doubles as an integration harness — run end‑to‑end (parse → align → analyze → export) headlessly in CI without the webview.
- **Frontend:** component tests for grid math (viewport→cell, selection); a few golden‑image render tests if feasible.
- **Fixtures:** small alignments for correctness, one large alignment (≈thousands × thousands) for render/perf checks.

---

## 11. Licensing (decide once, then enforce)

- Project license: **Apache‑2.0** (or MIT). `rust-bio`, `rayon`, Tauri, pixi, d3 are permissive — fine.
- **MAFFT** is BSD‑like → safe to bundle as a sidecar.
- **MUSCLE / Clustal Omega are GPL.** Invoking them as a **separate process** is generally fine and keeps your code permissive; **bundling or linking** GPL code can impose copyleft on your project. **Keep GPL tools out of the default bundle** — detect/invoke only, and document that users install them. Maintain a `NOTICE` file listing third‑party licenses.

---

## 12. Milestones (build order with acceptance criteria)

Each milestone should land behind green CI that builds the desktop binary and runs the test suite.

- **M0 — Scaffolding.** Cargo workspace; `align-core` skeleton; `src-tauri` app with managed state and one async command; Vite + React UI that invokes it; CI builds the desktop binary and runs `cargo test`.
  *Done when:* an async Tauri command round‑trip (e.g. `parse_summary`) works from the React UI in the **built desktop app**.

- **M1 — Model + parsing + coordinates.** Data model; tolerant FASTA parser; `Alignment`; coordinate API with proptests; composition stats. UI loads a file (native dialog) and shows sequence count, lengths, alphabet.
  *Done when:* messy‑FASTA fixtures parse correctly and the coordinate round‑trip property passes.

- **M2 — Rendering MVP.** Canvas2D virtualized grid drawing from the in‑memory buffer; pinned name column + ruler; nucleotide coloring; pan/zoom/scroll; hover tooltip; minimap.
  *Done when:* a thousands×thousands fixture scrolls smoothly (target ≥ ~45–60 fps) with no DOM‑per‑cell and no per‑frame IPC.

- **M3 — Pairwise alignment.** NW + SW with affine gaps in core; exposed as an async command; result viewable in the grid; %‑identity reported.
  *Done when:* hand‑worked test cases match expected alignment + score.

- **M4 — Compare & analyze.** Consensus row; conservation track (entropy/identity); reference/consensus **difference mode**; pairwise identity **heatmap** (rayon‑parallel); subset selection drives consensus/diff.
  *Done when:* difference mode against a reference matches the consensus track, and subset recompute is correct.

- **M5 — Editing & I/O.** Gap insert/delete, reorder, rename, hide via the Rust command stack with undo/redo; changed‑rows patching of the render buffer; feature remapping; project save/load (JSON); export aligned FASTA/Clustal/Phylip.
  *Done when:* edit→undo→redo is lossless (proptest) and a saved project reopens identically.

- **M6 — MSA + figures.** Shell out to **MAFFT** (sidecar/PATH) for MSA on a background thread, with graceful handling when the binary is absent; **SVG/PNG** figure export.
  *Done when:* a user aligns a FASTA via MAFFT end‑to‑end and exports a publication figure.

- **M7 — Advanced (optional, post‑MVP).** WebGL/pixi renderer for very large alignments; phylogenetic tree (FastTree/IQ‑TREE) with a linked, collapsible tree view; sequence logos (information content per column); variant/SNP table with VCF export; plugin/scripting API; optional read‑mapping mode.

**MVP = M0–M5** (desktop binary, pairwise alignment, compare, edit, export). **M6** adds real MSA via MAFFT.

---

## 13. Suggested first commit for Claude Code

1. Initialize the cargo workspace, `frontend/` (Vite + React + TS), and `src-tauri/`.
2. `align-core`: define `Alphabet`, `Sequence`, `AlignedRow`, `Alignment`, and the coordinate API as **stubs with `todo!()`** plus the proptest skeleton (red).
3. `src-tauri`: set up `AppState` in managed state (`Mutex<AppState>`, may start empty) and an async command `parse_fasta(bytes) -> Summary { count, alphabet, max_len }` calling (stubbed) `align-core`; register it in the handler.
4. `frontend/ipc`: a typed `invoke` wrapper, and a screen that opens a file via the Tauri dialog, reads bytes, calls `parse_fasta`, and shows the summary.
5. CI: build the desktop binary and run `cargo test`.

---

## Decisions to confirm

Defaults are chosen above so work can start regardless; flag any you'd change:

1. **Frontend framework** — defaulted to **React + TS**. Prefer **Svelte** (lighter, faster) or **Solid**? Only the `ui/` and `render/` component files are affected.
2. **Project license** — defaulted to **Apache‑2.0**. Prefer **MIT**?
