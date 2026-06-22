# Selection — Context

Key files, current state, and decisions a session needs to execute the selection
foundation. Pairs with `selection-plan.md` (the why) and `selection-tasks.md`
(the checklist). Everything below is **as landed at `b8664e2`** (keyboard nav +
overlay scrollbars).

## Starting point (what's already there to build on)

### State (the per-frame source of truth, outside React)

- **`src/state/store.ts`** — `GridStore` holds `viewport`, `dims`, `dirty`.
  Mutators (`setDims`, `resize`, `pan`, `scrollTo`, `zoom`) all funnel through the
  private `mutate(next: Viewport)` which swaps the viewport and **always marks
  dirty**. Reads: `getViewport()`, `getDims()`, `consumeDirty()`, `markDirty()`.
  - **Add here:** `selection: Selection | null`, `getSelection()`, and the
    selection mutators. Note `mutate` is typed to `Viewport`; either generalize
    it or add a small selection-aware write path that sets `selection` (and, for
    moves, the viewport via `scrollIntoView`) then `dirty = true`.
  - **`setDims(cols, rows)`** is called on load (from Grid's `[view]` effect) and
    resets scroll to origin. **Make it also reset `selection = null`** (the clean
    place to clear a stale selection across loads).

- **`src/state/viewport.ts`** — pure reducers, **CSS-px units**. `Viewport
  { scrollX, scrollY, cellW, cellH, viewW, viewH }`, `Dims { cols, rows }`.
  Helpers: `contentWidth`/`contentHeight`, `clamp`, `pan`, `scrollTo`, `resize`,
  `zoomAbout`, bounds `MIN_CELL=1`/`MAX_CELL=32`/`DEFAULT_CELL=14`. `clamp` and
  `scrollTo` are the existing clamped write paths.
  - **Add here:** `scrollIntoView(vp, dims, cell) → Viewport` (Decision 4) —
    minimal scroll so `cell`'s box `[col*cellW,(col+1)*cellW] × [row*cellH,
    (row+1)*cellH]` is inside the view, then `clamp`. Pure; unit-test it.

- **`src/state/viewport.test.ts`, `src/state/store.test.ts`** — existing vitest
  suites for the reducers/store. Add `scrollIntoView` cases and store selection
  cases (cursor set/move/extend marks dirty + clamps; `setDims` clears selection).

### Render (pure geometry + the Drawable loop)

- **`src/render/viewport.ts`** (pure) — the cell↔pixel transforms to **reuse**:
  `colToX(vp,col)`/`rowToY(vp,row)` (cell → grid-canvas px), `xToCol(vp,x)`/
  `yToRow(vp,y)` (px → cell index, may be out of range — range-check),
  `visibleCols`/`visibleRows(vp, dims, overscan)` (for the initial-cursor
  top-left-visible cell). All grid-canvas-local CSS px (origin excludes the name
  column + ruler).

- **`src/render/Renderer.ts`** — the `Drawable` interface: `draw(view:
  AlignmentView, vp: Viewport): void`. No selection param — the `SelectionLayer`
  takes a `() => Selection | null` getter in its constructor (see below).

- **`src/render/loop.ts`** — `RenderLoop(store, drawables[], getView)`: every
  frame, on `consumeDirty()` it calls `d.draw(view, vp)` for each drawable in
  array order, in one frame (no tear). Add the `SelectionLayer` to the array.

- **`src/render/ScrollbarsLayer.ts`** — **the template to copy.** A `Drawable`
  that owns no grid canvas and positions overlay DOM each dirty frame. The
  `SelectionLayer` is the same shape but paints an overlay `<canvas>` instead of
  moving `<div>`s. Read this first.

- **`src/render/Canvas2DRenderer.ts`** — the grid painter. **Do not** add
  selection here (its `draw` has no selection slot, and an overlay keeps concerns
  separate — Decision 5). Listed so you don't reach for it.

### Model (read access for selection + future copy)

- **`src/model/view.ts`** — `AlignmentView`: `width`, `numRows`, `cellAt(row,
  col) → byte|undefined`, `rowSlice(row) → Uint8Array` (zero-copy row), `nameAt
  (row) → string`. This is how Phase-2 copy extracts the block (slice cols
  `c0..c1` from `rowSlice(r)` for `r` in `r0..r1`; names from `nameAt`).

### UI (the integration point)

- **`src/ui/Grid.tsx`** — owns the `GridStore`/renderer/`RenderLoop` (refs, never
  React state), the `ResizeObserver` on `.grid-canvas-cell`, and all
  pointer/wheel/keyboard wiring. Key spots:
  - The mount effect builds `loop = new RenderLoop(store, [renderer, ruler,
    names, scrollbars], …)`. **Add `selection` to that array** and build it from a
    new overlay-canvas ref + `() => store.getSelection()`.
  - The **`ResizeObserver`** resizes the grid/ruler/name canvases. **Resize the
    overlay canvas there too**, with the same `r.width`/`r.height`/`dpr`.
  - **`onPointerDown`** currently focuses the cell and starts drag-pan. Add the
    click-vs-drag threshold (record start; set "moved" in `onPointerMove`; on
    `pointerup`, if not moved → click → `setCursor`/`setActive` by `shiftKey`).
  - **`onKeyDown`** currently pans (Arrow/Page) and `scrollTo`s (Home/End). This
    is the handler to **rework** into cursor movement (Plan Decision 3). Same
    listener, new body; cleanup already removes it.
  - **JSX:** `.grid-canvas-cell` (position:relative, `tabIndex=0`,
    `role="application"`) holds the grid `<canvas>` + the two scrollbar `<div>`s.
    **Add the overlay `<canvas ref={selRef} className="grid-selection" />`**
    between the grid canvas and the scrollbars.
  - **`CHROME_VARS`** sets `--name-w`/`--ruler-h`/`--scrollbar-thickness` from JS
    constants. Add a selection-accent var only if you want CSS to own the color
    (the layer can also just hardcode the accent like the scrollbars do).

- **`src/ui/Grid.css`** — has `.grid-canvas-cell:focus-visible` (accent outline),
  `.grid-scrollbar*` (overlay thumbs, z-index 2). **Add `.grid-selection`**
  (`position:absolute; inset:0; pointer-events:none; z-index:1;`). The grid canvas
  is the pointer target; the overlay must not intercept.

- **`src/ui/hover.ts`** — `computeHover` already does pixel→cell with the
  box/range guard. Mirror that guard for click→cell (or factor a shared
  `cellAtPixel(view, vp, ax, ay) → Cell | null`); don't duplicate.

- **`src/ui/StatusBar.tsx`** — renders the hover readout + zoom group. The Phase-2
  selection readout (`Sel: C × R`) goes here, fed by a coarse React mirror.

## New files this batch creates

- **`src/state/selection.ts`** — pure selection model + reducers (Plan Decision
  1). Serde-free, no DOM. Mirrors `state/viewport.ts` in spirit.
- **`src/state/selection.test.ts`** — vitest: clamp, normalize (incl. flipped
  anchor/active), move/extend at edges, select-all, row Home/End.
- **`src/render/SelectionLayer.ts`** — `Drawable` painting the overlay canvas
  (Plan Decision 5). Modeled on `ScrollbarsLayer.ts`.

## Decisions locked (see plan for rationale)

- Selection = anchor + active → bounding rectangle; `active` is the cursor.
- Selection lives **in `GridStore` only** (no React mirror in the foundation);
  every mutator marks dirty; `setDims` clears it.
- Cursor move **+ scroll-into-view is one atomic mutation**, following the active
  end.
- Mouse: click selects, **Shift+click extends, left-drag stays pan** (threshold
  tells click from drag). Keyboard arrows **move the cursor** (replacing
  arrow-pan); Shift+arrows extend.
- Rendering via an **overlay canvas + `SelectionLayer`** (not in
  `Canvas2DRenderer`); same RO entry/dpr as the grid canvas.
- **No new Tauri capability** in this batch. (Phase-2 copy adds
  `clipboard-manager:allow-write-text` + the plugin — that is the one capability
  this whole feature needs, and it lands with copy, not now.)
- Delete/edit deferred to M5 (reversible Rust `EditCmd`); selection only supplies
  the `CellRect`.

## Pure functions to extract + unit-test (the real test surface)

Canvas drawing isn't unit-testable in CI (no real canvas in jsdom); acceptance is
a manual GUI smoke. What IS testable and must be pure TS:

- `state/selection.ts` — clamp/normalize/setCursor/moveCursor/extendActive/
  setActive/selectAll/row-ends. Off-by-one and flipped-rectangle bugs are
  catchable here.
- `state/viewport.ts` `scrollIntoView` — minimal-scroll correctness + edge clamp.
- Store selection mutators — that they mark dirty, clamp, and that `setDims`
  clears selection.

## Gotchas / toolchain

- **Tauri 2.11.3**, React 19, `@tauri-apps/api` v2, Vite, TS ~5.8, vitest. Same
  as M2.
- **`ipc/commands.ts` stays the only `invoke`/`@tauri-apps/api` seam.** Phase-2
  copy's clipboard call goes through a wrapper there (or the plugin's JS API
  imported only there), never scattered in UI code.
- **No real-canvas tests in CI** — don't add a jsdom canvas test that can't fail
  for a real defect. Test the pure math.
- **StrictMode double-mount** — the mount effect's cleanup must remove every new
  listener and null refs, as the existing one does.
- Phase-2 copy must run in a **user-gesture** context (the Ctrl+C keydown
  qualifies) and be **size-guarded** (10k×10k select-all ≈ 100M chars).
