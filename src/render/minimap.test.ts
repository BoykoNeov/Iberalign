// Minimap geometry tests. The invariant that matters is the ROUND-TRIP: the
// scroll that `minimapToScroll` returns for the CENTER of the viewport rect must
// reproduce the original scroll (so a drag tracks the content without drift), and
// clicking a corner moves the viewport toward that corner. Also the fit-the-view
// and edge-clamp cases.

import { describe, it, expect } from "vitest";
import { viewportRectInMinimap, minimapToScroll } from "./minimap";
import type { Dims, Viewport } from "../state/viewport";

// A viewport over a large alignment: 1000×800 cells at 10px ⇒ 10000×8000 content,
// visible 400×300, scrolled into the interior.
function vp(over: Partial<Viewport> = {}): Viewport {
  return { scrollX: 3000, scrollY: 2000, cellW: 10, cellH: 10, viewW: 400, viewH: 300, ...over };
}
const dims: Dims = { cols: 1000, rows: 800 };
const MINI_W = 600;
const MINI_H = 56;

describe("viewportRectInMinimap", () => {
  it("scales the visible window into the strip", () => {
    const r = viewportRectInMinimap(vp(), dims, MINI_W, MINI_H);
    // content 10000×8000 → 600×56: sx=0.06, sy=0.007
    expect(r.x).toBeCloseTo(3000 * (MINI_W / 10000), 6); // 180
    expect(r.y).toBeCloseTo(2000 * (MINI_H / 8000), 6); // 14
    expect(r.w).toBeCloseTo(400 * (MINI_W / 10000), 6); // 24
    expect(r.h).toBeCloseTo(300 * (MINI_H / 8000), 6); // 2.1
  });

  it("spans the full strip when the content fits the view", () => {
    // 5×5 cells at 10px ⇒ 50×50 content inside a 400×300 view — nothing overflows.
    const small: Dims = { cols: 5, rows: 5 };
    const r = viewportRectInMinimap(vp({ scrollX: 0, scrollY: 0 }), small, MINI_W, MINI_H);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(MINI_W);
    expect(r.h).toBe(MINI_H);
  });

  it("keeps the rect inside the strip at max scroll", () => {
    // scrolled to the bottom-right extreme (content − view on each axis).
    const r = viewportRectInMinimap(vp({ scrollX: 9600, scrollY: 7700 }), dims, MINI_W, MINI_H);
    expect(r.x + r.w).toBeLessThanOrEqual(MINI_W + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(MINI_H + 1e-6);
    expect(r.x).toBeCloseTo(MINI_W - r.w, 6);
    expect(r.y).toBeCloseTo(MINI_H - r.h, 6);
  });

  it("returns a degenerate full rect for an empty alignment", () => {
    const r = viewportRectInMinimap(vp(), { cols: 0, rows: 0 }, MINI_W, MINI_H);
    expect(r).toEqual({ x: 0, y: 0, w: MINI_W, h: MINI_H });
  });
});

describe("round-trip: scroll → rect center → minimapToScroll", () => {
  // Clicking the CENTER of the current viewport rect must return the current
  // scroll (the drag-tracks-content invariant). Holds whenever the scroll is in
  // range (not clamped at an edge).
  const cases = [
    { scrollX: 3000, scrollY: 2000 },
    { scrollX: 0, scrollY: 0 },
    { scrollX: 5000, scrollY: 4000 },
  ];
  for (const sc of cases) {
    it(`scroll (${sc.scrollX}, ${sc.scrollY})`, () => {
      const v = vp(sc);
      const r = viewportRectInMinimap(v, dims, MINI_W, MINI_H);
      const back = minimapToScroll(r.x + r.w / 2, r.y + r.h / 2, v, dims, MINI_W, MINI_H);
      expect(back.x).toBeCloseTo(sc.scrollX, 4);
      expect(back.y).toBeCloseTo(sc.scrollY, 4);
    });
  }
});

describe("minimapToScroll", () => {
  it("centers the viewport on the clicked content fraction", () => {
    // Click dead center of the strip ⇒ scroll that centers the viewport on the
    // content center: contentW/2 − viewW/2 = 5000 − 200 = 4800, etc.
    const v = vp();
    const s = minimapToScroll(MINI_W / 2, MINI_H / 2, v, dims, MINI_W, MINI_H);
    expect(s.x).toBeCloseTo(10000 / 2 - 400 / 2, 4); // 4800
    expect(s.y).toBeCloseTo(8000 / 2 - 300 / 2, 4); // 3850
  });

  it("maps the top-left corner to a negative (pre-clamp) scroll", () => {
    // Clicking the very corner asks to center the viewport on content (0,0), i.e.
    // scroll −viewW/2 / −viewH/2 — GridStore.scrollTo clamps it back to 0.
    const v = vp();
    const s = minimapToScroll(0, 0, v, dims, MINI_W, MINI_H);
    expect(s.x).toBeCloseTo(-200, 4);
    expect(s.y).toBeCloseTo(-150, 4);
  });
});
