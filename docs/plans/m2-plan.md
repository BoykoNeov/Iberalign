# M2 — Plan (Rendering MVP)

The make-or-break milestone. Pairs with `m2-context.md` (where things live) and
`m2-tasks.md` (the checklist). Read spec §6 (Rendering) and §12 (M2) first.

## Goal

A virtualized Canvas2D grid that draws an alignment from an in-memory byte
buffer — pinned name column + position ruler, nucleotide coloring, pan / zoom /
scroll, a hover tooltip, a synchronized minimap, and a status-bar position
readout (column + ungapped position).

**Done when** (spec §12): a thousands×thousands fixture scrolls smoothly
(target ≥ ~45–60 fps) with **no DOM-per-cell** and **no per-frame IPC**.

## Scope fence

**In M2:** grid render, name column, ruler, nucleotide color scheme
(colorblind-safe default), pan/zoom/scroll, hover tooltip, minimap, status-bar
readout (column + ungapped position).

**Out (do not drift):**
- Consensus row, conservation/entropy track, difference mode → **M4** (no
  analysis data exists yet). We *scaffold the track-lane layout* so M4 drops in,
  but only the ruler is populated in M2.
- Protein color schemes (Clustal/Zappo/hydrophobicity), color-by-conservation,
  color-by-identity → later. M2 ships the **nucleotide** scheme + a clean seam
  for adding schemes.
- Selection / copy-to-clipboard, editing → M5. M2 is read-only viewing. (Hover
  readout yes; click-selection no.)
- Reference-relative coordinate (the planned *third* readout) → deferred. M2
  shows **alignment column** + **ungapped position** only. (See "Open question"
  below — resolved for M2.)
- WebGL renderer → M7. M2 builds Canvas2D *behind an interface* so the swap is
  later-mechanical, nothing more.

## Architecture decisions

### 1. Render buffer transport — binary, once per load, never per frame

The frontend renders from a flat `Uint8Array` holding the gapped matrix
(`width × num_rows`, row-major: row `r`'s columns are bytes
`[r*width, (r+1)*width)`). It is fetched **once on load** by a new coarse
command and **never re-fetched per frame** (spec §3, §6: no IPC during
interaction).

Transport is **raw bytes**, not a JSON `number[]`. The existing `parse_summary`
path serializes `Vec<u8>` as a JSON number array (see the note in
`commands.ts`) — that is ~tens of MB of JSON for a thousands×thousands matrix
and is disqualifying. Use Tauri v2's binary response: a command returning
`tauri::ipc::Response` built from the `Vec<u8>` buffer, which arrives in JS as
an `ArrayBuffer` (→ wrap in `Uint8Array`). *(Exact call —
`tauri::ipc::Response::new(bytes)` on Tauri 2.11.3 — confirm signature at
implementation; the principle "raw bytes, never `number[]`" holds regardless.)*

Names / dimensions / alphabet are small and structured — they ride a **separate
JSON DTO** (a second command, or a metadata struct fetched alongside). Keep the
big binary blob and the small metadata on different calls so the metadata stays
ergonomic JSON and the buffer stays raw.

The buffer is a **copy** the frontend owns for rendering. Rust keeps the
authoritative `Dataset` (spec §3). On M5 edits, Rust returns changed rows and
the frontend patches its buffer — out of scope now, but the buffer shape (flat
row-major) is chosen so a row patch is a contiguous `set()`.

### 2. Frontend buffer + viewport live OUTSIDE the React render cycle

This is the decision a Canvas grid most often gets wrong, and it directly
protects the fps target. Scroll/zoom in `useState` re-renders React every frame
→ jank.

- The **buffer** (`Uint8Array`) and **viewport** (scroll offsets, zoom/cell
  size) live in **refs / a plain non-React store**, not `useState`.
- A draw loop on **`requestAnimationFrame`** reads those refs and redraws the
  visible window. Pan/zoom handlers mutate the refs and request a frame; they do
  not call `setState`.
- React renders only **chrome** (toolbar, status bar text, tooltip box) and
  re-renders on coarse events (load, a readout value change) — not per frame.

### 3. Renderer behind a thin interface

Spec §6 mandates "two renderers behind one interface" (Canvas2D MVP →
WebGL/pixi scale path). Build Canvas2D now behind the **2–3 methods it actually
needs** (e.g. `resize(w,h)`, `draw(view, buffer, meta)`, `dispose()`). Do **not**
design speculatively for WebGL we can't exercise until M7 — just keep grid
logic (virtualization math, coordinate mapping) out of the draw calls so the
renderer is swappable.

### 4. Level-of-detail by zoom — the perf mechanism, not a feature

At fit-to-screen zoom on a thousands-wide alignment, cells are sub-pixel; you
*cannot* draw letters and hit the fps bar. The LOD tiers ARE how the target is
met (spec §6). Define them by **cell pixel size** (px per column/row):

