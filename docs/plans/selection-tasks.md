# Selection — Tasks (cursor + rectangular selection)

The selection foundation. See `selection-plan.md` (why) and `selection-context.md`
(where things live). **Status: code complete + green; GUI smoke PASSED
(user-confirmed 2026-06-23); committed.** Builds on `b8664e2` (keyboard nav +
overlay scrollbars). Implemented with advisor review — the key correction was that
`moveCursor` must COLLAPSE to a single cell at `active+delta` (not move both
rectangle ends independently); Home/End/corner reuse the cursor movers with a `FAR`
delta (the existing scroll-handler idiom) so the row helpers weren't needed.

**Two plan reversals settled during the GUI smoke (2026-06-23, user-requested):**
**(a) mouse** — left-drag now rubber-band selects, **pan moved to middle-drag**;
**(b) look** — selection is **color-inversion + a thick black border** (two overlay
canvases), not the translucent fill + outline first planned. A vivid residue palette
+ always-black letters (`render/colors.ts`) also landed alongside.

**Done when:** click selects a cell; left-drag rubber-bands a rectangle; arrows move
the cursor with the view following; Shift+arrows/Shift+click grow/shrink a
rectangle; the selection is drawn (color-inversion + thick black border) on the
shared rAF loop; the pure selection reducers are unit-tested; pan (middle-drag /
wheel / scrollbars) / zoom unregressed.

## Model (pure, unit-tested)

- [x] `src/state/selection.ts` — `Cell`, `Selection { anchor, active }`,
      `CellRect { r0,r1,c0,c1 }` (inclusive). Reducers (all clamp to dims):
      `setCursor`, `moveCursor` (**collapse** to `active+delta`), `extendActive`
      (move active, keep anchor), `setActive`, `selectAll`, `collapseSelection`,
      `normalize → CellRect`, `rectDims`. **Row-start/row-end helpers dropped** —
      Home/End fall out of `moveCursor(0, ±FAR)` (clamped), matching the existing
      keyboard idiom; `moveCursor`/`extendActive` defensively seed `(0,0)` on null.
- [x] `src/state/selection.test.ts` — clamp at edges; `normalize` with flipped
      anchor/active; **multi-cell rect + plain arrow collapses to one cell**;
      move/extend stop at borders; `FAR` delta reaches the last cell; select-all
      spans full dims; single-cell when anchor == active.

## Scroll-into-view (pure)

- [x] `src/state/viewport.ts` — `scrollIntoView(vp, dims, cell) → Viewport`:
      minimal scroll so the cell's box is fully inside the view, then `clamp`.
- [x] `src/state/viewport.test.ts` — cell above/below/left/right/inside →
      expected minimal offset; clamps at content edges.

## Store integration

- [x] `src/state/store.ts` — added `selection: Selection | null` + `getSelection()`.
      Mutators: `setCursor`, `setActive`, `moveCursor`, `extendActive`,
      `selectAll`, `collapseSelection`, `clearSelection` (via a private
      `setSelection(next, viewport?)` write path; always marks dirty).
      `moveCursor`/`extendActive` also update the viewport via `scrollIntoView`
      (following `active`) **in one mutation** (one dirty mark).
- [x] `src/state/store.ts` — `setDims` resets `selection = null` (clear on load).
- [x] `src/state/store.test.ts` — cursor set/move/extend mark dirty + clamp;
      move scrolls the active end into view; `setDims` clears selection.

## Rendering

- [x] `src/render/SelectionLayer.ts` — `Drawable` owning **two** overlay canvases.
      Constructor `(invertCanvas, borderCanvas, getSelection: () => Selection |
      null)`; `resize(cssW, cssH, dpr)` sizes BOTH in one call (no desync). `draw`
      reads selection, computes rect px from `colToX`/`rowToY` (same `round(* dpr)`
      snapping as the grid), then: **(1)** fills the rect solid white on the invert
      canvas (CSS `mix-blend-mode: difference` → `255 − backdrop`), clearing the
      active cell in a multi-cell rect (Excel idiom; skipped for a single cell);
      **(2)** paints a thick **black** border (`BORDER`/`BORDER_PX`, four device-px
      inset strips capped to half the smaller side) on the non-blending border
      canvas. No-op when selection is null or a canvas has zero size; both contexts
      `clearRect` each frame.
- [x] `src/ui/Grid.tsx` — added `selRef` (`.grid-selection`) **and** `selBorderRef`
      (`.grid-selection-border`) overlay canvases in `.grid-canvas-cell`; builds
      `new SelectionLayer(selRef.current, selBorderRef.current, () =>
      store.getSelection())`; added to the `RenderLoop` drawables (one entry, paints
      both); the single `selection.resize(...)` in the `ResizeObserver` (same
      cssW/cssH/dpr as the grid canvas) sizes both canvases; `dispose()` in cleanup.
