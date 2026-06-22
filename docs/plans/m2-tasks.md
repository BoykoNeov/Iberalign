# M2 — Tasks (Rendering MVP)

Virtualized Canvas2D grid from the in-memory buffer. See `m2-plan.md` (why) and
`m2-context.md` (where things live).

**Status: in progress.** Backend render-buffer IPC + IPC wrapper + frontend
model/coords (parity-guarded) are landed and green; vitest added as the
pure-logic test runner. **Canvas core** (colors/glyphs/Renderer/Canvas2DRenderer
+ rAF loop) is landed and green (committed `f4cbff0`). **Grid container** (`ui/
Grid.tsx`: mounts the canvas, owns store/renderer/rAF loop, ResizeObserver on the
canvas cell, pan + zoom input) is landed and typecheck/build-green — not yet
imported (App wiring is its own task), so manual interaction/fps smoke is gated
on App wiring + the perf fixture. Remaining chrome (name col / ruler / track lane
/ minimap / status bar / tooltip), keyboard+scrollbar scroll, app-wiring.

**Done when** (spec §12): a thousands×thousands fixture scrolls smoothly
(≥ ~45–60 fps) with no DOM-per-cell and no per-frame IPC.

## Backend — render-buffer IPC

- [x] `AlignmentMetaDto { width, num_rows, names, alphabet }` (JSON) — chose a
      dedicated `get_alignment_meta` getter (works regardless of load path).
      Names in row order; `alphabet` is the `widen`-fold over per-seq alphabets,
      which matches `summarize`.
- [x] `get_render_buffer()` command → **raw bytes** via `tauri::ipc::Response`
      (flat row-major `width × num_rows` gapped matrix from `AppState.dataset`).
      Errors cleanly when no dataset is loaded. **Not** a JSON `number[]`.
- [x] Confirmed: `tauri::ipc::Response::new(Vec<u8>)` — `From<Vec<u8>> for
      InvokeResponseBody` maps to the `Raw` variant (verified in the 2.11.3
      source), `Response`'s own `IpcResponse` impl bypasses JSON, so JS `invoke`
      yields an `ArrayBuffer`. Both commands registered in `lib.rs`.
