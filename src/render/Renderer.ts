// The thin renderer interface (spec §6: "two renderers behind one interface").
// `Canvas2DRenderer` implements it now; a WebGL/pixi renderer slots in at M7
// without touching the grid math, the store, or the chrome. Keep this surface
// minimal — only what the grid container actually calls. Anything that smells
// like virtualization or coordinate math belongs in `render/viewport.ts`, not
// here, so the swap stays mechanical.

import type { AlignmentView } from "../model/view";
import type { Viewport } from "../state/viewport";
import type { ColorScheme } from "./colors";

export interface Renderer {
  /**
   * Set the on-screen size (CSS px) and device pixel ratio of the grid canvas.
   * Called on mount and from the container's ResizeObserver / dpr change.
   * Resizes the backing store; the next `draw` repaints.
   *
   * CONTRACT for the container: the renderer draws into a canvas it sizes here,
   * but computes the visible window from the store's `viewW/viewH`. On EVERY size
   * change call BOTH `renderer.resize(cssW, cssH, dpr)` and
   * `store.resize(cssW, cssH)` with the SAME cssW/cssH — update only one and you
   * get clipped or blank strips (and it passes typecheck silently).
   */
  resize(cssW: number, cssH: number, dpr?: number): void;

  /**
   * Paint the visible window of `view` for `vp` (the current scroll + zoom).
   * Reads only the buffer and viewport — no IPC, no DOM per cell. Safe to call
   * every animation frame; a no-op if the canvas has zero size.
   */
  draw(view: AlignmentView, vp: Viewport): void;

  /**
   * Switch the residue color scheme. Rebuilds the glyph atlas (lazily, re-inked).
   * Does NOT itself schedule a repaint — the caller must mark the grid dirty
   * (e.g. `store.markDirty()`) so the rAF loop draws the new colors.
   */
  setColorScheme(scheme: ColorScheme): void;

  /** Release GPU/canvas resources (atlas, caches). */
  dispose(): void;
}
