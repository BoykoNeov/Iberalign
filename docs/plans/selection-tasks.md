# Selection — Tasks (cursor + rectangular selection)

The selection foundation. See `selection-plan.md` (why) and `selection-context.md`
(where things live). **Status: planned, not started** — to be implemented in a
later session. Builds on `b8664e2` (keyboard nav + overlay scrollbars).

**Done when:** click selects a cell; arrows move the cursor with the view
following; Shift+arrows/Shift+click grow/shrink a rectangle; the selection is
drawn (translucent fill + active-cell outline) on the shared rAF loop; the pure
selection reducers are unit-tested; pan/zoom/scrollbars unregressed.

## Model (pure, unit-tested)

- [ ] `src/state/selection.ts` — `Cell`, `Selection { anchor, active }`,
      `CellRect { r0,r1,c0,c1 }` (inclusive). Reducers (all clamp to dims):
      `setCursor`, `moveCursor` (move both ends, collapse), `extendActive` (move
      active, keep anchor), `setActive`, `selectAll`, `collapseSelection`,
      `normalize → CellRect`, `rectDims`, row-start/row-end helpers (Home/End).
- [ ] `src/state/selection.test.ts` — clamp at edges; `normalize` with flipped
      anchor/active; move/extend stop at borders; select-all spans full dims;
      single-cell when anchor == active.

## Scroll-into-view (pure)

- [ ] `src/state/viewport.ts` — `scrollIntoView(vp, dims, cell) → Viewport`:
      minimal scroll so the cell's box is fully inside the view, then `clamp`.
- [ ] `src/state/viewport.test.ts` — cell above/below/left/right/inside →
      expected minimal offset; clamps at content edges.

## Store integration

- [ ] `src/state/store.ts` — add `selection: Selection | null` + `getSelection()`.
      Mutators: `setCursor`, `setActive`, `moveCursor`, `extendActive`,
      `selectAll`, `collapseSelection`, `clearSelection`. Each marks dirty.
      `moveCursor`/`extendActive` also update the viewport via `scrollIntoView`
      (following `active`) **in one mutation** (one dirty mark).
- [ ] `src/state/store.ts` — `setDims` resets `selection = null` (clear on load).
- [ ] `src/state/store.test.ts` — cursor set/move/extend mark dirty + clamp;
      move scrolls the active end into view; `setDims` clears selection.

## Rendering

- [ ] `src/render/SelectionLayer.ts` — `Drawable` (model on `ScrollbarsLayer.ts`).
      Constructor `(overlayCanvas, getSelection: () => Selection | null)`. `draw`
      reads selection, computes rect px from `colToX`/`rowToY` + `cellW`/`cellH`,
      fills translucent accent (~0.18 alpha), strokes the active cell stronger.
      No-op when selection is null or canvas has zero size.
- [ ] `src/ui/Grid.tsx` — add `selRef` overlay `<canvas className="grid-selection"
      />` in `.grid-canvas-cell` (between grid canvas and scrollbar divs); build
      `new SelectionLayer(selRef.current, () => store.getSelection())`; add it to
      the `RenderLoop` drawables; resize it in the `ResizeObserver` with the same
      cssW/cssH/dpr as the grid canvas; dispose/cleanup as needed.
- [ ] `src/ui/Grid.css` — `.grid-selection { position:absolute; inset:0;
      pointer-events:none; z-index:1; }` (below the scrollbars at z-index 2).

## Mouse

- [ ] `src/ui/Grid.tsx` — click-vs-drag threshold (~4 px): record pointerdown
      pos; mark "moved" in `onPointerMove` past the threshold; on `pointerup`, if
      not moved → click. Click → `store.setCursor(cell)`; Shift+click →
      `store.setActive(cell)`. Pixel→cell via `xToCol`/`yToRow` + range guard
      (reuse `hover.ts` logic / a shared helper). **Left-drag pan unchanged.**

## Keyboard (rework the `b8664e2` handler — arrows no longer pan)

- [ ] `src/ui/Grid.tsx` — Arrow → `moveCursor`; Shift+Arrow → `extendActive`;
      Home/End → row ends (Shift extends); Ctrl/⌘+Home/End → first/last cell
      (Ctrl/⌘+Shift+End extends); PageUp/Down → cursor by a page of rows; Esc →
      collapse; Ctrl/⌘+A → select all. Seed the initial cursor at the **top-left
      visible cell** when no selection exists. Only handled keys `preventDefault`.

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

- [ ] `npm run typecheck && npm run build` green; vitest green (new selection +
      scroll-into-view + store tests).
- [ ] Manual GUI smoke (`tauri dev`): click selects; arrows move the cursor and
      the view follows; Shift+arrows and Shift+click grow/shrink the rectangle;
      Ctrl+End cursor reaches the last cell; pan/zoom/scrollbars unregressed;
      selection clears on loading a new file.
- [ ] Batch-end ritual: update these docs + `CLAUDE.md` milestone status +
      memory; commit (Conventional Commits) + push; CI green.
