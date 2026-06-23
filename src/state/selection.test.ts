// Selection reducer tests. The canvas can't be unit-tested in CI, so these pure
// reducers are the real test surface for selection: a flipped rectangle, an
// off-by-one at an edge, or a failure to collapse on a plain arrow all surface
// here without a DOM.

import { describe, it, expect } from "vitest";
import {
  type Dims,
} from "./viewport";
import {
  type Selection,
  setCursor,
  moveCursor,
  extendActive,
  setActive,
  selectAll,
  collapseSelection,
  normalize,
  rectDims,
} from "./selection";

const DIMS: Dims = { cols: 100, rows: 40 };
const FAR = Number.MAX_SAFE_INTEGER; // the Home/End/corner-jump idiom

function single(row: number, col: number): Selection {
  return { anchor: { row, col }, active: { row, col } };
}

describe("setCursor — collapse to one clamped cell", () => {
  it("sets a single interior cell", () => {
    expect(setCursor(5, 7, DIMS)).toEqual(single(5, 7));
  });

  it("clamps past the bottom-right edge to the last cell", () => {
    expect(setCursor(999, 999, DIMS)).toEqual(single(39, 99));
  });

  it("clamps negatives to the origin", () => {
    expect(setCursor(-5, -5, DIMS)).toEqual(single(0, 0));
  });
});

describe("moveCursor — moves AND collapses (the trap)", () => {
  it("collapses a live rectangle to a single cell at active+delta", () => {
    // anchor (0,5), active (0,3); ArrowLeft (dc=-1) must yield the single cell
    // (0,2) — NOT a moved-but-uncollapsed rectangle over cols 2..4.
    const sel: Selection = { anchor: { row: 0, col: 5 }, active: { row: 0, col: 3 } };
    expect(moveCursor(sel, 0, -1, DIMS)).toEqual(single(0, 2));
  });

  it("moves a single cursor by the delta", () => {
    expect(moveCursor(single(5, 5), 1, 0, DIMS)).toEqual(single(6, 5));
    expect(moveCursor(single(5, 5), 0, -1, DIMS)).toEqual(single(5, 4));
  });

  it("stops at the top-left border", () => {
    expect(moveCursor(single(0, 0), -1, -1, DIMS)).toEqual(single(0, 0));
  });

  it("stops at the bottom-right border", () => {
    expect(moveCursor(single(39, 99), 1, 1, DIMS)).toEqual(single(39, 99));
  });

  it("a FAR delta reaches the last cell (b8664e2 reachability, via the cursor)", () => {
    expect(moveCursor(single(0, 0), FAR, FAR, DIMS)).toEqual(single(39, 99));
  });

  it("a -FAR delta reaches the first cell", () => {
    expect(moveCursor(single(20, 20), -FAR, -FAR, DIMS)).toEqual(single(0, 0));
  });

  it("seeds defensively from (0,0) when there is no selection", () => {
    expect(moveCursor(null, FAR, FAR, DIMS)).toEqual(single(39, 99)); // Ctrl+End, no sel
    expect(moveCursor(null, -FAR, -FAR, DIMS)).toEqual(single(0, 0)); // Ctrl+Home, no sel
  });
});

describe("extendActive — keep anchor, move active", () => {
  it("grows the rectangle from a fixed anchor", () => {
    const sel = single(5, 5);
    const grown = extendActive(sel, 2, 3, DIMS);
    expect(grown.anchor).toEqual({ row: 5, col: 5 });
    expect(grown.active).toEqual({ row: 7, col: 8 });
  });

  it("can shrink and cross the anchor (flip direction)", () => {
    const sel: Selection = { anchor: { row: 5, col: 5 }, active: { row: 5, col: 8 } };
    const flipped = extendActive(sel, 0, -6, DIMS); // active 8 → 2, past the anchor
    expect(flipped.anchor).toEqual({ row: 5, col: 5 });
    expect(flipped.active).toEqual({ row: 5, col: 2 });
  });

  it("clamps the active end at the border without moving the anchor", () => {
    const sel = single(0, 0);
    const ext = extendActive(sel, FAR, FAR, DIMS);
    expect(ext.anchor).toEqual({ row: 0, col: 0 });
    expect(ext.active).toEqual({ row: 39, col: 99 });
  });

  it("seeds like moveCursor when there is no selection", () => {
    expect(extendActive(null, 1, 1, DIMS)).toEqual(single(1, 1));
  });
});

describe("setActive — Shift+click", () => {
  it("keeps the anchor and sets the active end", () => {
    const sel = single(2, 2);
    const ext = setActive(sel, 8, 9, DIMS);
    expect(ext.anchor).toEqual({ row: 2, col: 2 });
    expect(ext.active).toEqual({ row: 8, col: 9 });
  });

  it("seeds the anchor at the clicked cell when nothing is selected", () => {
    expect(setActive(null, 4, 6, DIMS)).toEqual(single(4, 6));
  });

  it("clamps the clicked cell to the content", () => {
    expect(setActive(single(0, 0), 999, 999, DIMS).active).toEqual({ row: 39, col: 99 });
  });
});

describe("selectAll", () => {
  it("spans the full alignment", () => {
    expect(selectAll(DIMS)).toEqual({
      anchor: { row: 0, col: 0 },
      active: { row: 39, col: 99 },
    });
  });
});

describe("collapseSelection — Esc", () => {
  it("collapses to the active cell, keeping the cursor put", () => {
    const sel: Selection = { anchor: { row: 1, col: 1 }, active: { row: 7, col: 9 } };
    expect(collapseSelection(sel)).toEqual(single(7, 9));
  });
});

describe("normalize + rectDims", () => {
  it("orders a forward rectangle", () => {
    const sel: Selection = { anchor: { row: 1, col: 2 }, active: { row: 5, col: 8 } };
    expect(normalize(sel)).toEqual({ r0: 1, r1: 5, c0: 2, c1: 8 });
    expect(rectDims(normalize(sel))).toEqual({ rows: 5, cols: 7 });
  });

  it("orders a flipped rectangle the same way (anchor below/right of active)", () => {
    const sel: Selection = { anchor: { row: 5, col: 8 }, active: { row: 1, col: 2 } };
    expect(normalize(sel)).toEqual({ r0: 1, r1: 5, c0: 2, c1: 8 });
  });

  it("a single cell is a 1×1 rectangle", () => {
    expect(rectDims(normalize(single(3, 3)))).toEqual({ rows: 1, cols: 1 });
  });
});
