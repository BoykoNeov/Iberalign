// Viewport reducer tests. These assert the *invariants* that matter at the fps
// smoke (the anchor stays under the cursor through zoom; scroll never escapes
// the content), not the literal transform — so they catch an anchor/clamp bug
// wherever the math lives, and survive a refactor of the transform itself.

import { describe, it, expect } from "vitest";
import {
  type Dims,
  type Viewport,
  initViewport,
  clamp,
  pan,
  scrollTo,
  resize,
  zoomAbout,
  scrollIntoView,
  contentWidth,
  contentHeight,
  MIN_CELL,
  MAX_CELL,
} from "./viewport";

const DIMS: Dims = { cols: 100, rows: 40 };

/** A viewport whose content is larger than the view in both axes, scrolled to
 *  an interior offset so scroll-clamping is inactive (lets us isolate the zoom
 *  anchor invariant from the edge clamp). */
function interior(): Viewport {
  return {
    scrollX: 200,
    scrollY: 100,
    cellW: 10,
    cellH: 10,
    viewW: 300,
    viewH: 200,
  };
}

/** Content column under a grid-canvas x (in cell units): the quantity the zoom
 *  anchor must preserve. */
function colUnderCursor(vp: Viewport, ax: number): number {
  return (vp.scrollX + ax) / vp.cellW;
}
function rowUnderCursor(vp: Viewport, ay: number): number {
  return (vp.scrollY + ay) / vp.cellH;
}

describe("clamp — scroll stays within content", () => {
  it("never exceeds max(0, content - view)", () => {
    const vp = clamp({ ...interior(), scrollX: 1e9, scrollY: 1e9 }, DIMS);
    expect(vp.scrollX).toBe(contentWidth(vp, DIMS) - vp.viewW);
    expect(vp.scrollY).toBe(contentHeight(vp, DIMS) - vp.viewH);
  });

  it("never goes negative", () => {
    const vp = clamp({ ...interior(), scrollX: -50, scrollY: -50 }, DIMS);
    expect(vp.scrollX).toBe(0);
    expect(vp.scrollY).toBe(0);
  });

  it("pins scroll to 0 when content is smaller than the view", () => {
    // 5 cols * 10px = 50px content, 300px view ⇒ only offset 0 is valid.
    const small: Dims = { cols: 5, rows: 3 };
    const vp = clamp({ ...interior(), scrollX: 999, scrollY: 999 }, small);
    expect(vp.scrollX).toBe(0);
    expect(vp.scrollY).toBe(0);
  });
});

describe("pan", () => {
  it("translates then clamps", () => {
    const vp = pan(interior(), DIMS, 30, -40);
    expect(vp.scrollX).toBe(230);
    expect(vp.scrollY).toBe(60);
  });

  it("cannot pan past the top-left origin", () => {
    const vp = pan(interior(), DIMS, -1e9, -1e9);
    expect(vp.scrollX).toBe(0);
    expect(vp.scrollY).toBe(0);
  });
});

describe("scrollTo", () => {
  it("sets an absolute interior offset", () => {
    const vp = scrollTo(interior(), DIMS, 350, 120);
    expect(vp.scrollX).toBe(350);
    expect(vp.scrollY).toBe(120);
  });

  it("clamps a past-the-end target to the content edge (reaches last row/col)", () => {
    const vp = scrollTo(interior(), DIMS, 1e9, 1e9);
    expect(vp.scrollX).toBe(contentWidth(vp, DIMS) - vp.viewW);
    expect(vp.scrollY).toBe(contentHeight(vp, DIMS) - vp.viewH);
  });

  it("clamps a negative target to the origin", () => {
    const vp = scrollTo(interior(), DIMS, -100, -100);
    expect(vp.scrollX).toBe(0);
    expect(vp.scrollY).toBe(0);
  });
});

describe("resize", () => {
  it("re-clamps scroll when the view grows past the old max", () => {
    // Scroll to the right edge, then enlarge the view: scroll must pull back in.
    const atEdge = clamp({ ...interior(), scrollX: 1e9 }, DIMS);
    const grown = resize(atEdge, DIMS, 900, 200);
    expect(grown.scrollX).toBe(Math.max(0, contentWidth(grown, DIMS) - 900));
  });
});