- [x] Confirmed **no** new `capabilities/default.json` entry (app-defined
      commands aren't webview-gated).

## IPC wrapper (the only `invoke` seam)

- [x] `src/ipc/commands.ts`: `getRenderBuffer(): Promise<Uint8Array>` (wraps the
      `ArrayBuffer`) and `getAlignmentMeta()` (snake→camel). `@tauri-apps/api`
      stays imported only here; `AlignmentMeta` lives in `model/types.ts`.

## Frontend model + state

- [x] `src/model/` — `types.ts` (domain `AlignmentMeta`), `view.ts`
      (`AlignmentView` with `cellAt`/`rowSlice`/`nameAt`; constructor asserts
      `buffer.length === width*numRows` so a transport mismatch fails loud).
- [x] `src/model/coords.ts` — `colToUngapped(view,row,col) -> number | null`
      and `isGap`, mirroring `coords.rs` (gap→null, gaps excluded, 1-based).
- [x] **Parity test** (`coords.test.ts`) — hand-worked column→position pairs
      derived straight from `coords.rs` (leading/interior/trailing-gap rows +
      gapless), plus a residue-count invariant. Guard against silent drift.
- [x] `src/state/` — non-React store/refs for **viewport** (`viewport.ts`:
      `Viewport` + pure `clamp`/`pan`/`resize`/`zoomAbout` reducers, CSS-px units;
      `store.ts`: `GridStore` holds viewport+dims+dirty, continuous-rAF-with-skip
      contract, every mutator marks dirty). **No `useState` for per-frame state.**
      Per advisor: the **buffer**/`view` lifts into App state (load is the only
      coarse event and it originates in a React handler), so the store owns only
      per-frame state and needs no subscribe machinery yet.

## Renderer

- [x] `src/render/viewport.ts` (pure) — visible-window math (first/last
      row+col + overscan, content-clamped), `colToX`/`xToCol`, `rowToY`/`yToRow`.
      **Unit-tested** (transform round-trip + window clamping/overscan).
- [x] `src/render/lod.ts` (pure) — cell px → tier (letter ≥ 8 / block 3–8 /
      density < 3). **Unit-tested** (boundary-pinned).
- [x] `src/render/colors.ts` — `ColorScheme` (fill/ink/background/densityStyle),
      `makeScheme` (256-entry CSS lookup tables, O(1) hot path), case-insensitive,
      gap/fallback handling. **Selectable**: registry + `registerScheme`/`getScheme`/
      `listSchemes`; custom palettes via `makeScheme` + `registerScheme`. Two
      schemes — **colorblind** (Paul Tol
      *bright*, CVD-safe, DEFAULT) and **classic** (A green/T·U red/C cyan/G
      magenta). Unit-tested (`colors.test.ts`). *(CVD-simulator pass = final QA.)*
- [x] `src/render/Renderer.ts` — thin interface `resize`/`draw`/`setColorScheme`/
      `dispose`. `setColorScheme` doc: caller must `store.markDirty()` to repaint.
- [x] `src/render/glyphs.ts` — `GlyphAtlas`: detached `<canvas>`, one device-res
      tile per printable byte at a **reference** size (max cell × dpr) so zoom
      never rebuilds; `drawImage`-blit per cell; re-ink only on scheme/dpr change.
- [x] `src/render/Canvas2DRenderer.ts` — visible-window draw per LOD tier in
      DEVICE px (seam-free `xs[i+1]-xs[i]` rounding): letter (run-merged fills +
      atlas glyph), block (run-merged fills), density (per-column occupancy bars,
      **occupancy chosen over averaged-color** → cache keyed by view only, so
      scheme switch never staleness-bugs it; **no** identity data). No per-cell DOM.
- [x] Draw loop on `requestAnimationFrame` (`src/render/loop.ts` `RenderLoop`):
      continuous-rAF-with-skip, draws only on `store.consumeDirty()`. Mechanism
      here; the grid container will own start/stop lifecycle (chrome task).

## Chrome (pinned, scroll-synced)

- [x] Grid container component (`ui/Grid.tsx` + `Grid.css`): mounts the canvas,
      owns the `GridStore`/`Canvas2DRenderer`/`RenderLoop` (refs, never React
      state), `ResizeObserver` on the **canvas cell** (viewW/viewH = drawing area,
      excludes chrome), wires pointer/wheel input. Outer `.grid-container` is a
      CSS grid that today renders only the canvas cell — chrome lands as child
      cells (no store lift). StrictMode-safe cleanup (nulls refs).
- [ ] **Name column** — pinned left, row names, scroll-synced vertically.
- [ ] **Position ruler** — pinned top, column ticks, scroll-synced horizontally.
- [ ] Empty **track lane** between ruler and grid — laid out, column-aligned,
      reserved for M4. No data.
- [ ] **Minimap** — whole-alignment overview: a **downsampled aggregate**
      (occupancy/averaged color per bucket, reusing the density reduction)
      computed once per load — not a scaled full draw. Viewport rectangle +
      click/drag to navigate; stays in sync with scroll/zoom.
- [ ] **Status bar** — `column N · ungapped pos M (seq name) · residue X` for the
      hovered cell; gap → "—" for position. (Memo: never label gapped width
      "length".)
- [ ] **Hover tooltip** — sequence name, ungapped position, residue at cursor.

## Interactions

- [x] **Pan** — drag (pointer capture) and wheel-scroll move the viewport via
      `store.pan` (mutate store → mark dirty; no setState). Wired in `Grid.tsx`.
- [x] **Zoom** — ctrl/⌘-wheel scales cell size about the cursor via `store.zoom`
      (clamped `MIN_CELL..MAX_CELL`, crosses LOD tiers). Non-passive native wheel
      listener so `preventDefault` suppresses page zoom. Wired in `Grid.tsx`.
- [ ] **Scroll** — keyboard/scrollbar; large alignments reachable to last
      row/col. (Lands with the chrome pass alongside the ruler/name column.)

## App wiring

- [x] `App.tsx` — on successful parse/open (both stash the dataset), fetch meta +
      buffer, build the `AlignmentView` **once** (held in state, not per render —
      else the grid's `[view]` effect resets scroll every render) and mount
      `<Grid>` in a flex:1 / min-height:0 grid area under a viewport-height flex
      shell (the definite-height ancestor `Grid`'s `height:100%` resolves against).
      Open/parse kept as a header bar; summary condensed to a status strip;
      "Close" returns to the landing. Grid is read-only. Typecheck/build-green;
      **manual render smoke still pending** (needs `npm run tauri dev`).

## Perf fixture (acceptance gate)

- [ ] A **generated** thousands×thousands FASTA for the fps smoke — an
      `align-cli generate <rows> <cols>` subcommand (preferred — CI-adjacent) or
      a small script. **Do not commit the large file** (gitignore it).

## Verify + wrap

- [ ] `npm run typecheck && npm run build` green; pure-math + parity unit tests
      green; `cargo test --workspace`, `cargo fmt --check`, clippy (`-D warnings`)
      clean; Tauri shell `cargo build -p iberalign` green.
- [ ] **Manual fps smoke** — load the generated fixture in `npm run tauri dev`;
      confirm smooth pan/zoom (≥ ~45–60 fps; check devtools/perf), tooltip +
      status readout correct, minimap synced, no per-frame IPC (watch the IPC
      log), no DOM-per-cell (inspect the DOM — one canvas, not N elements).
- [ ] Batch-end ritual: update `m2-*` docs + `CLAUDE.md` milestone status +
      memory; commit (Conventional Commits) + push; CI green on both jobs.

## Deferred (not M2)

- Consensus row, conservation/entropy track, difference mode → **M4** (track
  lane scaffolded now).
- Selection (cell/column/row/range), copy-to-clipboard, editing → **M5**.
- Protein color schemes, color-by-conservation, color-by-identity → later.
- Reference-relative (third) coordinate readout → deferred.
- WebGL/pixi renderer + glyph atlas → **M7** (interface-ready now).
- Independent column/row zoom → later nicety.