- [x] `src/ui/Grid.css` — `.grid-selection` (z-index 1, `mix-blend-mode:
      difference`) + `.grid-selection-border` (z-index 2, no blend); both
      `position:absolute; inset:0; pointer-events:none;`. `.grid-canvas-cell` is
      `isolation: isolate` (confines the blend to the grid canvas). Scrollbars
      bumped z-index 2 → 3. `.grid-canvas` cursor: `cell` (idle) / `grabbing` (mid
      middle-drag pan).

## Mouse

- [x] `src/ui/Grid.tsx` — **revised 2026-06-23: left-drag selects, middle-drag
      pans.** Two pointer modes by button: left (0) = select, middle (1) = pan.
      Click-vs-drag threshold (4 px): a left press releasing under it → click →
      `store.setCursor(cell)` (Shift+click → `setActive`); past it → rubber-band
      (anchor at the down cell, `setActive` to the cell under the pointer each move;
      Shift+drag keeps the anchor). Middle-drag = the old grab-and-drag pan; `mousedown`
      `preventDefault` on button 1 kills WebView2 autoscroll. Pixel→cell via the
      shared `cellAtPixel` (factored out of `computeHover` in `hover.ts`). Wheel +
      scrollbars still pan.

## Keyboard (reworked the `b8664e2` handler — arrows no longer pan)

- [x] `src/ui/Grid.tsx` — Arrow → `moveCursor`; Shift+Arrow → `extendActive`;
      Home/End → `moveCursor(0, ±FAR)` row ends (Shift extends); Ctrl/⌘+Home/End →
      first/last cell via `moveCursor(±FAR, ±FAR)` (Ctrl/⌘+Shift+Home/End extend);
      PageUp/Down → cursor by a page of rows; Esc → collapse; Ctrl/⌘+A → select
      all. Absolute jumps (Ctrl+Home/End/A) handled **before** the seed path so
      Ctrl+End with no selection reaches the last cell. Seeds the initial cursor at
      the **top-left visible cell** (no move) on first relative-nav press. Only
      handled keys `preventDefault`.

## Phase 2 — copy (SEPARATE batch, not the foundation)

- [ ] Add `@tauri-apps/plugin-clipboard-manager` + Rust plugin init; capability
      `clipboard-manager:allow-write-text` in `src-tauri/capabilities/default.json`
      (the one capability this feature needs — lands with copy).
- [ ] `src/ipc/` (the only `invoke`/api seam) — clipboard write wrapper.
- [ ] Block→text from the render buffer: plain text (one row per line, residues
      `c0..c1` from `rowSlice`) and/or FASTA (`>name` from `nameAt` + residues).
- [ ] Ctrl/⌘+C in `Grid.tsx` (user-gesture) → copy the normalized rect.
      **Size-guard** select-all on the 10k×10k fixture (~100M chars — cap/warn).
- [ ] Status-bar selection readout (`Sel: C cols × R seqs`) in `StatusBar.tsx`,
      fed by a coarse React mirror (the `zoom`/`setZoom` throttle pattern) — the
      only place selection enters React.

## Later (rest of M5 / M4 — not this feature)

- [ ] **Delete / cut / mask** via a reversible Rust `EditCmd` (mask-with-gaps vs
      delete-columns vs shift — needs its own design; Plan Decision 6). Selection
      supplies the `CellRect`.
- [ ] Column/row selection via ruler / name-column clicks (extend rect to full
      height / full width).
- [ ] Rubber-band drag-select (only if pan moves to middle-/space-drag).
- [ ] Subset (sequence) selection driving consensus/diff → **M4**.

## Verify + wrap

- [x] `npm run typecheck && npm run build` green; vitest green (**144 tests** incl.
      new selection + scroll-into-view + store + vivid-palette cases).
- [x] Manual GUI smoke (`tauri dev`) — **PASSED (user-confirmed 2026-06-23),**
      across the iteration that settled the look (tooltip → tint → inversion-only →
      inversion + black border) and the mouse remap (left-drag select / middle-drag
      pan). Confirmed: click selects; left-drag rubber-bands; arrows move the cursor
      with the view scroll-following; Shift+arrows/Shift+click grow/shrink the rect;
      Ctrl+End/Home/A + Esc behave; middle-drag pans (no WebView2 autoscroll); the
      **inversion + thick black border** reads on the vivid palette; black residue
      letters; single-cell vs multi-cell active-cell behavior. (Per-scheme contrast
      is now moot — inversion is scheme-independent, so the old "bump FILL alpha"
      note no longer applies.)
- [x] Batch-end ritual: updated these docs + `CLAUDE.md` milestone status + memory;
      commit (Conventional Commits) + push; CI green.
