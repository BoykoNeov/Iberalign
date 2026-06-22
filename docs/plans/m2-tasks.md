# M2 — Tasks (Rendering MVP)

Virtualized Canvas2D grid from the in-memory buffer. See `m2-plan.md` (why) and
`m2-context.md` (where things live).

**Status: in progress.** Backend render-buffer IPC + IPC wrapper + frontend
model/coords (parity-guarded) are landed and green; vitest added as the
pure-logic test runner. **Canvas core** (colors/glyphs/Renderer/Canvas2DRenderer
+ rAF loop) is landed and green (committed `f4cbff0`). **Grid container** (`ui/
Grid.tsx`) + **app wiring** are landed and green, and the **render smoke
passed** (`tauri dev`: the grid paints, ctrl-wheel zoom crosses LOD tiers) — so
the full draw path (IPC buffer → view → store → rAF loop → renderer → App) is
exercised end-to-end. **Pinned name column + ruler** are landed and green (canvas
painters on the shared rAF loop, pixel-aligned to the grid). **Status bar**
readout (hover → column + ungapped position + residue) is landed and green.
The **perf fixture** is landed and green (`align-cli generate`; gitignored 95.5 MB
10k×10k fixture parses clean), and the **manual fps smoke passed** (human at
`tauri dev`, 2026-06-22: 10k×10k loads, panning smooth by observation across all
tiers incl. density; fps not numerically measured; no-per-frame-IPC + single-canvas
confirmed in source — see "Verify + wrap"). A **zoom indicator** (status-bar
`N px/cell · tier`) landed alongside on user request. **Remaining: track lane /
minimap, keyboard+scrollbar scroll** — then the M2 batch-end ritual.

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
- [x] **Name column** — `render/NameColumnRenderer.ts`: pinned-left canvas, draws
      visible row names at `rowToY` (same edge math + `round(*dpr)` as the grid →
      pixel-aligned), clipped via a clip region (not `fillText` maxWidth). Driven
      by the shared rAF loop → scroll-synced vertically, no tearing.
- [x] **Position ruler** — `render/RulerRenderer.ts`: pinned-top canvas, 1-based
      **alignment-column** ticks/labels at `colToX` (pixel-aligned to the grid),
      thinned by `niceLabelStep` (pure, `ticks.ts`, unit-tested) anchored to the
      **absolute** column so labels don't jitter on pan. Shared rAF loop →
      scroll-synced horizontally. *(Loop generalized to drive a `Drawable[]`;
      `NAME_W`/`RULER_H`/palette centralized in `render/chrome.ts`, CSS vars set
      from them.)*
- [ ] Empty **track lane** between ruler and grid — laid out, column-aligned,
      reserved for M4. No data.
- [ ] **Minimap** — whole-alignment overview: a **downsampled aggregate**
      (occupancy/averaged color per bucket, reusing the density reduction)
      computed once per load — not a scaled full draw. Viewport rectangle +
      click/drag to navigate; stays in sync with scroll/zoom.
- [x] **Status bar** — pinned bottom strip: `column N · pos M · seq name ·
      residue X` for the hovered cell; gap → "—" for position; never labels the
      gapped width "length" (memo). Pipeline: `ui/hover.ts` `computeHover`
      (pointer → `xToCol`/`yToRow` → `colToUngapped` — the **first** UI exercise
      of the col→ungapped parity logic) → one `setHover` React state throttled to
      cell identity (a within-cell pixel move costs no render) → `StatusBar.tsx`.
      New pixel→cell-under-scroll/zoom + edge/off-content tests in
      `hover.test.ts`. Typecheck/build/vitest green.
- [x] **Hover tooltip — built, then dropped by request (2026-06-22).** The same
      readout shows only in the bottom status bar; no floating overlay over the
      canvas. `Tooltip.tsx` removed and `HoverInfo` no longer carries the
      tooltip-anchor px (`x/y/viewW/viewH`).
- [x] **Zoom indicator (2026-06-22, user request).** Persistent status-bar
      segment pinned right: `zoom N px/cell · <tier>` (`letter`/`block`/`density`),
      so the user can see *where* the tier flips (the "blue" is `density`, below
      3 px/cell). `Grid.tsx` pushes `cellW` to coarse React state only on a
      ctrl-wheel zoom event (never per frame), throttled via `lastZoomRef` keyed on
      `${roundedPx}|${tier}` so a sub-pixel delta — or a tier flip hidden inside one
      rounding bucket at 3 px — is handled honestly. `StatusBar` rounds for display
      but derives the tier from the true `cellW` (`lodFor`). Typecheck/build green.

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
      **render smoke passed** (`tauri dev`: sample paints colored letters/gap,
      status strip correct, ctrl-wheel zoom crosses tiers). Per-frame-IPC / fps
      smoke still gated on the perf fixture.