describe("zoomAbout — the content point under the cursor is preserved", () => {
  // A large alignment with the cursor far from every edge, so the scroll-clamp
  // stays inactive across the whole factor range (even zoom-out, which shrinks
  // the content). The anchor invariant only holds where the edge clamp doesn't
  // legitimately pull the view back in — that boundary behavior is its own test.
  const BIG: Dims = { cols: 10000, rows: 10000 };
  function bigInterior(): Viewport {
    return { scrollX: 2000, scrollY: 2000, cellW: 10, cellH: 10, viewW: 300, viewH: 200 };
  }

  const factors = [0.2, 0.5, 0.8, 1.25, 2, 5];
  const anchors = [
    { ax: 0, ay: 0 },
    { ax: 150, ay: 100 },
    { ax: 299, ay: 199 },
  ];

  for (const f of factors) {
    for (const { ax, ay } of anchors) {
      it(`factor ${f} at (${ax},${ay}) keeps the anchored cell fixed`, () => {
        const before = bigInterior();
        const after = zoomAbout(before, BIG, f, ax, ay);
        expect(colUnderCursor(after, ax)).toBeCloseTo(colUnderCursor(before, ax), 6);
        expect(rowUnderCursor(after, ay)).toBeCloseTo(rowUnderCursor(before, ay), 6);
      });
    }
  }

  it("clamps cell size to [MIN_CELL, MAX_CELL]", () => {
    const zoomedOut = zoomAbout(bigInterior(), BIG, 0.001, 150, 100);
    expect(zoomedOut.cellW).toBe(MIN_CELL);
    expect(zoomedOut.cellH).toBe(MIN_CELL);

    const zoomedIn = zoomAbout(bigInterior(), BIG, 1000, 150, 100);
    expect(zoomedIn.cellW).toBe(MAX_CELL);
    expect(zoomedIn.cellH).toBe(MAX_CELL);
  });

  it("preserves the anchor even when the cell-size clamp engages", () => {
    // factor 1000 saturates at MAX_CELL; the anchor must still hold because we
    // re-derive scroll from the *clamped* cell size, not the requested one.
    const before = bigInterior();
    const after = zoomAbout(before, BIG, 1000, 150, 100);
    expect(after.cellW).toBe(MAX_CELL);
    expect(colUnderCursor(after, 150)).toBeCloseTo(colUnderCursor(before, 150), 6);
  });

  it("initViewport starts at the origin with the default cell size", () => {
    const vp = initViewport(640, 480);
    expect(vp.scrollX).toBe(0);
    expect(vp.scrollY).toBe(0);
    expect(vp.cellW).toBe(vp.cellH);
    expect(vp.viewW).toBe(640);
    expect(vp.viewH).toBe(480);
  });
});

describe("scrollIntoView — minimal scroll so the cell box is visible", () => {
  // interior() shows cols 20..49 (scrollX 200, view 300, cell 10) and rows
  // 10..29 (scrollY 100, view 200, cell 10).
  it("does not move when the cell is already fully inside", () => {
    const vp = scrollIntoView(interior(), DIMS, { row: 15, col: 30 });
    expect(vp.scrollX).toBe(200);
    expect(vp.scrollY).toBe(100);
  });

  it("scrolls left so a cell off the left edge sits at the view's left", () => {
    // col 5 → left edge 50, which is < scrollX 200 ⇒ scrollX becomes 50.
    const vp = scrollIntoView(interior(), DIMS, { row: 15, col: 5 });
    expect(vp.scrollX).toBe(50);
    expect(vp.scrollY).toBe(100); // y untouched (row already visible)
  });

  it("scrolls right so a cell off the right edge sits at the view's right", () => {
    // col 60 → right edge 610; view right is 200+300=500 ⇒ scrollX = 610-300 = 310.
    const vp = scrollIntoView(interior(), DIMS, { row: 15, col: 60 });
    expect(vp.scrollX).toBe(310);
    expect(vp.scrollY).toBe(100);
  });

  it("scrolls up for a cell above the view", () => {
    // row 3 → top edge 30 < scrollY 100 ⇒ scrollY = 30.
    const vp = scrollIntoView(interior(), DIMS, { row: 3, col: 30 });
    expect(vp.scrollY).toBe(30);
    expect(vp.scrollX).toBe(200);
  });

  it("scrolls down for a cell below the view", () => {
    // row 35 → bottom edge 360; view bottom 100+200=300 ⇒ scrollY = 360-200 = 160.
    const vp = scrollIntoView(interior(), DIMS, { row: 35, col: 30 });
    expect(vp.scrollY).toBe(160);
  });

  it("clamps at the content edge (the last cell can't over-scroll)", () => {
    // Last cell (row 39, col 99). The minimal scroll would push past the content,
    // so clamp pins it to the bottom-right extent.
    const vp = scrollIntoView(interior(), DIMS, { row: 39, col: 99 });
    expect(vp.scrollX).toBe(contentWidth(vp, DIMS) - vp.viewW);
    expect(vp.scrollY).toBe(contentHeight(vp, DIMS) - vp.viewH);
  });
});
