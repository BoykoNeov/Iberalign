# Selection — Plan (cursor + rectangular selection)

A focused feature batch: a spreadsheet-style **cursor + rectangular selection**
over the grid, the foundation for copy (Phase 2) and delete/edit (later). Pairs
with `selection-context.md` (where things live) and `selection-tasks.md` (the
checklist).

**Milestone framing.** Selection/copy/editing is spec **M5** ("Editing & I/O");
M4 ("Compare & analyze") also notes "subset selection drives consensus/diff".
This batch pulls the **selection foundation** ahead of M4 at the user's request.
It is *not* all of M5 — only the cursor + rectangle + rendering + input. Copy is
the immediate Phase-2 follow-up; delete and the rest of editing stay in M5.

**Status: planned, not started.** Design accepted (with advisor review). To be
implemented in a later session. The keyboard/scrollbar work it builds on top of
landed in `b8664e2`.

## Goal

Click a cell → it becomes the selected **active cell** (the cursor). Arrow keys
move the cursor (the view scroll-follows it); **Shift+arrows extend** a
rectangular selection in any of the four directions. Shift+click extends the
rectangle with the mouse. The selection is the substrate for **copy** (Phase 2),
**delete**, and other future operations.

**Done when:** clicking selects a cell; arrows move the cursor with the view
following; Shift+arrows/Shift+click grow/shrink a rectangle; the selection is
drawn (translucent fill + active-cell outline) on the shared rAF loop; the
pure selection reducers are unit-tested; nothing regresses pan/zoom/scrollbars.

## Scope fence

**In this batch (the foundation):**
- Selection model — anchor + active cell → bounding rectangle (single cell when
  anchor == active). Pure reducers in `state/selection.ts`, unit-tested.
- Store integration — selection lives in `GridStore` (store-only; no React
  mirror), every mutator marks dirty.
- Rendering — a `SelectionLayer` `Drawable` on an overlay canvas: translucent
  rectangle fill + a stronger active-cell outline.
- Mouse — click sets the cursor; **Shift+click** extends the rectangle.
  **Left-drag stays pan** (unchanged); click vs. drag is told apart by a movement
  threshold.
- Keyboard — arrows **move the cursor** (replacing arrow-pan), Shift+arrows
  extend; Home/End (row ends), Ctrl/⌘+Home/End (first/last cell), PageUp/Down,
  Esc (collapse), Ctrl/⌘+A (select all). Cursor moves **scroll the active end
  into view** atomically.

