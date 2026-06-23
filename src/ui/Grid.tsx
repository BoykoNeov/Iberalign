// `Grid` — the container that mounts the Canvas2D grid, owns the per-frame
// machinery, and wires pointer/wheel input. It is the integration point the rest
// of M2's chrome hangs off (spec §3, §6).
//
// OWNERSHIP. This component owns the `GridStore` (per-frame viewport + dirty
// flag), the `Canvas2DRenderer`, and the `RenderLoop` — all created once in a
// mount effect and held in refs, never in React state, because they change every
// frame and React must never re-render on them. `App` owns the `AlignmentView`
// (load is the one coarse event) and hands it in as a prop; a new view reuses the
// same store/renderer (no remount).
//
// CHROME OWNER, not a sibling. The outer `.grid-container` is a CSS grid that
// will hold the pinned name column, ruler, and track lane alongside the canvas;
// today it renders only the canvas cell. Those land as *children* here so they
// read the store this component already owns — adding them is pure layout
// addition, no store lift, no refactor.
//
// VIEWPORT ORIGIN. The `ResizeObserver` watches the *canvas cell*, not the outer
// container: `Viewport.viewW/viewH` must equal the grid drawing area alone
// (origin excludes the name column + ruler — see `state/viewport.ts`). Observing
// the cell keeps that true once the chrome arrives in the sibling cells.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AlignmentView } from "../model/view";
import { GridStore } from "../state/store";
import { Canvas2DRenderer } from "../render/Canvas2DRenderer";
import { RulerRenderer } from "../render/RulerRenderer";
import { NameColumnRenderer } from "../render/NameColumnRenderer";
import { ScrollbarsLayer } from "../render/ScrollbarsLayer";
import { SelectionLayer } from "../render/SelectionLayer";
import { layoutScrollbars, scrollForThumbPos, SCROLLBAR_THICKNESS } from "../render/scrollbar";
import { RenderLoop } from "../render/loop";
import { lodFor } from "../render/lod";
import type { Dims } from "../state/viewport";
import { DEFAULT_CELL } from "../state/viewport";
import { NAME_W, RULER_H } from "../render/chrome";
import { computeHover, cellAtPixel, type HoverInfo } from "./hover";
import StatusBar from "./StatusBar";
import Toolbar from "./Toolbar";
import { normalize, rectDims } from "../state/selection";
import { buildCopyText, COPY_CELL_CAP, type CopyFormat } from "../model/copy";
import { copyText } from "../ipc/clipboard";
import { clearCells, undoEdit, redoEdit } from "../ipc/edit";
import "./Grid.css";

// CSS vars driven from the JS chrome constants so the grid track sizes and the
// painters' backing stores share one source of truth (can't drift apart).
const CHROME_VARS = {
  "--name-w": `${NAME_W}px`,
  "--ruler-h": `${RULER_H}px`,
  // The CSS thumb thickness MUST match the geometry constant: `layoutScrollbars`
  // shortens each track by this when both bars show, so the visual bar and the
  // reserved corner gap can't disagree.
  "--scrollbar-thickness": `${SCROLLBAR_THICKNESS}px`,
} as CSSProperties;

// Wheel-zoom sensitivity: factor = exp(-deltaY * k). One ~100px notch ⇒ ~1.22×
// in / 0.82× out, smooth on trackpads where deltaY is finer-grained.
const ZOOM_SENSITIVITY = 0.002;

// Pointer travel (CSS px) past which a press is a PAN, not a click. Under it, the
// release selects the cell; over it, left-drag pans (unchanged from M2).
const DRAG_THRESHOLD = 4;

// Keys that move the cursor RELATIVE to its current cell (so when there's no
// selection yet they instead seed the cursor at the top-left visible cell). The
// absolute jumps (Ctrl/⌘+Home/End/A) are handled before this and act regardless.
const RELATIVE_NAV = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

interface GridProps {
  /** The loaded alignment. Non-null: `App` mounts `Grid` only once a view exists. */
  view: AlignmentView;
}

