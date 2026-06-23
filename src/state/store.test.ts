// `GridStore` tests. The store is thin (it delegates to the pure reducers, which
// have their own tests), so these focus on the two things the store itself owns:
// the dirty/rAF contract (every mutator marks dirty; consume clears it) and the
// load → reset-scroll behavior.

import { describe, it, expect, beforeEach } from "vitest";
import { GridStore } from "./store";
import { DEFAULT_CELL } from "./viewport";

describe("GridStore — dirty contract", () => {
  let store: GridStore;
  beforeEach(() => {
    store = new GridStore();
    store.setDims(100, 40);
    store.resize(300, 200);
    store.consumeDirty(); // clear the load/resize dirty so each case starts clean
  });

  it("starts not dirty after consume", () => {
    expect(store.consumeDirty()).toBe(false);
  });

  it("pan marks dirty exactly once", () => {
    store.pan(10, 10);
    expect(store.consumeDirty()).toBe(true);
    expect(store.consumeDirty()).toBe(false);
  });

  it("zoom marks dirty", () => {
    store.zoom(2, 150, 100);
    expect(store.consumeDirty()).toBe(true);
  });

  it("scrollTo marks dirty and sets an absolute (clamped) offset", () => {
    store.scrollTo(1e9, 0); // past the right edge
    expect(store.consumeDirty()).toBe(true);
    const vp = store.getViewport();
    expect(vp.scrollX).toBe(100 * vp.cellW - vp.viewW); // 100 cols, clamped to edge
    expect(vp.scrollY).toBe(0);
  });

  it("resize marks dirty", () => {
    store.resize(400, 300);
    expect(store.consumeDirty()).toBe(true);
  });

  it("setDims marks dirty", () => {
    store.setDims(50, 20);
    expect(store.consumeDirty()).toBe(true);
  });

  it("markDirty forces a redraw without a viewport change", () => {
    store.markDirty();
    expect(store.consumeDirty()).toBe(true);
  });
});

describe("GridStore — load resets the view", () => {
  it("setDims scrolls back to the origin", () => {
    const store = new GridStore();
    store.setDims(1000, 500);
    store.resize(300, 200);
    store.pan(500, 500);
    expect(store.getViewport().scrollX).toBeGreaterThan(0);

    store.setDims(800, 400); // load a different alignment
    expect(store.getViewport().scrollX).toBe(0);
    expect(store.getViewport().scrollY).toBe(0);
    expect(store.getDims()).toEqual({ cols: 800, rows: 400 });
  });

  it("default viewport uses the default cell size", () => {
    const store = new GridStore();
    expect(store.getViewport().cellW).toBe(DEFAULT_CELL);
    expect(store.getViewport().cellH).toBe(DEFAULT_CELL);
  });
});

describe("GridStore — selection", () => {
  let store: GridStore;
  beforeEach(() => {
    store = new GridStore();
    store.setDims(100, 40);
    store.resize(300, 200); // shows ~cols 0..20, rows 0..13 at DEFAULT_CELL (14px)
    store.consumeDirty();
  });

  it("starts with no selection", () => {
    expect(store.getSelection()).toBeNull();
  });

  it("setCursor selects one clamped cell and marks dirty (no scroll)", () => {
    store.setCursor(5, 7);
    expect(store.consumeDirty()).toBe(true);
    expect(store.getSelection()).toEqual({
      anchor: { row: 5, col: 7 },
      active: { row: 5, col: 7 },
    });
    expect(store.getViewport().scrollX).toBe(0); // a click doesn't scroll
    expect(store.getViewport().scrollY).toBe(0);
  });

  it("setActive keeps the anchor and extends the active end", () => {
    store.setCursor(2, 2);
    store.setActive(6, 9);
    expect(store.getSelection()).toEqual({
      anchor: { row: 2, col: 2 },
      active: { row: 6, col: 9 },
    });
  });

  it("moveCursor marks dirty, clamps, and scrolls the cursor into view", () => {
    store.setCursor(0, 0);
    store.consumeDirty();
    // Jump to the last cell with the FAR idiom — must clamp to (39, 99) and scroll
    // the bottom-right corner into view (scroll pinned to the content edge).
    store.moveCursor(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    expect(store.consumeDirty()).toBe(true);
    expect(store.getSelection()!.active).toEqual({ row: 39, col: 99 });
    const vp = store.getViewport();
    expect(vp.scrollX).toBe(100 * vp.cellW - vp.viewW); // 100 cols, clamped to edge
    expect(vp.scrollY).toBe(40 * vp.cellH - vp.viewH); // 40 rows, clamped to edge
  });

  it("extendActive keeps the anchor while the active end moves and scrolls", () => {
    store.setCursor(0, 0);
    store.extendActive(20, 30);
    const sel = store.getSelection()!;
    expect(sel.anchor).toEqual({ row: 0, col: 0 });
    expect(sel.active).toEqual({ row: 20, col: 30 });
    // Active end scrolled into view (it was off-screen at the origin).
    expect(store.getViewport().scrollY).toBeGreaterThan(0);
  });

  it("selectAll spans the whole alignment", () => {
    store.selectAll();
    expect(store.getSelection()).toEqual({
      anchor: { row: 0, col: 0 },
      active: { row: 39, col: 99 },
    });
  });

  it("collapseSelection reduces the rectangle to its active cell", () => {
    store.setCursor(3, 3);
    store.setActive(9, 9);
    store.collapseSelection();
    expect(store.getSelection()).toEqual({
      anchor: { row: 9, col: 9 },
      active: { row: 9, col: 9 },
    });
  });

  it("setDims clears a stale selection on load", () => {
    store.setCursor(5, 5);
    expect(store.getSelection()).not.toBeNull();
    store.setDims(80, 30); // load a different alignment
    expect(store.getSelection()).toBeNull();
  });

  it("clearSelection drops the selection", () => {
    store.setCursor(5, 5);
    store.clearSelection();
    expect(store.getSelection()).toBeNull();
  });
});