**Phase 2 (the immediate follow-up, separate batch):**
- **Copy (Ctrl/⌘+C)** — extract the selected block from the render buffer to the
  clipboard. Tauri `clipboard-manager` plugin + a scoped
  `clipboard-manager:allow-write-text` capability (the capability-lands-with-the-
  feature pattern; the web Clipboard API is flaky on WebKitGTK/Linux). Plain text
  (one row per line) and/or FASTA (`>name` + residues, names from
  `AlignmentView.nameAt`). **Size-guard** huge selections (select-all on the
  10k×10k stress fixture is ~100M chars — cap or warn, don't freeze).
- Status-bar selection readout (`Sel: C cols × R seqs`). Deferred *out of the
  foundation on purpose* — it is the only thing that would force a React mirror
  of the selection (the `zoom`/`setZoom` coarse-state pattern). Add it here, with
  that pattern, so the foundation stays store-only.

**Out (do not drift):**
- **Delete / cut / any mutation** → later M5. A real edit must go through a
  reversible Rust `EditCmd` (Rust owns the truth — CLAUDE.md). And "delete a
  rectangle" in an MSA is genuinely ambiguous (see Decision 6) — it needs its own
  design. Selection only *provides the target coordinates* to those commands.
- **Column/row selection via the ruler / name column** (click a ruler tick →
  select the whole column; click a name → select the whole row). A natural
  extension of the same rectangle model (extend to full height / full width) —
  Phase 2/3, not the foundation.
- **Rubber-band drag-select** — would require moving pan onto middle-/space-drag.
  Left-drag-pan was explicitly praised; keep it. Shift+click covers mouse
  block-selection. Revisit only if asked.
- **Multiple disjoint selections** (Ctrl+click columns, Jalview-style) — later.
- **Subset selection driving consensus/diff** — that is M4's use of selection,
  not this batch.

## Architecture decisions

### 1. Selection model — anchor + active → rectangle

```ts
interface Cell { row: number; col: number; }          // 0-based
interface Selection { anchor: Cell; active: Cell; }    // null when nothing selected
interface CellRect { r0: number; r1: number; c0: number; c1: number; } // inclusive
```

The selection is always the axis-aligned rectangle bounding `anchor` and
`active`. A single selected cell is `anchor == active`. `active` is the **cursor**
(the moving end); `anchor` is the fixed corner a Shift-extend pivots on. Reducers
are **pure** (no DOM/React/store), in `state/selection.ts`, mirroring
`state/viewport.ts`:

- `setCursor(row, col, dims) → Selection` — collapse to one clamped cell.
- `moveCursor(sel|null, dr, dc, dims) → Selection` — move both ends by `(dr,dc)`
  clamped (i.e. move the cursor, collapse the rectangle). With no prior
  selection, seed from a caller-provided origin (see Decision 3, initial cursor).
- `extendActive(sel, dr, dc, dims) → Selection` — keep `anchor`, move `active`
  clamped (Shift+arrow).
- `setActive(sel, row, col, dims) → Selection` — keep `anchor`, set `active`
  (Shift+click).
- `selectAll(dims)`, `normalize(sel) → CellRect`, `rectDims(rect) → {rows,cols}`,
  row-start/row-end helpers for Home/End.

Clamp every cell to `[0, rows-1] × [0, cols-1]`. Unit-test clamp/normalize/
move/extend/select-all (a real off-by-one or a flipped rectangle is catchable
here without a canvas).

### 2. Selection lives in `GridStore` only — store-only, no React mirror

Selection is per-frame view state the rAF loop must read and that mutations must
mark dirty — exactly what `GridStore` is for. Put it there:

- `private selection: Selection | null = null;` + `getSelection()`.
- Mutators (`setCursor`, `setActive`, `moveCursor`, `extendActive`, `selectAll`,
  `collapseSelection`, `clearSelection`) compute the next selection via the pure
  reducers, swap it in, **and mark dirty** — same discipline as the viewport
  mutators (a missed dirty is the classic "didn't repaint" bug).
- **No React state for selection** in the foundation. The `SelectionLayer` reads
  `store.getSelection()` each dirty frame; React never re-renders on it. (A
  status-bar readout in Phase 2 adds a coarse React mirror via the existing
  `zoom`/`setZoom` throttle pattern — that is the *only* reason to mirror.)

### 3. Interaction model

**Mouse** (on the grid canvas, which owns pointer/wheel today):
- Tell **click apart from drag** with a small movement threshold (~4 CSS px).
  Record the pointerdown position; if the pointer moves past the threshold it is a
  **pan** (existing behavior, unchanged — don't touch the selection); if it
  releases under the threshold it is a **click**.
- Click → `store.setCursor(cell)` (collapse). Already takes keyboard focus.
- **Shift+click** → `store.setActive(cell)` (extend the rectangle from the
  existing anchor; seed an anchor at the clicked cell if none).
- Map pixel→cell with the **existing** `xToCol`/`yToRow` (+ the same range-check
  `computeHover` does). Do not duplicate the math.

**Keyboard** (reworks the handler from `b8664e2`; arrows no longer pan):
- Arrow → `store.moveCursor(dr, dc)` (move cursor, collapse, scroll active into
  view). Shift+Arrow → `store.extendActive(dr, dc)` (move active only, scroll it
  into view).
- Home/End → cursor to first/last column of the active row; Shift+Home/End
  extend. Ctrl/⌘+Home/End → first cell `(0,0)` / last cell `(rows-1, cols-1)`;
  Ctrl/⌘+Shift+End extends to the last cell. (Ctrl+End still reaches the last
  row/col — the reachability guarantee from `b8664e2` is preserved, now via the
  cursor.)
- PageUp/PageDown → move the cursor by a page of rows (and scroll). Esc →
  collapse the rectangle to the active cell. Ctrl/⌘+A → select all.
- **Initial cursor:** if no selection exists when a navigation key is pressed,
  seed the cursor at the **top-left visible cell** (`visibleRows`/`visibleCols`
  first index), so the cursor appears under the user's eyes rather than jumping to
  `(0,0)` off-screen.
- Only handled keys `preventDefault` (leave unbound keys to the browser).

**Pan is preserved** on left-drag, wheel, and the scrollbar thumbs. Arrow-key
*panning* is the only thing replaced (by cursor movement). Pure viewport panning
without a cursor is still available via wheel/drag/scrollbar.

### 4. Cursor move + scroll-into-view is ONE atomic store mutation

A cursor/extend move must move the cell **and** re-clamp scroll so the **active**
(moving) end stays visible — in a single mutation, one dirty mark, one redraw.
Add a pure helper to `state/viewport.ts`:

```ts
// Minimal scroll so the cell's box is fully inside the view, then clamp.
scrollIntoView(vp, dims, cell) → Viewport
```

The store's `moveCursor`/`extendActive` do `selection = next; viewport =
scrollIntoView(viewport, dims, next.active); dirty = true`. **Follow the active
end, not the anchor** (on Shift+arrow the anchor is stationary). Unit-test
`scrollIntoView` (cell above/below/left/right/already-inside → expected minimal
offset; clamps at edges).

### 5. Rendering — overlay canvas + `SelectionLayer` Drawable

A separate `render/SelectionLayer.ts` implementing `Drawable`, painting onto an
**overlay `<canvas>`** stacked above the grid canvas inside `.grid-canvas-cell`
(same pattern as the scrollbar thumbs / ruler / name canvases — and better than
threading selection into `Canvas2DRenderer`, whose `draw(view, vp)` has no
selection slot).

- `Drawable.draw(view, vp)` carries no selection, so construct the layer with a
  getter: `new SelectionLayer(overlayCanvas, () => store.getSelection())`. It
  reads the selection in `draw`, computes the rectangle's screen px from
  `colToX`/`rowToY` + `cellW`/`cellH`, fills it translucent (accent, ~0.18
  alpha), and strokes the **active cell** with a stronger outline. Canvas clips
  rectangles that run off-screen — just draw.
- Add it to the `RenderLoop` drawables array (order doesn't affect layering — it
  is a separate stacked canvas, ordered by z-index/DOM — but include it so it
  repaints every dirty frame).
- **Pixel alignment:** size the overlay from the **same** `ResizeObserver` entry
  with the **same** cssW/cssH/dpr as the grid canvas, or the rectangle drifts a
  sub-pixel off the cells. Overlay CSS: `position:absolute; inset:0;
  pointer-events:none;` z-index **between** the grid (0) and the scrollbar thumbs
  (2), so clicks fall through to the grid canvas.
- **Honesty note:** any selection change marks the store dirty, so the grid
  canvas redraws that frame too. The overlay does **not** save grid redraws — it
  is for layering/separation, not a perf optimization. (Cost is negligible; the
  grid already redraws on pan/zoom.)

### 6. Delete / edit semantics — deferred, but designed-for

Delete is the headline future use, but it is a **mutation** → it must go through a
reversible Rust `EditCmd` (Rust owns the truth; CLAUDE.md "Editing = commands").
And "delete the selected rectangle" has three legitimate meanings in an MSA, which
is exactly why it needs its own design pass, not a snap decision:

- **Mask** — replace the selected residues with gaps. Keeps the grid shape and
  the trailing-pad-only invariant; fully reversible. The safe default "delete
  cells".
- **Delete columns** — only when the selection spans **all rows** for a column
  range: remove those columns entirely (shifts everything left, changes the
  alignment width). A common MSA op.
- **Delete + shift within rows** — generally wrong for an MSA: it desynchronizes
  columns across rows and breaks the rectangular/trailing-pad invariant.

This batch ships none of these. It guarantees the selection exposes a clean
`CellRect` (via `normalize`) so a future `EditCmd::MaskRange` / `DeleteColumns`
gets its target for free.

## Risks / traps (from advisor review)

- **Stale selection across loads.** Clear the selection on a view change, or a
  rectangle points at rows the new alignment doesn't have. Do it at the **store**:
  have `setDims` (called from Grid's `[view]` effect on load) reset selection to
  `null` — cleaner than another React effect. (The effect already nulls hover.)
- **Non-atomic move/scroll.** Moving the cursor and scrolling in two store calls
  = two redraws and a possible flash; do it in one mutation. Scroll must follow
  the **active** end.
- **Duplicated pixel math.** Reuse `xToCol`/`yToRow`/`colToX`/`rowToY`; don't
  re-derive cell↔pixel in the selection code.
- **Overlay sub-pixel drift.** Same RO entry + dpr as the grid canvas (Decision 5).
- **Copy freeze (Phase 2).** Guard the select-all-on-10k×10k case.
- **Silent arrow-pan reversal.** Arrows used to pan (shipped in `b8664e2`); they
  now move the cursor. This is intended and was confirmed with the user —
  reachability is preserved because the view scroll-follows the cursor. Note it in
  the implementing commit so it doesn't read as a regression.
