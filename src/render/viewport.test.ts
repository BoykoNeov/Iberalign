// Tests for the pure screen geometry: the cell↔px transforms round-trip, and the
// visible-window math clamps to content and honors overscan. A virtualization
// bug here shows up as missing or doubled cells at the smoke; cheaper to catch
// as a unit.

import { describe, it, expect } from "vitest";
import type { Dims, Viewport } from "../state/viewport";
import { colToX, rowToY, xToCol, yToRow, visibleCols, visibleRows } from "./viewport";

const DIMS: Dims = { cols: 100, rows: 40 };

function vp(over: Partial<Viewport> = {}): Viewport {
  return { scrollX: 200, scrollY: 100, cellW: 10, cellH: 10, viewW: 300, viewH: 200, ...over };
}

describe("cell ↔ px transforms", () => {
  it("colToX/rowToY place the cell relative to the scroll origin", () => {
    const v = vp();
    expect(colToX(v, 20)).toBe(0); // col 20 at x=200, scrolled by 200 ⇒ left edge
    expect(colToX(v, 25)).toBe(50);
    expect(rowToY(v, 10)).toBe(0);
    expect(rowToY(v, 15)).toBe(50);
  });

  it("xToCol/yToRow invert colToX/rowToY for the cell's left/top edge", () => {
    const v = vp();
    for (const col of [0, 20, 37, 99]) {
      expect(xToCol(v, colToX(v, col))).toBe(col);
    }
    for (const row of [0, 10, 25, 39]) {
      expect(yToRow(v, rowToY(v, row))).toBe(row);
    }
  });

  it("xToCol can return out-of-range indices (caller range-checks)", () => {
    const v = vp({ scrollX: 0 });
    expect(xToCol(v, -1)).toBe(-1);
    expect(xToCol(v, DIMS.cols * v.cellW + 5)).toBe(DIMS.cols); // past the last col
  });
});

describe("visible window", () => {
  it("covers exactly the on-screen cells with no overscan", () => {
    // scrollX 200, cellW 10 ⇒ first col 20; +viewW 300 ⇒ 500/10 = col 50.
    expect(visibleCols(vp(), DIMS)).toEqual({ first: 20, last: 50 });
    expect(visibleRows(vp(), DIMS)).toEqual({ first: 10, last: 30 });
  });

  it("pads by overscan on both sides", () => {
    expect(visibleCols(vp(), DIMS, 2)).toEqual({ first: 18, last: 52 });
  });

  it("clamps to content at the edges", () => {
    const atOrigin = vp({ scrollX: 0, scrollY: 0 });
    expect(visibleCols(atOrigin, DIMS, 3).first).toBe(0); // overscan can't go negative

    const small: Dims = { cols: 5, rows: 3 };
    const v = vp({ scrollX: 0, scrollY: 0 });
    expect(visibleCols(v, small, 5)).toEqual({ first: 0, last: 4 }); // last clamped to cols-1
    expect(visibleRows(v, small, 5)).toEqual({ first: 0, last: 2 });
  });

  it("returns an empty range when an axis has no cells", () => {
    expect(visibleCols(vp(), { cols: 0, rows: 0 })).toEqual({ first: 0, last: -1 });
  });
});