- **Letter tier** — cell ≥ ~**8 px**: colored cell + residue glyph.
- **Block tier** — ~**3–8 px**: colored cell, no glyph.
- **Density tier** — < ~**3 px**: per-column **occupancy / gap-density** strip
  (or averaged cell color), no per-cell draw. (Identity-to-consensus is M4
  analysis data — explicitly **not** pulled into the M2 strip.)

**Glyph cost (Canvas2D).** After per-frame React state, the #2 fps killer is
`fillText` per cell — a letter-tier screen holds ~10k visible glyphs and naive
`fillText` will miss 60 fps. Mitigation (spec §6's "glyph texture atlas", here
on Canvas2D not just the WebGL path): pre-render each residue glyph once to an
**offscreen canvas atlas** and `drawImage`-blit per cell. Build this at the
letter tier from the start; don't discover it mid-implementation.

Thresholds are starting values to tune against the fps fixture. Cells are square
and uniform for the MVP (one zoom scalar); independent col/row zoom is a later
nicety.

### 5. Three coordinate spaces in the frontend + a parity guard

Same three spaces as spec §4: **ungapped position ↔ alignment column ↔ screen
pixel.** The frontend needs all three live for pan/zoom and the hover readout.

- **column ↔ pixel** is pure view math (scroll + cell size). Extract as pure,
  unit-tested functions.
- **column → ungapped position** (for the tooltip/status readout) is computed
  **in JS from the buffer** — count non-gap bytes in that row up to the column;
  a gap column reads as "no position" (`null`). This honors "no IPC during
  interaction"; O(width) per hover is trivial at width≈thousands.

  **Parity guard (required).** This JS mirror duplicates logic that Rust
  property-tests as the authority (`align-core::coords`, the round-trip
  invariant). To stop silent drift, the JS mapping must match `coords.rs`
  semantics exactly — **gap column → `null`; count excludes gaps; positions are
  0-based internally, surfaced 1-based** — and a test must cross-check a couple
  of cases against engine output (e.g. values from `align-cli`, or a fixture
  with known column→position pairs). The computation in JS is fine; the *parity*
  is what needs the guard.

### 6. Layout

Fixed chrome pinned while the grid scrolls (spec §6):

```
┌──────────────┬───────────────────────────────┐
│              │  position ruler (pinned top)   │
│              ├───────────────────────────────┤
│  name column │  [track lane — M4; empty now]  │
│  (pinned     ├───────────────────────────────┤
│   left)      │                               │
│              │   virtualized grid (scrolls)   │  ← rAF canvas
│              │                               │
├──────────────┴───────────────────────────────┤
│  minimap (synced viewport)                    │
├───────────────────────────────────────────────┤
│  status bar: col N · ungapped pos M · residue  │
└───────────────────────────────────────────────┘
```

Name column and ruler are pinned (own small canvases or a transform-locked
layer) and scroll-synced to the grid. The **track lane** between ruler and grid
is laid out but empty in M2 — M4 fills it with consensus/conservation,
column-aligned to the grid.

**Minimap is an aggregation, not a scaled full draw.** A whole-alignment
overview of a thousands×thousands matrix can't draw every cell either. Its
content is a **downsampled aggregate** (reuse the density-tier reduction —
occupancy / averaged color per bucket), computed **once per load** over the
buffer (cheap in JS; a Rust-side downsample is an option if it ever isn't), then
just the viewport rectangle redraws on scroll/zoom.

## Resolved open question (spec §6, "Open question for M2")

Whether the "absolute" readout is the raw **column index** (`1..=width`) or a
position counted **along a chosen reference sequence**. **M2 decision:** show the
raw **column index** as the absolute coordinate. The per-sequence **ungapped
position** is the biologically meaningful one and is already correct regardless
of leading/trailing gaps. The reference-relative coordinate (offset from a
chosen origin / along a reference) is the *planned third* readout — **deferred**,
not M2. (Matches the `position-readout-coordinates` memo: column + ungapped
position; never call gapped width "length".)

## Risks / traps

- **JSON `number[]` regression.** Easiest wrong turn is reusing the
  `parse_summary` transport for the buffer. Binary response is non-negotiable.
- **State in React.** Putting scroll/zoom in `useState` quietly tanks fps and
  passes every functional test. Decision 2 is the guard; call it out in review.
- **Coordinate drift.** The JS readout disagreeing with the engine later is
  invisible without the parity test (Decision 5).
- **Canvas is hard to unit-test** (jsdom has no real canvas). Acceptance is a
  *manual* fps smoke; what we unit-test is the **pure** viewport/coordinate math
  (visible-window computation, col↔pixel, col→ungapped). Keep drawing a thin
  imperative shell over those pure functions.
- **No new capability.** The render-buffer command is an app-defined
  `#[tauri::command]`, like `load_alignment` — it needs **no** new webview
  capability in `default.json` (capabilities gate the webview, not backend
  commands). Stated so the §3 discipline stays visible.
