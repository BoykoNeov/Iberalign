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

import { useEffect, useRef } from "react";
import type { AlignmentView } from "../model/view";
import { GridStore } from "../state/store";
import { Canvas2DRenderer } from "../render/Canvas2DRenderer";
import { RenderLoop } from "../render/loop";
import "./Grid.css";

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
  // Read by the rAF loop each dirty frame and by the view-change effect; kept in
  // a ref so a new alignment never restarts the loop.
  const viewRef = useRef<AlignmentView | null>(null);
  const storeRef = useRef<GridStore | null>(null);

  // Mount once: build store/renderer/loop, attach input, start drawing. Has no
  // `view` dependency — the view-change effect below feeds dims; this keeps a new
  // load from tearing down the canvas. Cleanup fully releases everything and
  // nulls the refs so React 19 StrictMode's double-mount can't leave two loops.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const cell = cellRef.current!;
    const store = new GridStore();
    const renderer = new Canvas2DRenderer(canvas);
    const loop = new RenderLoop(store, renderer, () => viewRef.current);
    storeRef.current = store;

    const dpr = () => globalThis.devicePixelRatio || 1;

    // Resize: feed the SAME css w/h to both the renderer (backing store) and the
    // store (viewport extent) — the contract in `Renderer.ts`. Observing the cell
    // (not the container) keeps viewW/viewH = drawing area once chrome lands.
    // The observer fires once on observe() with the initial size → first draw.
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      renderer.resize(r.width, r.height, dpr());
      store.resize(r.width, r.height);
    });
    ro.observe(cell);

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
      } else {
        store.pan(e.deltaX, e.deltaY);
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Drag-pan with pointer capture so a drag that leaves the canvas keeps going.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      // Grab-and-drag: moving the pointer right reveals content to the left, so
      // scroll moves opposite the pointer delta.
      store.pan(lastX - e.clientX, lastY - e.clientY);
      lastX = e.clientX;
      lastY = e.clientY;
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

    loop.start();

    return () => {
      loop.stop();
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      renderer.dispose();
      storeRef.current = null;
    };
  }, []);

  // New (or first) alignment: point the loop's view ref at it and reset dims +
  // scroll. Runs after the mount effect on first render (declaration order), so
  // the store exists; the guard covers the StrictMode remount window.
  useEffect(() => {
    viewRef.current = view;
    storeRef.current?.setDims(view.width, view.numRows);
  }, [view]);

  return (
    <div className="grid-container">
      <div className="grid-canvas-cell" ref={cellRef}>
        <canvas ref={canvasRef} className="grid-canvas" />
      </div>
    </div>
  );
}
