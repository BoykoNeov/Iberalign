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
