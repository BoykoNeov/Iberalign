# M2 — Context

Key files, current state, and decisions a session needs to execute M2. Pairs
with `m2-plan.md` (the why) and `m2-tasks.md` (the checklist).

## Starting point (what M1 left)

### Backend (authoritative — do not duplicate truth in the frontend)

- **`crates/align-core/src/model.rs`** — `Dataset { alignment: Alignment,
  sequences: Vec<Sequence> }`, aligned by index (`sequences[i]` ↔
  `alignment.rows[i]`). `Alignment { width, rows: Vec<AlignedRow> }`;
  `AlignedRow { seq_id, gapped: Vec<u8> }` (`len == width`, gap = `b'-'`);
  `Sequence { id, name, description, alphabet, residues }` (ungapped, case
  preserved). This is the data M2 ships to the frontend.
- **`crates/align-core/src/coords.rs`** — `AlignedRow::col_to_seq_pos(col) ->
  Option<usize>` (None at a gap), `seq_pos_to_col(pos) -> usize`; round-trip
  proptest in `tests/coords_proptest.rs`. **This is the authority the JS
  col→ungapped mirror must match** (Decision 5).
- **`src-tauri/src/state.rs`** — `AppState { dataset: Option<Dataset> }` behind
  `Mutex` in managed state. Already holds everything M2 needs to serve.
- **`src-tauri/src/commands.rs`** — `parse_summary(bytes)` and
  `load_alignment(path)`, both returning `SummaryDto` (JSON). Both `store()` the
  built `Dataset` into `AppState`. **M2 adds a render-buffer command here.**
  Note the `parse_summary` comment: `Vec<u8>` over IPC serializes as a JSON
  `number[]` — the anti-pattern M2's buffer command must NOT repeat.
- **`src-tauri/Cargo.toml`** — Tauri **2.11.3**, `tauri-plugin-dialog`, serde,
  serde_json. No new Rust dep expected for M2 (binary response is core Tauri).
- **`src-tauri/capabilities/default.json`** — `core:default` + `dialog:allow-open`
  only. **M2 adds nothing here** (app-defined commands need no capability).

### Frontend (minimal — M2 builds most of it)

- **`src/ui/App.tsx`** — M1 demo: textarea → `parseSummary`, "Open file…" →
  dialog → `loadAlignment` → summary table + warnings. M2 keeps the open/load
  flow and, on a successful load, fetches the render buffer and mounts the grid.
- **`src/ipc/commands.ts`** — the ONLY `invoke` caller. Typed wrappers
  `parseSummary` / `loadAlignment` returning `Summary`. **M2 adds the
  render-buffer wrapper(s) here** (binary + metadata).
- **`src/ui/App.css`** — single stylesheet. M2 adds grid/chrome layout styles.
- **`src/main.tsx`**, **`src/vite-env.d.ts`** — entry + Vite types; untouched.
- **No `src/render/`, `src/model/`, `src/state/` yet** — M2 creates them
  (CLAUDE.md's intended layout). `ipc/` stays the sole `invoke` seam.

## New files M2 creates (proposed)

- `src/model/` — TS types mirroring the wire DTO; the `AlignmentView` value
  object wrapping the buffer + metadata; the col→ungapped mapping (pure).
- `src/render/` — `Renderer` interface; `Canvas2DRenderer`; pure viewport /
  virtualization math (`viewport.ts` — visible-window, col↔pixel); color scheme
  (`colors.ts`, nucleotide + colorblind-safe palette); LOD tier selection.
- `src/state/` — the non-React store/refs for buffer + viewport (Decision 2);
  pan/zoom/scroll reducers as plain functions.
- `src/ui/` — grid container component, name column, ruler, minimap, status bar,
  tooltip. React renders chrome; the canvas draw loop is imperative.

## Decisions locked for M2 (see plan for rationale)

- **Binary buffer, once per load.** Flat row-major `Uint8Array`
  (`width × num_rows`), raw bytes via `tauri::ipc::Response` → `ArrayBuffer`,
  never JSON `number[]`, never per-frame IPC.
- **Buffer + viewport live in refs / a non-React store**, not `useState`. Draw
  loop on `requestAnimationFrame` reads refs; React renders chrome only. This is
  the fps guard.
- **Renderer behind a 2–3 method interface**; Canvas2D now, WebGL M7. Grid math
  stays out of draw calls.
- **LOD by cell px size:** letter ≥ ~8 px; block ~3–8 px; density < ~3 px.
  Square uniform cells (one zoom scalar). Tune against the fixture.
- **col→ungapped computed in JS**, gap→`null`, gaps excluded, surfaced 1-based;
  **must match `coords.rs`** and be cross-checked in a test (parity guard).
- **Absolute readout = raw column index** (`1..=width`); per-sequence ungapped
  position alongside; reference-relative coordinate deferred.
- **Scope:** read-only viewing. No selection/copy/edit (M5); no
  consensus/conservation/diff (M4 — track lane scaffolded, empty).
- **No new capability** in `default.json`.

## IPC shape (proposed — refine at implementation)

A new command serving the current `AppState.dataset`:

- **buffer**: `get_render_buffer() -> tauri::ipc::Response` — the flat
  `width × num_rows` gapped matrix as raw bytes (row-major). Errors if no
  dataset is loaded.
- **metadata**: either a second command `get_alignment_meta() ->
  AlignmentMetaDto` (JSON) or fold the dims into the existing load return.
  `AlignmentMetaDto { width, num_rows, names: Vec<String>, alphabet: String }`.
  (Names are needed for the pinned name column; alphabet drives the color
  scheme.)

Open at implementation: whether `load_alignment` returns the meta directly (one
round-trip) and the buffer is a follow-up fetch, vs. two explicit getters. Lean
toward load → meta in the existing return, buffer as a dedicated binary fetch.

## Pure functions to extract + unit-test (the real test surface)

Canvas drawing is not unit-testable in CI (jsdom has no canvas); acceptance is a
manual fps smoke. What IS testable and must be pure TS:

- **Visible-window math** — given viewport (scroll, cell size, canvas size) →
  `[firstRow, lastRow] × [firstCol, lastCol]` plus overscan. Off-by-one here is
  a real, catchable defect.
- **col ↔ pixel** round-trip.
- **col → ungapped position** — the parity-guarded mirror of `coords.rs`.
- **LOD tier selection** — cell px → tier.

## Gotchas / toolchain

- **Tauri 2.11.3**, **React 19**, `@tauri-apps/api` v2, Vite 7, TS ~5.8. Node 24.
- `generate_context!` embeds `../dist` — build the frontend before a raw
  `cargo build` of the shell (carried from M0/M1).
- src-tauri `[lib] name = "iberalign_lib"`; `main.rs` calls
  `iberalign_lib::run()`.
- Engine stays **serde-free**; the new DTO + binary command live in `src-tauri`.
- `ipc/commands.ts` is the only `@tauri-apps/api` importer — keep it that way.
- **No real-canvas tests in CI.** Don't add a jsdom canvas test that can't fail
  for a real defect (violates the project's test ethos); test the pure math.
- **Perf fixture is generated, not committed.** A thousands×thousands FASTA is
  multi-MB — do not check it into git. Generate it (an `align-cli generate`
  subcommand, or a tiny script) for the local fps smoke.
