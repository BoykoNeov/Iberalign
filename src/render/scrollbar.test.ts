// Scrollbar geometry tests. The invariant that matters is the ROUND-TRIP: a thumb
// at the position `axisScrollbar` reports for a given scroll must map back to that
// same scroll under `scrollForThumbPos` — otherwise a drag would drift. Also the
// edges (top/bottom pinning), the min-thumb floor, the not-needed case, and the
// corner-sharing track shortening.

import { describe, it, expect } from "vitest";
import {
  axisScrollbar,
  scrollForThumbPos,
  layoutScrollbars,
  SCROLLBAR_MIN_THUMB,
  SCROLLBAR_THICKNESS,
} from "./scrollbar";
import type { Dims, Viewport } from "../state/viewport";

describe("axisScrollbar", () => {
  it("is not visible when content fits the view", () => {
    const sb = axisScrollbar(0, 200, 300, 300);
    expect(sb.visible).toBe(false);
    expect(sb.maxScroll).toBe(0);
  });

  it("thumb length is proportional to the visible fraction", () => {
    // half the content is visible ⇒ thumb is half the track.
    const sb = axisScrollbar(0, 600, 300, 300);
    expect(sb.thumbLen).toBeCloseTo(150, 6);
  });

  it("floors the thumb at the minimum length on a huge alignment", () => {
    // view is a tiny fraction of content ⇒ proportional thumb would be < min.
    const sb = axisScrollbar(0, 100000, 300, 300);
    expect(sb.thumbLen).toBe(SCROLLBAR_MIN_THUMB);
  });

  it("pins the thumb to the track start at scroll 0 and the end at max", () => {
    const content = 1000;
    const view = 300;
    const track = 300;
    const max = content - view; // 700
    const top = axisScrollbar(0, content, view, track);
    expect(top.thumbPos).toBe(0);
    const bottom = axisScrollbar(max, content, view, track);
    expect(bottom.thumbPos).toBeCloseTo(track - bottom.thumbLen, 6);
  });

  it("clamps an out-of-range scroll into the track", () => {
    const sb = axisScrollbar(1e9, 1000, 300, 300);
    expect(sb.thumbPos).toBeCloseTo(sb.trackLen - sb.thumbLen, 6);
  });
});

describe("round-trip: scroll → thumbPos → scroll", () => {
  // Two regimes: proportional thumb, and the min-thumb-floored huge case (where
  // trackLen − thumbLen still drives a linear, invertible mapping).
  const cases = [
    { content: 1000, view: 300, track: 300 },
    { content: 100000, view: 300, track: 300 }, // min-thumb regime
    { content: 5000, view: 420, track: 410 }, // cross-shortened track
  ];
  for (const { content, view, track } of cases) {
    const max = content - view;
    for (const frac of [0, 0.13, 0.5, 0.87, 1]) {
      const scroll = frac * max;
      it(`content ${content} view ${view} track ${track} @ ${frac}`, () => {
        const sb = axisScrollbar(scroll, content, view, track);
        expect(scrollForThumbPos(sb.thumbPos, sb)).toBeCloseTo(scroll, 4);
      });
    }
  }
});

describe("layoutScrollbars — corner sharing", () => {
  function vp(over: Partial<Viewport>): Viewport {
    return { scrollX: 0, scrollY: 0, cellW: 10, cellH: 10, viewW: 300, viewH: 200, ...over };
  }

  it("shows neither bar when the alignment fits", () => {
    const dims: Dims = { cols: 5, rows: 5 }; // 50×50 px content in a 300×200 view
    const { v, h } = layoutScrollbars(vp({}), dims);
    expect(v.visible).toBe(false);
    expect(h.visible).toBe(false);
  });

  it("shortens each track by the other bar's thickness when both overflow", () => {
    const dims: Dims = { cols: 1000, rows: 1000 }; // overflows both axes
    const { v, h } = layoutScrollbars(vp({}), dims);
    expect(v.visible).toBe(true);
    expect(h.visible).toBe(true);
    expect(v.trackLen).toBe(200 - SCROLLBAR_THICKNESS); // viewH − thickness
    expect(h.trackLen).toBe(300 - SCROLLBAR_THICKNESS); // viewW − thickness
  });

  it("uses the full track on an axis when only it overflows", () => {
    // Many columns, few rows: only the horizontal bar shows, full-width.
    const dims: Dims = { cols: 1000, rows: 3 };
    const { v, h } = layoutScrollbars(vp({}), dims);
    expect(v.visible).toBe(false);
    expect(h.visible).toBe(true);
    expect(h.trackLen).toBe(300); // no vertical bar to make room for
  });
});
