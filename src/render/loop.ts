// The requestAnimationFrame draw loop — the "continuous rAF with skip" half of
// the dirty contract in `state/store.ts`. It runs every frame but only repaints
// when the store reports a pending change, so a still grid costs nothing beyond
// an empty callback.
//
// This is the LOOP MECHANISM; the grid container owns its LIFECYCLE — it
// constructs a `RenderLoop` and calls `start()` / `stop()` from a React effect.
// Keeping the mechanism here (out of the React tree) is what keeps pan/zoom off
// the render cycle: handlers mutate the store, the loop reads it, React never
// re-renders per frame.

import type { GridStore } from "../state/store";
import type { Renderer } from "./Renderer";
import type { AlignmentView } from "../model/view";

export class RenderLoop {
  private rafId: number | null = null;
  private running = false;

  /**
   * @param store    holds the per-frame viewport + the dirty flag.
   * @param renderer the target to `draw` into when dirty.
   * @param getView  the current alignment (or `null` before a load) — read each
   *                 dirty frame so a load/unload needs no loop restart.
   */
  constructor(
    private readonly store: GridStore,
    private readonly renderer: Renderer,
    private readonly getView: () => AlignmentView | null,
  ) {}

  /** Begin the loop (idempotent). */
  start(): void {
    if (this.running) return;
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      if (this.store.consumeDirty()) {
        const view = this.getView();
        if (view) this.renderer.draw(view, this.store.getViewport());
      }
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Stop the loop and cancel any pending frame (idempotent). */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
