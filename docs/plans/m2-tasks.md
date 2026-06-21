# M2 — Tasks (Rendering MVP)

Virtualized Canvas2D grid from the in-memory buffer. See `m2-plan.md` (why) and
`m2-context.md` (where things live).

**Status: not started — plan draft for review.** Nothing checked until the plan
is accepted.

**Done when** (spec §12): a thousands×thousands fixture scrolls smoothly
(≥ ~45–60 fps) with no DOM-per-cell and no per-frame IPC.

## Backend — render-buffer IPC

- [ ] `AlignmentMetaDto { width, num_rows, names, alphabet }` (JSON) — names for
      the pinned column, alphabet for the color scheme. Decide: fold into
      `load_alignment`/`parse_summary` return, or a `get_alignment_meta` getter.
- [ ] `get_render_buffer()` command → **raw bytes** via `tauri::ipc::Response`
      (flat row-major `width × num_rows` gapped matrix from `AppState.dataset`).
      Errors cleanly when no dataset is loaded. **Not** a JSON `number[]`.
- [ ] Confirm the exact Tauri 2.11.3 binary-response signature
      (`tauri::ipc::Response::new(…)`) and that JS `invoke` yields an
      `ArrayBuffer`. Register the command in `lib.rs`.
- [ ] Confirm **no** new entry in `capabilities/default.json` is required
      (app-defined command) — note it in the commit if so.

## IPC wrapper (the only `invoke` seam)

- [ ] `src/ipc/commands.ts`: `getRenderBuffer(): Promise<Uint8Array>` (wraps the
      `ArrayBuffer`), and the meta wrapper (snake_case → camelCase, like
      `fromWire`). Keep `@tauri-apps/api` imported only here.

## Frontend model + state

- [ ] `src/model/` — TS DTO types; an `AlignmentView` wrapping buffer + meta with
      `cellAt(row,col)` (byte read) and `rowSlice(row)` helpers.
- [ ] `src/model/coords.ts` — `colToUngapped(view,row,col) -> number | null`
      mirroring `coords.rs` (gap→null, gaps excluded, 1-based surface).
- [ ] **Parity test** — `colToUngapped` cross-checked against engine output on a
      fixture with known column→position pairs (e.g. via `align-cli`, or a
      hand-worked fixture). The guard against silent drift.
- [ ] `src/state/` — non-React store/refs for **buffer** + **viewport**
      (scroll offsets, cell size/zoom). Pan/zoom/scroll as pure reducers over
      viewport. **No `useState` for per-frame state.**

## Renderer

- [ ] `src/render/viewport.ts` (pure) — visible-window math (first/last
      row+col + overscan), `colToX`/`xToCol`, `rowToY`/`yToRow`. **Unit-tested.**
- [ ] `src/render/lod.ts` (pure) — cell px → tier (letter ≥ ~8 / block ~3–8 /
      density < ~3). **Unit-tested.**
- [ ] `src/render/colors.ts` — nucleotide scheme, **colorblind-safe palette as
      default**; a seam to add schemes later (no protein schemes yet).
- [ ] `src/render/Renderer.ts` — the thin interface (≈`resize`/`draw`/`dispose`).
- [ ] `src/render/glyphs.ts` — offscreen-canvas **glyph atlas** (each residue
      pre-rendered once); the letter tier `drawImage`-blits from it instead of
      `fillText` per cell (the #2 fps killer after per-frame React state).
- [ ] `src/render/Canvas2DRenderer.ts` — draws the visible window per LOD tier:
      letter tier (cell + atlas glyph), block tier (cell only), density tier
      (occupancy/gap-density or averaged-color strip — **no** identity data).
      Reads the buffer; no per-cell DOM.
- [ ] Draw loop on `requestAnimationFrame` reading the viewport/buffer refs;
      redraw only on dirty (pan/zoom/resize/load), not unconditionally.

## Chrome (pinned, scroll-synced)

- [ ] Grid container component (mounts the canvas, owns the rAF loop, wires
      input handlers).
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

- [ ] **Pan** — drag and wheel-scroll move the viewport (mutate refs → request
      frame; no setState).
- [ ] **Zoom** — ctrl/⌘-wheel changes cell size about the cursor; clamp to a
      min/max; crosses LOD tiers.
- [ ] **Scroll** — keyboard/scrollbar; large alignments reachable to last
      row/col.

## App wiring

- [ ] `App.tsx` — on successful load, fetch meta + buffer, mount the grid; keep
      the M1 open/parse flow and summary (or move summary into a panel). Grid is
      read-only.

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