## Perf fixture (acceptance gate)

- [x] `align-cli generate <rows> <cols> <out.fasta> [gap_pct]` — writes a
      synthetic equal-width FASTA. Bytes go **straight to an explicit path from
      Rust, never stdout** (a PowerShell `>` redirect would emit UTF-16LE+BOM and
      the parser would reject it — an encoding artifact, not a parser bug).
      SplitMix64 PRNG (no `rand` dep) → deterministic in a fixed seed; uniform
      random ACGT with `gap_pct`% interior gaps (default 8 — real rows have no
      horizontal correlation, so this already yields realistic short fill-runs;
      per-column consensus would add only visual bands, no perf change). Core is
      a `write_fasta<W: Write>` so it's unit-tested in-process: parses back to the
      expected shape, byte-for-byte determinism, `gap_pct=0` ⇒ no gaps.
- [x] **Do not commit the large file** — `/fixtures/generated/` is gitignored;
      the `generate` command is the reproducible artifact. Generated
      `fixtures/generated/perf-10k-10k.fasta` (95.5 MB, 0.36 s) and confirmed it
      parses via `iberalign-cli summary`: 10000 seqs, DNA, width 10000,
      equal-width, ungapped 9103..9300 (consistent with ~8% gaps).

## Verify + wrap

- [x] `npm run typecheck && npm run build` green; pure-math + parity unit tests
      green; `cargo test --workspace` (exit 0), `cargo fmt --check`, clippy
      (`-p align-core -p align-cli --all-targets -D warnings`) clean; Tauri shell
      `cargo build -p iberalign` green.
- [x] **Manual fps smoke — passed (2026-06-22).** Human ran `tauri dev` and
      loaded the fixtures. **Result, recorded honestly:** the 95.5 MB 10k×10k file
      **loads** (checkpoint-zero risk cleared — the 100M-byte IPC transfer +
      `Uint8Array` + `AlignmentView` build did not hang or OOM); **panning is
      smooth by direct observation across all LOD tiers, including the zoomed-out
      density tier** (the worst case). **fps was not numerically measured** — the
      devtools Performance panel showed no fps meter in this run, so the
      ≥45–60 fps target is met by *observation*, not a number; the "<200 ms
      operations" the user saw is not fps evidence and isn't cited as such. The
      two structural invariants were **confirmed in source** rather than via
      devtools: only `src/ipc/commands.ts` calls `invoke` (no `invoke` in the rAF
      draw path — `render/loop.ts`), and the whole grid paints into a single
      `<canvas class="grid-canvas">` (+ ruler/name chrome canvases), never
      DOM-per-cell. **Scope note from the user:** 10k×10k is the *stress ceiling*,
      not the design target ("we are not aiming at that many sequences"). The
      "all-blue when zoomed out" the user saw is the **density tier** (expected
      `lodFor(cellW) < 3 px`), not a defect. Original checklist (for the record):
      - **Checkpoint zero — does it load at all, and how long?** A 100M-byte
        render buffer must transfer over IPC (raw `Response`), become a
        `Uint8Array(100M)`, and build an `AlignmentView`. That transfer + JS
        allocation is the single biggest untested risk and is *upstream* of any
        fps number — if it hangs or OOMs, fps never gets measured. (Rust-side
        read+parse is **not** the risk: `summary` parses the 95.5 MB file in
        ~0.47 s.) Note load wall-time and that memory stays sane. Use
        `perf-3k-3k.fasta` (8.6 MB) as a "this should definitely be smooth"
        baseline — a bad 10k result then reads as a regression, not "10k is at
        the edge".
      - **Zoom fully out to the density tier and pan there** — this is the worst
        case (occupancy is recomputed over the whole visible window every frame),
        and the one most likely to hide a real perf problem. Letter-tier panning
        is bounded by the visible window, ~size-independent, so it won't catch
        anything — don't stop at letter tier.
      - ≥ ~45–60 fps across letter / block / density tiers (devtools perf panel).
      - status-bar readout correct on hover; (minimap synced once it lands).
      - **no per-frame IPC** — watch the IPC log; load should be the only call.
      - **no DOM-per-cell** — inspect the DOM: one `<canvas>` (+ chrome canvases),
        not N elements.
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
