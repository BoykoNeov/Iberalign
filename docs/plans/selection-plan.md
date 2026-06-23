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

**Status: code complete + green; GUI smoke PASSED (user-confirmed 2026-06-23);
committed.** Design accepted (with advisor review) and implemented (foundation only
— copy is the separate Phase 2 below). The keyboard/scrollbar work it builds on top
of landed in `b8664e2`. Implementation note: `moveCursor` collapses to a single cell
at `active+delta` (advisor catch — see the tasks doc); Home/End/corner reuse the
cursor movers with a `FAR` delta, so the planned row-start/row-end reducers proved
unnecessary.

**Revised during GUI smoke (2026-06-23), at the user's request — two plan
reversals, both deliberate:**
- **Mouse:** left-drag now **rubber-band selects**; **pan moved to middle-drag**
  (the plan below kept left-drag = pan and listed rubber-band drag-select as out of
  scope — both reversed). Click (< 4px) still sets the cursor; Shift+click/arrow
  still extend.
- **Look:** the selection **color-inverts** the cells beneath it (`mix-blend-mode:
  difference`) with a **thick black border** on a second, non-blending overlay
  canvas above the inverting one — not the translucent-tint fill + active-cell
  outline Decision 5 originally specified. (Decisions 3 and 5 below are updated to
  match; the original text is preserved in git history.)
- Also landed alongside (separate concern, no plan section): a **vivid residue
  palette** default + **always-black glyph letters** in `render/colors.ts`.

## Goal

Click a cell → it becomes the selected **active cell** (the cursor). Arrow keys
move the cursor (the view scroll-follows it); **Shift+arrows extend** a
rectangular selection in any of the four directions. Shift+click extends the
rectangle with the mouse. The selection is the substrate for **copy** (Phase 2),
**delete**, and other future operations.

**Done when:** clicking selects a cell; left-drag rubber-bands a rectangle; arrows
move the cursor with the view following; Shift+arrows/Shift+click grow/shrink a
rectangle; the selection is drawn (color-inversion + thick black border, see
Decision 5 as revised) on the shared rAF loop; the pure selection reducers are
unit-tested; nothing regresses pan/zoom/scrollbars (pan now on middle-drag + wheel
+ scrollbars).

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
- ~~**Rubber-band drag-select**~~ — **ADOPTED during the GUI smoke (2026-06-23).**
  Originally out (it requires moving pan off left-drag); the user asked for it, so
  pan moved to **middle-drag** and left-drag now rubber-bands a rectangle. See the
  revised Decision 3.
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

**Mouse** (on the grid canvas, which owns pointer/wheel today). *Revised
2026-06-23: left-drag selects, pan moved to middle-drag.*
- Two buttons, two gestures: **left (0) = SELECT**, **middle (1, wheel pressed) =
  PAN** (the grab-and-drag gesture left-drag used in M2). `dragging` class (→
  `grabbing` cursor) shows only while panning; the default cursor is `cell`.
- Tell **click apart from drag** with a ~4 CSS px movement threshold. A left press
  releasing under the threshold is a **click**; past it, a **rubber-band drag**.
- Click → `store.setCursor(cell)` (collapse). Already takes keyboard focus.
- **Left-drag** → anchor at the down cell, then `store.setActive(cell-under-pointer)`
  each move (a plain drag anchors at the start cell; a **Shift+drag** keeps the
  existing anchor and only moves the active end).
- **Shift+click** → `store.setActive(cell)` (extend the rectangle from the existing
  anchor; seed an anchor at the clicked cell if none).
- `mousedown` `preventDefault` on **button 1** suppresses WebView2/Chromium
  middle-click autoscroll (preventDefault on `pointerdown` does not).
- Map pixel→cell with the **shared** `cellAtPixel` (factored out of `computeHover`).
  Do not duplicate the math.

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

**Pan is preserved** on **middle-drag** (revised — was left-drag), wheel, and the
scrollbar thumbs. Arrow-key *panning* was replaced (by cursor movement) and
left-drag was repurposed to rubber-band select. Pure viewport panning without a
cursor is still available via middle-drag/wheel/scrollbar.

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

### 5. Rendering — overlay canvases + `SelectionLayer` Drawable

*Revised 2026-06-23 during the GUI smoke: the look is **color-inversion + a thick
black border**, on TWO stacked overlay canvases, not the translucent-tint fill +
outline this section originally specified. (The tint and an inversion-only no-border
variant were both tried and dropped; a floating tooltip was tried and dropped too.)*

A single `render/SelectionLayer.ts` implementing `Drawable` owns **two** overlay
`<canvas>`es stacked above the grid canvas inside `.grid-canvas-cell` (better than
threading selection into `Canvas2DRenderer`, whose `draw(view, vp)` has no selection
slot):

- **Invert canvas** (`.grid-selection`, z-index 1) — CSS `mix-blend-mode:
  difference`. The layer fills the selection rectangle solid **white**, which the
  blend composites to `255 − backdrop` per channel: a true photographic negative of
  the residue cells (fills *and* black letters flip). `.grid-canvas-cell` is
  `isolation: isolate` so the blend is confined to the grid canvas directly below,
  not the page/chrome. Reads "selected" on any scheme/zoom with no color choice.
- **Border canvas** (`.grid-selection-border`, z-index 2) — **NO** blend mode,
  stacked above the invert canvas, so a **thick black border** holds a CONSTANT
  color (a border on the difference-blend canvas would itself invert and couldn't
  hold one color — hence the second canvas). Drawn as four device-px-aligned inset
  strips fully inside the rect; thickness capped to half the smaller side so a tiny
  selection fills solid rather than overdraws. Constants `BORDER` (`#000000`) /
  `BORDER_PX` (3 CSS px) at the top of the file.
- **Active cell:** in a *multi-cell* rect the active cell's white is cleared
  (`clearRect`) so the one cell shows its true "live" color inside the inverted
  block (Excel idiom). Skipped for a *single-cell* cursor — clearing the lone cell
  would erase the only inverted pixels and it would vanish, so a single cell just
  inverts.
- Construct with a getter: `new SelectionLayer(invertCanvas, borderCanvas, () =>
  store.getSelection())`. Add it to the `RenderLoop` drawables array (one entry; its
  `draw` paints both canvases) so it repaints every dirty frame.
- **Pixel alignment + the two-canvas footgun:** `SelectionLayer.resize` sizes BOTH
  canvases in one call with the **same** cssW/cssH/dpr as the grid canvas (from the
  same `ResizeObserver` entry), so they can't desync and the rect can't drift a
  sub-pixel off the cells. Both canvases: `position:absolute; inset:0;
  pointer-events:none;`. Z-index: grid 0 / invert 1 / border 2 / **scrollbar thumbs
  bumped to 3**.
- **Honesty note:** any selection change marks the store dirty, so the grid canvas
  redraws that frame too. The overlays do **not** save grid redraws — they are for
  layering/separation, not perf. (Cost is a few fills.)

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