export default function Grid({ view }: GridProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const nameRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef<HTMLCanvasElement>(null);
  const selBorderRef = useRef<HTMLCanvasElement>(null);
  const vThumbRef = useRef<HTMLDivElement>(null);
  const hThumbRef = useRef<HTMLDivElement>(null);
  // Read by the rAF loop each dirty frame and by the view-change effect; kept in
  // a ref so a new alignment never restarts the loop.
  const viewRef = useRef<AlignmentView | null>(null);
  const storeRef = useRef<GridStore | null>(null);

  // The hovered cell, driving the status bar + tooltip. This is the ONE piece of
  // React state the grid carries: it changes on a *readout value change* (a new
  // cell under the cursor), never per frame — so React re-renders coarsely while
  // the canvas keeps drawing on its own rAF loop. `lastCellRef` throttles
  // `setHover` to cell identity (the cell's flat index, or `null` off-grid) so a
  // pixel move within one cell doesn't re-render.
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const lastCellRef = useRef<number | null>(null);

  // The current zoom (cell size in CSS px), surfaced in the status bar. Like
  // `hover`, this is coarse React state: it changes only on a zoom event, never
  // per frame, so the canvas keeps drawing on its own rAF loop. `lastZoomRef`
  // throttles `setZoom` to the *displayed* identity (rounded px + LOD tier) so a
  // sub-pixel zoom delta doesn't re-render. Initialized `null` so the first zoom
  // always pushes (and it can't drift if `DEFAULT_CELL` changes).
  const [zoom, setZoom] = useState(DEFAULT_CELL);
  const lastZoomRef = useRef<string | null>(null);

  // Copy controls (Batch A — selection → clipboard). `selInfo` is the selected
  // block's size, mirrored coarsely from the store for the toolbar readout and the
  // Copy button's enabled state; `copyFormat` is the Raw|FASTA toggle; `copyMsg` is
  // an ephemeral toolbar message. The refs back the once-bound keydown handler:
  // `copyFormatRef` shadows the format so the handler reads the live value without
  // re-binding; `lastSelRef` throttles the readout re-render to the selection's
  // SIZE identity (a cursor moving within the same dims costs no render);
  // `doCopyRef` is the latest-callback bridge the keydown calls; `msgTimerRef`
  // clears the transient message.
  const [selInfo, setSelInfo] = useState<{ rows: number; cols: number } | null>(null);
  const lastSelRef = useRef<string | null>(null);
  const [copyFormat, setCopyFormat] = useState<CopyFormat>("raw");
  const copyFormatRef = useRef<CopyFormat>("raw");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const msgTimerRef = useRef<number | null>(null);
  const doCopyRef = useRef<() => void>(() => {});

  // Guards against overlapping edits: a held Ctrl+Z would otherwise fire
  // concurrent undo() invokes whose completion order Tauri doesn't guarantee.
  // While an edit's IPC round-trip is in flight, further edit keys are ignored.
  const editingRef = useRef(false);

  // Flash an ephemeral message in the toolbar, auto-clearing after a moment.
  const showMsg = useCallback((msg: string) => {
    setCopyMsg(msg);
    if (msgTimerRef.current !== null) window.clearTimeout(msgTimerRef.current);
    msgTimerRef.current = window.setTimeout(() => {
      setCopyMsg(null);
      msgTimerRef.current = null;
    }, 2500);
  }, []);

  // Copy the selected block to the clipboard in the current format. Stable (reads
  // store/view/format via refs), so the keydown handler bound once below can call
  // it through `doCopyRef`. Guards the select-all-on-the-stress-fixture case
  // (COPY_CELL_CAP) rather than freezing on a ~100M-char build.
  const doCopy = useCallback(async () => {
    const store = storeRef.current;
    const view = viewRef.current;
    if (!store || !view) return;
    const sel = store.getSelection();
    if (!sel) {
      showMsg("Select cells first, then copy");
      return;
    }
    const rect = normalize(sel);
    const { rows, cols } = rectDims(rect);
    if (rows * cols > COPY_CELL_CAP) {
      showMsg(`Selection too large to copy (${rows * cols} cells; limit ${COPY_CELL_CAP})`);
      return;
    }
    try {
      await copyText(buildCopyText(view, rect, copyFormatRef.current));
      showMsg(`Copied ${cols} × ${rows} (${copyFormatRef.current === "fasta" ? "FASTA" : "raw"})`);
    } catch (e) {
      showMsg(`Copy failed: ${String(e)}`);
    }
  }, [showMsg]);
  doCopyRef.current = doCopy;

  // Toggle the copy format from the toolbar; mirror into the ref the keydown reads.
  const handleSetFormat = useCallback((format: CopyFormat) => {
    copyFormatRef.current = format;
    setCopyFormat(format);
  }, []);

  // Mount once: build store/renderer/loop, attach input, start drawing. Has no
  // `view` dependency — the view-change effect below feeds dims; this keeps a new
  // load from tearing down the canvas. Cleanup fully releases everything and
  // nulls the refs so React 19 StrictMode's double-mount can't leave two loops.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const cell = cellRef.current!;
    const store = new GridStore();
    const renderer = new Canvas2DRenderer(canvas);
    const ruler = new RulerRenderer(rulerRef.current!);
    const names = new NameColumnRenderer(nameRef.current!);
    // Two canvases: the invert canvas (mix-blend-mode: difference) and the
    // non-blending border canvas stacked above it — SelectionLayer owns and sizes
    // both, so one `selection.resize(...)` below keeps them in lockstep.
    const selection = new SelectionLayer(
      selRef.current!,
      selBorderRef.current!,
      () => store.getSelection(),
    );
    const scrollbars = new ScrollbarsLayer(vThumbRef.current!, hThumbRef.current!);
    // Grid first, then chrome, then the selection overlay, then the scrollbar
    // thumbs — all updated in one dirty frame, so they never lag the grid under
    // pan/zoom. (Stacking is by z-index/DOM, not array order; the order just keeps
    // the selection repainting every dirty frame alongside the grid.)
    const loop = new RenderLoop(
      store,
      [renderer, ruler, names, selection, scrollbars],
      () => viewRef.current,
    );
    storeRef.current = store;

    // Mirror selection changes into React for the toolbar readout + Copy enabled
    // state — coarse, throttled to the selection's SIZE identity, so a cursor
    // moving within the same dims costs no render. The rAF loop still reads the
    // store's selection directly for drawing; this only feeds the toolbar.
    store.setSelectionListener((sel) => {
      if (!sel) {
        if (lastSelRef.current === null) return;
        lastSelRef.current = null;
        setSelInfo(null);
        return;
      }
      const dims = rectDims(normalize(sel));
      const key = `${dims.cols}x${dims.rows}`;
      if (key === lastSelRef.current) return;
      lastSelRef.current = key;
      setSelInfo(dims);
    });

    const dpr = () => globalThis.devicePixelRatio || 1;

    // Resize: feed the SAME css w/h to both the renderer (backing store) and the
    // store (viewport extent) — the contract in `Renderer.ts`. Observe the grid
    // CELL only: its size is the viewport extent (viewW/viewH excludes chrome).
    // The chrome canvases derive from it — ruler spans the grid width at a fixed
    // height, the name column the grid height at a fixed width — so one observer
    // sizes everything and the layout can't disagree with the painters. The
    // observer fires once on observe() with the initial size → first draw.
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const d = dpr();
      renderer.resize(r.width, r.height, d);
      store.resize(r.width, r.height);
      ruler.resize(r.width, RULER_H, d);
      names.resize(NAME_W, r.height, d);
      // Same css w/h/dpr as the grid canvas (it overlays it exactly) — else the
      // selection rectangle drifts a sub-pixel off the cells.
      selection.resize(r.width, r.height, d);
    });
    ro.observe(cell);

    // Resolve the cell under a viewport-space cursor (window px) and push it to
    // the readout — but only when the *cell* changes (or grid↔off-grid), so a
    // pixel move inside one cell costs no React render. Reads the live viewport
    // and view from refs, so it reflects pan/zoom already applied this event.
    const updateHover = (clientX: number, clientY: number) => {
      const view = viewRef.current;
      if (!view) return;
      const rect = canvas.getBoundingClientRect();
      const info = computeHover(view, store.getViewport(), clientX - rect.left, clientY - rect.top);
      const key = info ? info.row * view.width + info.col : null;
      if (key === lastCellRef.current) return;
      lastCellRef.current = key;
      setHover(info);
    };

    // Wheel: ctrl/⌘ → zoom about the cursor; otherwise → pan. Native + passive:
    // false so preventDefault actually suppresses page zoom/scroll (React's JSX
    // onWheel is passive and would log a warning + zoom the whole page).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        store.zoom(Math.exp(-e.deltaY * ZOOM_SENSITIVITY), ax, ay);
        // Push the new zoom to the status bar, throttled to its displayed
        // identity: re-render only when the rounded px OR the LOD tier changes (a
        // tier flip can hide inside one rounding bucket right at 3 px, so key on
        // both). Coarse and event-driven — never per frame.
        const { cellW } = store.getViewport();
        const key = `${Math.round(cellW * 10) / 10}|${lodFor(cellW)}`;
        if (key !== lastZoomRef.current) {
          lastZoomRef.current = key;
          setZoom(cellW);
        }
      } else {
        store.pan(e.deltaX, e.deltaY);
      }
      // Zoom/pan moved the content under a stationary cursor — refresh the
      // readout against the just-applied viewport.
      updateHover(e.clientX, e.clientY);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Pointer model (two buttons, two gestures):
    //   - LEFT (0) = SELECT. A press releasing under DRAG_THRESHOLD is a click →
    //     set the cursor (Shift+click extends from the existing anchor). Past the
    //     threshold it's a rubber-band drag → anchor at the down cell, then extend
    //     the active end to the cell under the pointer each move (Shift+drag keeps
    //     the existing anchor and only moves the active end).
    //   - MIDDLE (1, the wheel pressed) = PAN — grab-and-drag the view (the gesture
    //     left-drag used in M2). The `dragging` class (→ grabbing cursor) shows only
    //     while panning; the default cursor is `cell` (select). `onMouseDown` below
    //     kills the WebView2 middle-click autoscroll.
    // Pointer capture keeps either gesture alive past the canvas edge.
    type PointerMode = "none" | "select" | "pan";
    let mode: PointerMode = "none";
    let moved = false;
    let downShift = false;
    let anchored = false; // rubber-band anchor placed (after crossing the threshold)
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;

    // The cell under a viewport-space cursor (window px), or null off-grid. Reads
    // the live viewport/view so it reflects pan/zoom already applied this event.
    const cellAt = (clientX: number, clientY: number) => {
      const v = viewRef.current;
      if (!v) return null;
      const rect = canvas.getBoundingClientRect();
      return cellAtPixel(v, store.getViewport(), clientX - rect.left, clientY - rect.top);
    };

    // Chromium (WebView2) starts middle-click autoscroll on the middle mousedown;
    // preventDefault THERE suppresses it — preventDefault on `pointerdown` does not.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return; // ignore right / extra buttons
      // Take keyboard focus so arrows/Page/Home/End drive the cursor (the cell is
      // tabIndex=0). preventScroll: it's already on screen — don't nudge the layout.
      cell.focus({ preventScroll: true });
      moved = false;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 0) {
        mode = "select";
        downShift = e.shiftKey;
        anchored = false;
      } else {
        mode = "pan";
        canvas.classList.add("dragging");
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (mode === "pan") {
        // Grab-and-drag: moving the pointer right reveals content to the left, so
        // scroll moves opposite the pointer delta.
        store.pan(lastX - e.clientX, lastY - e.clientY);
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (mode === "select") {
        if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD) {
          moved = true;
        }
        if (moved) {
          const hit = cellAt(e.clientX, e.clientY);
          if (hit) {
            if (!anchored) {
              // Begin the rubber-band: a plain drag anchors at the down cell; a
              // Shift+drag keeps the existing anchor and only moves the active end.
              if (!downShift) {
                const start = cellAt(startX, startY);
                if (start) store.setCursor(start.row, start.col);
              }
              anchored = true;
            }
            store.setActive(hit.row, hit.col);
          }
        }
      }
      // Hover tracks every move (panning moves the cell under the cursor too).
      updateHover(e.clientX, e.clientY);
    };
    // Pointer left the canvas (and not mid-gesture): drop the readout.
    const onPointerLeave = () => {
      if (mode !== "none") return;
      lastCellRef.current = null;
      setHover(null);
    };
    const endPointer = (e: PointerEvent) => {
      if (mode === "none") return;
      // A left press that never crossed the drag threshold is a click; a cancel is
      // never a click.
      const wasClick = mode === "select" && !moved && e.type === "pointerup";
      mode = "none";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.classList.remove("dragging");
      if (!wasClick) return;
      const hit = cellAt(e.clientX, e.clientY);
      if (!hit) return;
      // Shift+click extends the rectangle from the existing anchor; a plain click
      // collapses to a single-cell cursor.
      if (e.shiftKey) store.setActive(hit.row, hit.col);
      else store.setCursor(hit.row, hit.col);
    };
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", onPointerLeave);

    // Run a reversible edit: invoke the IPC op (which returns the post-edit render
    // buffer), copy it into the view's buffer in place, and repaint. Serialized via
    // `editingRef` so a held key can't fire overlapping, out-of-order invokes. An
    // empty buffer means a no-op (e.g. undo at the bottom of the stack) — skip the
    // patch. The in-place copy keeps the same `AlignmentView` (App's `view` prop is
    // untouched), so scroll + selection survive the edit.
    const runEdit = async (op: () => Promise<Uint8Array>) => {
      const v = viewRef.current;
      if (!v || editingRef.current) return;
      editingRef.current = true;
      try {
        const bytes = await op();
        if (bytes.length > 0) {
          v.replaceContents(bytes);
          // The cell tiers re-read the buffer each draw, but the density tier's
          // occupancy is memoized by view identity — drop it so a zoom-out after an
          // edit doesn't show stale bars (the view object is reused in place).
          renderer.invalidateContentCaches();
          store.markDirty();
        }
      } catch (err) {
        showMsg(`Edit failed: ${String(err)}`);
      } finally {
        editingRef.current = false;
      }
    };

    // Keyboard cursor movement (cell is focusable). Arrows move the cursor (the
    // M2 arrow-PAN is gone — see selection-plan.md); Shift+arrows extend the
    // rectangle; Page moves a page of rows; Home/End jump to the row's left/right
    // extreme; Ctrl/⌘+Home/End to the alignment's first/last cell; Esc collapses;
    // Ctrl/⌘+A selects all. Home/End/corner reuse the cursor movers with a `FAR`
    // delta the reducers clamp to the edge (same idiom the old scroll handler
    // used) — so the LAST row/col stays reachable, now via the cursor + its
    // scroll-into-view. Only handled keys `preventDefault`.
    const onKeyDown = (e: KeyboardEvent) => {
      const v = viewRef.current;
      if (!v) return;
      // Copy (Ctrl/⌘+C) — handled here so a grid-focused copy serializes the
      // selected block (our copier), not the browser's empty text selection.
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        void doCopyRef.current();
        return;
      }
      // Delete / Backspace — clear (mask to gaps) the selected rectangle. The
      // first reversible edit (Delete = clear-to-gap; Cut = remove + close up
      // lands later). No selection ⇒ nothing to delete.
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = store.getSelection();
        if (sel) {
          e.preventDefault();
          void runEdit(() => clearCells(normalize(sel)));
        }
        return;
      }
      // Undo / Redo. Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redoes.
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        void runEdit(e.shiftKey ? redoEdit : undoEdit);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        void runEdit(redoEdit);
        return;
      }
      const corner = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const FAR = Number.MAX_SAFE_INTEGER; // clamped to the content edge by the reducers

      // Absolute commands first — they act regardless of whether a selection
      // exists yet (so Ctrl+End with no selection reaches the last cell, it
      // doesn't seed top-left).
      if (corner && (e.key === "a" || e.key === "A")) {
        store.selectAll();
      } else if (corner && e.key === "Home") {
        if (shift) store.extendActive(-FAR, -FAR);
        else store.moveCursor(-FAR, -FAR); // first cell (0,0)
      } else if (corner && e.key === "End") {
        if (shift) store.extendActive(FAR, FAR);
        else store.moveCursor(FAR, FAR); // last cell
      } else if (e.key === "Escape") {
        store.collapseSelection();
      } else if (store.getSelection() === null && RELATIVE_NAV.has(e.key)) {
        // First navigation with nothing selected: place the cursor at the top-left
        // VISIBLE cell (on screen, not (0,0) off-screen) and don't move yet.
        const vp = store.getViewport();
        const r = Math.min(Math.max(0, Math.floor(vp.scrollY / vp.cellH)), v.numRows - 1);
        const c = Math.min(Math.max(0, Math.floor(vp.scrollX / vp.cellW)), v.width - 1);
        store.setCursor(r, c);
      } else {
        const vp = store.getViewport();
        // A "page" is a viewport of rows less one of overlap, never below one row.
        const pageRows = Math.max(1, Math.floor(vp.viewH / vp.cellH) - 1);
        const move = (dr: number, dc: number) =>
          shift ? store.extendActive(dr, dc) : store.moveCursor(dr, dc);
        switch (e.key) {
          case "ArrowUp":
            move(-1, 0);
            break;
          case "ArrowDown":
            move(1, 0);
            break;
          case "ArrowLeft":
            move(0, -1);
            break;
          case "ArrowRight":
            move(0, 1);
            break;
          case "PageUp":
            move(-pageRows, 0);
            break;
          case "PageDown":
            move(pageRows, 0);
            break;
          case "Home":
            move(0, -FAR); // row start
            break;
          case "End":
            move(0, FAR); // row end
            break;
          default:
            return; // unhandled — leave it for the browser
        }
      }
      e.preventDefault();
    };
    cell.addEventListener("keydown", onKeyDown);

    // Scrollbar thumb drag. The thumbs float over the canvas edges; dragging one
    // recomputes the SAME `layoutScrollbars` against the live viewport (shared
    // geometry → exact round-trip) and writes an absolute scroll. `grab` is the
    // cursor's offset within the thumb at grab time, so the thumb doesn't jump to
    // the cursor on the first move. Pointer capture keeps the drag alive past the
    // thumb's edges. The OTHER axis is held fixed.
    const dimsNow = (): Dims => ({ cols: viewRef.current!.width, rows: viewRef.current!.numRows });
    let vGrab = 0;
    let hGrab = 0;
    let vDragging = false;
    let hDragging = false;
    const vThumb = vThumbRef.current!;
    const hThumb = hThumbRef.current!;

    const onVThumbDown = (e: PointerEvent) => {
      if (e.button !== 0 || !viewRef.current) return;
      e.preventDefault();
      const rect = cell.getBoundingClientRect();
      const { v } = layoutScrollbars(store.getViewport(), dimsNow());
      vGrab = e.clientY - rect.top - v.thumbPos;
      vDragging = true;
      vThumb.setPointerCapture(e.pointerId);
    };
    const onVThumbMove = (e: PointerEvent) => {
      if (!vDragging || !viewRef.current) return;
      const rect = cell.getBoundingClientRect();
      const vp2 = store.getViewport();
      const { v } = layoutScrollbars(vp2, dimsNow());
      store.scrollTo(vp2.scrollX, scrollForThumbPos(e.clientY - rect.top - vGrab, v));
    };
    const onHThumbDown = (e: PointerEvent) => {
      if (e.button !== 0 || !viewRef.current) return;
      e.preventDefault();
      const rect = cell.getBoundingClientRect();
      const { h } = layoutScrollbars(store.getViewport(), dimsNow());
      hGrab = e.clientX - rect.left - h.thumbPos;
      hDragging = true;
      hThumb.setPointerCapture(e.pointerId);
    };
    const onHThumbMove = (e: PointerEvent) => {
      if (!hDragging || !viewRef.current) return;
      const rect = cell.getBoundingClientRect();
      const vp2 = store.getViewport();
      const { h } = layoutScrollbars(vp2, dimsNow());
      store.scrollTo(scrollForThumbPos(e.clientX - rect.left - hGrab, h), vp2.scrollY);
    };
    const endVThumb = (e: PointerEvent) => {
      if (!vDragging) return;
      vDragging = false;
      if (vThumb.hasPointerCapture(e.pointerId)) vThumb.releasePointerCapture(e.pointerId);
    };
    const endHThumb = (e: PointerEvent) => {
      if (!hDragging) return;
      hDragging = false;
      if (hThumb.hasPointerCapture(e.pointerId)) hThumb.releasePointerCapture(e.pointerId);
    };
    vThumb.addEventListener("pointerdown", onVThumbDown);
    vThumb.addEventListener("pointermove", onVThumbMove);
    vThumb.addEventListener("pointerup", endVThumb);
    vThumb.addEventListener("pointercancel", endVThumb);
    hThumb.addEventListener("pointerdown", onHThumbDown);
    hThumb.addEventListener("pointermove", onHThumbMove);
    hThumb.addEventListener("pointerup", endHThumb);
    hThumb.addEventListener("pointercancel", endHThumb);

    loop.start();

    return () => {
      loop.stop();
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      cell.removeEventListener("keydown", onKeyDown);
      vThumb.removeEventListener("pointerdown", onVThumbDown);
      vThumb.removeEventListener("pointermove", onVThumbMove);
      vThumb.removeEventListener("pointerup", endVThumb);
      vThumb.removeEventListener("pointercancel", endVThumb);
      hThumb.removeEventListener("pointerdown", onHThumbDown);
      hThumb.removeEventListener("pointermove", onHThumbMove);
      hThumb.removeEventListener("pointerup", endHThumb);
      hThumb.removeEventListener("pointercancel", endHThumb);
      renderer.dispose();
      ruler.dispose();
      names.dispose();
      selection.dispose();
      store.setSelectionListener(undefined);
      if (msgTimerRef.current !== null) {
        window.clearTimeout(msgTimerRef.current);
        msgTimerRef.current = null;
      }
      storeRef.current = null;
    };
  }, []);

  // New (or first) alignment: point the loop's view ref at it and reset dims +
  // scroll. Runs after the mount effect on first render (declaration order), so
  // the store exists; the guard covers the StrictMode remount window.
  useEffect(() => {
    viewRef.current = view;
    storeRef.current?.setDims(view.width, view.numRows);
    // The old readout referenced the previous alignment's rows — drop it so a
    // stale name/position can't linger until the next pointer move.
    lastCellRef.current = null;
    setHover(null);
  }, [view]);

  // Zoom to an absolute cell size in CSS px (the status-bar slider). There is no
  // cursor for a slider drag, so anchor the zoom at the viewport CENTRE — the
  // factor `target/current` makes `zoomAbout` reduce to `clampCell(target)`, i.e.
  // it reuses the same tested clamp path the wheel uses. Stable identity (refs +
  // setState only), so it never re-fires the mount effect. Pushes `setZoom`
  // *unthrottled* so the controlled thumb tracks the drag exactly — one tiny
  // status-bar render per input event, never per frame — and keeps `lastZoomRef`
  // in sync so the wheel path's throttle still compares against the right key.
  const handleZoomTo = useCallback((targetCell: number) => {
    const store = storeRef.current;
    if (!store) return;
    const vp = store.getViewport();
    if (vp.cellW <= 0) return;
    store.zoom(targetCell / vp.cellW, vp.viewW / 2, vp.viewH / 2);
    const { cellW } = store.getViewport();
    lastZoomRef.current = `${Math.round(cellW * 10) / 10}|${lodFor(cellW)}`;
    setZoom(cellW);
  }, []);

  // Shell: a flex column holding the pinned-chrome grid (flex:1) over the status
  // bar (auto height). The grid is a 2×2 CSS grid — corner, ruler (top), name
  // column (left), grid cell (bottom-right); auto-placement fills in DOM order,
  // and only the grid cell is observed for the viewport extent. The hovered
  // cell's readout shows in the status bar at the bottom — no floating overlay
  // over the canvas.
  return (
    <div className="grid-shell">
      <Toolbar
        selInfo={selInfo}
        copyFormat={copyFormat}
        onSetFormat={handleSetFormat}
        onCopy={doCopy}
        message={copyMsg}
      />
      <div className="grid-container" style={CHROME_VARS}>
        <div className="grid-corner" />
        <canvas ref={rulerRef} className="grid-ruler" />
        <canvas ref={nameRef} className="grid-names" />
        <div
          className="grid-canvas-cell"
          ref={cellRef}
          tabIndex={0}
          role="application"
          aria-label="Alignment grid — click to select a cell, drag to select a range; arrow / Page / Home / End move the cursor (Shift extends the selection); middle-drag or scroll to pan"
        >
          <canvas ref={canvasRef} className="grid-canvas" />
          {/* Selection overlay (two canvases, both painted by SelectionLayer each
              dirty frame, both pointer-events:none so clicks fall through to the
              grid). The invert canvas (mix-blend-mode: difference) flips the residue
              colors under the selection; the border canvas above it (no blend mode)
              holds the constant-color thick accent border. */}
          <canvas ref={selRef} className="grid-selection" />
          <canvas ref={selBorderRef} className="grid-selection-border" />
          {/* Floating overlay scrollbars: positioned each dirty frame by
              ScrollbarsLayer (style only), drag-handled in the mount effect. */}
          <div ref={vThumbRef} className="grid-scrollbar grid-scrollbar-v" />
          <div ref={hThumbRef} className="grid-scrollbar grid-scrollbar-h" />
        </div>
      </div>
      <StatusBar hover={hover} zoom={zoom} onZoomTo={handleZoomTo} />
    </div>
  );
}
