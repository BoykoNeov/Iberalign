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
import { layoutScrollbars, scrollForThumbPos, SCROLLBAR_THICKNESS } from "../render/scrollbar";
import { RenderLoop } from "../render/loop";
import { lodFor } from "../render/lod";
import type { Dims } from "../state/viewport";
import { DEFAULT_CELL } from "../state/viewport";
import { NAME_W, RULER_H } from "../render/chrome";
import { computeHover, type HoverInfo } from "./hover";
import StatusBar from "./StatusBar";
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

interface GridProps {
  /** The loaded alignment. Non-null: `App` mounts `Grid` only once a view exists. */
  view: AlignmentView;
}

export default function Grid({ view }: GridProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const nameRef = useRef<HTMLCanvasElement>(null);
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
    const scrollbars = new ScrollbarsLayer(vThumbRef.current!, hThumbRef.current!);
    // Grid first, then chrome, then the scrollbar thumbs — all updated in one
    // dirty frame, so the thumbs / ruler / name column never lag the grid under
    // pan/zoom.
    const loop = new RenderLoop(store, [renderer, ruler, names, scrollbars], () => viewRef.current);
    storeRef.current = store;

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

    // Drag-pan with pointer capture so a drag that leaves the canvas keeps going.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Take keyboard focus so arrows/Page/Home/End scroll the grid (the cell is
      // tabIndex=0). preventScroll: it's already on screen — don't let the browser
      // nudge the layout to "reveal" it.
      cell.focus({ preventScroll: true });
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) {
        // Grab-and-drag: moving the pointer right reveals content to the left, so
        // scroll moves opposite the pointer delta.
        store.pan(lastX - e.clientX, lastY - e.clientY);
        lastX = e.clientX;
        lastY = e.clientY;
      }
      // Hover tracks every move (panning moves the cell under the cursor too).
      updateHover(e.clientX, e.clientY);
    };
    // Pointer left the canvas (and not mid-capture): drop the readout.
    const onPointerLeave = () => {
      if (dragging) return;
      lastCellRef.current = null;
      setHover(null);
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", onPointerLeave);

    // Keyboard scroll (cell is focusable). Arrows nudge a cell; Page steps a
    // viewport; Home/End jump to the row's left/right extreme; Ctrl/⌘+Home/End to
    // the alignment's top-left / bottom-right corner — the latter is what makes
    // the LAST row/col always reachable without a drag. Absolute jumps use a huge
    // target and lean on `store.scrollTo`'s clamp; only handled keys
    // `preventDefault` (so an unbound key still does its normal thing).
    const onKeyDown = (e: KeyboardEvent) => {
      if (!viewRef.current) return;
      const vp = store.getViewport();
      const corner = e.ctrlKey || e.metaKey;
      // A "page" is a viewport less one cell of overlap, never below one cell.
      const pageY = Math.max(vp.cellH, vp.viewH - vp.cellH);
      const FAR = Number.MAX_SAFE_INTEGER; // clamped to the content edge by scrollTo
      switch (e.key) {
        case "ArrowUp":
          store.pan(0, -vp.cellH);
          break;
        case "ArrowDown":
          store.pan(0, vp.cellH);
          break;
        case "ArrowLeft":
          store.pan(-vp.cellW, 0);
          break;
        case "ArrowRight":
          store.pan(vp.cellW, 0);
          break;
        case "PageUp":
          store.pan(0, -pageY);
          break;
        case "PageDown":
          store.pan(0, pageY);
          break;
        case "Home":
          store.scrollTo(0, corner ? 0 : vp.scrollY);
          break;
        case "End":
          store.scrollTo(FAR, corner ? FAR : vp.scrollY);
          break;
        default:
          return; // unhandled — leave it for the browser
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
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
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
      <div className="grid-container" style={CHROME_VARS}>
        <div className="grid-corner" />
        <canvas ref={rulerRef} className="grid-ruler" />
        <canvas ref={nameRef} className="grid-names" />
        <div
          className="grid-canvas-cell"
          ref={cellRef}
          tabIndex={0}
          role="application"
          aria-label="Alignment grid — drag, scroll, or use arrow / Page / Home / End keys to navigate"
        >
          <canvas ref={canvasRef} className="grid-canvas" />
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
